// Team current season and publication (multi-coach data model, target rules).
//
// - teams/{teamId}.currentSeasonId is the team's own current season; it never
//   reads or writes app/config, and changing one team never touches another.
// - seasons/{id}.published is separate from lifecycle status. Parents see a
//   season only while it is published (rules); drafts can't be published.
// - publicTeams/{teamId} is the parents' projection of the team: branding and
//   the current season *only if that season is published* (rules check it).
// - Public careerLinks are recomputed on every publication change so that no
//   public roster entry links to an unpublished season.

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

import { normalizeBranding, type SeasonBranding } from "@/lib/branding";
import { computeCareerLinks, normalizeCareerLinks, sameLinks, type CareerLinkEntry } from "@/lib/careerLinks";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { asSeasonStatus, type LifecycleEvent } from "@/lib/seasonLifecycle";

export type OwnedTeam = {
  teamId: string;
  teamName: string;
  currentSeasonId: string | null;
  branding: SeasonBranding | null;
};

function ownedTeamFrom(teamId: string, d: DocumentData): OwnedTeam {
  return {
    teamId,
    teamName: typeof d.teamName === "string" && d.teamName ? d.teamName : teamId,
    currentSeasonId: typeof d.currentSeasonId === "string" && d.currentSeasonId ? d.currentSeasonId : null,
    branding: normalizeBranding({ ...d, teamId }),
  };
}

/** The coach's own teams (scoped query; rules allow nothing else). */
export async function listOwnedTeams(db: Firestore, uid: string): Promise<OwnedTeam[]> {
  const snap = await getDocs(query(collection(db, "teams"), where("ownerUid", "==", uid)));
  return snap.docs.map((d) => ownedTeamFrom(d.id, d.data())).sort((a, b) => a.teamName.localeCompare(b.teamName));
}

/** One team the coach owns, or null (missing, or another coach's: rules deny). */
export async function readOwnedTeam(db: Firestore, teamId: string): Promise<OwnedTeam | null> {
  try {
    const snap = await getDoc(doc(db, "teams", teamId));
    return snap.exists() ? ownedTeamFrom(snap.id, snap.data()) : null;
  } catch {
    return null;
  }
}

/** publicTeams/{teamId} contents: public branding fields + published current. */
export function publicTeamProjection(team: DocumentData, publishedCurrentSeasonId: string | null) {
  return {
    teamName: team.teamName,
    shortName: team.shortName,
    sport: team.sport,
    division: team.division,
    logo: team.logo ?? null,
    palettes: team.palettes,
    awardCollection: team.awardCollection,
    currentSeasonId: publishedCurrentSeasonId,
    updatedAt: serverTimestamp(),
  };
}

const label = (d: DocumentData | undefined, id: string) =>
  typeof d?.seasonLabel === "string" && d.seasonLabel ? d.seasonLabel : id;

/**
 * Makes a season the team's current season. A draft is activated in the same
 * transaction (audited in private/audit); a finalized season must be
 * reopened first; the season must belong to this team. Publication is not
 * changed: an unpublished current season stays invisible to parents.
 */
export async function setTeamCurrentSeason(opts: {
  db: Firestore;
  uid: string;
  teamId: string;
  seasonId: string;
}): Promise<{ activated: boolean }> {
  const { db, uid, teamId, seasonId } = opts;
  const teamRef = doc(db, "teams", teamId);
  const seasonRef = doc(db, "seasons", seasonId);
  const auditRef = doc(db, "seasons", seasonId, "private", "audit");
  return runTransaction(db, async (tx) => {
    const team = await tx.get(teamRef);
    const season = await tx.get(seasonRef);
    const audit = await tx.get(auditRef);
    if (!team.exists()) throw new Error("Team not found.");
    const s = season.exists() ? season.data() : null;
    if (!s || s.teamId !== teamId) throw new Error("That season doesn't belong to this team.");
    const status = asSeasonStatus(s.status);
    if (status === "finalized") {
      throw new Error(`${label(s, seasonId)} is finalized. Reopen it first if it needs to become current again.`);
    }
    if (status === "deleting") throw new Error(`${label(s, seasonId)} is being deleted.`);
    const activated = status === "draft";
    if (activated) {
      const event: LifecycleEvent = { action: "activated", at: new Date().toISOString(), byUid: uid, fromStatus: "draft" };
      const history = audit.exists() && Array.isArray(audit.data().lifecycleHistory) ? audit.data().lifecycleHistory : [];
      tx.update(seasonRef, { status: "active", activatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(auditRef, { lifecycleHistory: [...history, event] }, { merge: true });
    }
    tx.update(teamRef, { currentSeasonId: seasonId, updatedAt: serverTimestamp() });
    tx.set(doc(db, "publicTeams", teamId), publicTeamProjection(team.data(), s.published === true ? seasonId : null));
    return { activated };
  });
}

type OwnedSeason = { id: string; data: DocumentData };

async function careerLinkEntries(db: Firestore, seasons: OwnedSeason[]) {
  const entries: Array<CareerLinkEntry & { current: ReturnType<typeof normalizeCareerLinks> }> = [];
  for (const s of seasons) {
    const players = await getDocs(collection(db, "seasons", s.id, "players"));
    const profiles = await Promise.all(
      players.docs.map((p) => getDoc(doc(db, "seasons", s.id, "players", p.id, "private", "profile"))),
    );
    players.docs.forEach((p, i) => {
      // Effective identity: the private profile, else legacy public fields.
      const eff = { ...p.data(), ...(profiles[i].exists() ? profiles[i].data() : {}) };
      entries.push({
        seasonId: s.id,
        seasonPlayerId: p.id,
        careerPlayerId: typeof eff.careerPlayerId === "string" ? eff.careerPlayerId : undefined,
        confirmed: eff.identityStatus === "confirmed",
        linkedFrom: normalizeLinkedFrom(eff.linkedFrom),
        current: normalizeCareerLinks(p.data().careerLinks),
      });
    });
  }
  return entries;
}

/**
 * Brings every public careerLinks list of the coach's seasons in line with
 * `published` (season id → published after the change). One batch per
 * season keeps each request's rule lookups bounded. Returns entries changed.
 */
async function syncCareerLinks(db: Firestore, seasons: OwnedSeason[], published: Map<string, boolean>): Promise<number> {
  const live = seasons.filter((s) => s.data.status !== "deleting");
  const entries = await careerLinkEntries(db, live);
  const visible = new Set([...published].filter(([, p]) => p).map(([id]) => id));
  const want = computeCareerLinks(entries, visible);
  let changed = 0;
  for (const s of live) {
    const batch = writeBatch(db);
    let n = 0;
    for (const e of entries.filter((x) => x.seasonId === s.id)) {
      const next = want.get(`${e.seasonId}/${e.seasonPlayerId}`) ?? [];
      if (sameLinks(next, e.current)) continue;
      batch.update(doc(db, "seasons", s.id, "players", e.seasonPlayerId), {
        careerLinks: next.length ? next : deleteField(),
      });
      n++;
    }
    if (n) {
      await batch.commit();
      changed += n;
    }
  }
  return changed;
}

/**
 * Publishes or unpublishes a season for parents. Unpublishing removes every
 * public career link to it *before* the season is hidden; publishing adds
 * them after. Either way publicTeams shows the team's current season only
 * while that season is published. Re-running repairs an interrupted change.
 */
export async function setSeasonPublished(opts: {
  db: Firestore;
  uid: string;
  teamId: string;
  seasonId: string;
  published: boolean;
}): Promise<{ linksChanged: number }> {
  const { db, uid, teamId, seasonId, published } = opts;
  const teamSnap = await getDoc(doc(db, "teams", teamId));
  if (!teamSnap.exists()) throw new Error("Team not found.");
  const owned = await getDocs(query(collection(db, "seasons"), where("ownerUid", "==", uid)));
  const seasons: OwnedSeason[] = owned.docs.map((d) => ({ id: d.id, data: d.data() }));
  const target = seasons.find((s) => s.id === seasonId);
  if (!target || target.data.teamId !== teamId) throw new Error("That season doesn't belong to this team.");
  const status = asSeasonStatus(target.data.status);
  if (published && (status === "draft" || status === "deleting")) {
    throw new Error("Drafts can't be published. Make the season current (activate it) first.");
  }

  const after = new Map(seasons.map((s) => [s.id, s.data.published === true] as const));
  after.set(seasonId, published);
  const current = teamSnap.data().currentSeasonId;
  const publicCurrent = typeof current === "string" && after.get(current) ? current : null;

  const flip = async () => {
    const batch = writeBatch(db);
    batch.update(doc(db, "seasons", seasonId), { published, updatedAt: serverTimestamp() });
    batch.set(doc(db, "publicTeams", teamId), publicTeamProjection(teamSnap.data(), publicCurrent));
    await batch.commit();
  };

  let linksChanged = 0;
  if (!published) {
    linksChanged = await syncCareerLinks(db, seasons, after);
    await flip();
  } else {
    await flip();
    linksChanged = await syncCareerLinks(db, seasons, after);
  }
  return { linksChanged };
}

/**
 * Recomputes every public careerLinks list of the coach's seasons from the
 * current publication state (after roster changes on a published season).
 */
export async function refreshCareerLinks(db: Firestore, uid: string): Promise<number> {
  const owned = await getDocs(query(collection(db, "seasons"), where("ownerUid", "==", uid)));
  const seasons: OwnedSeason[] = owned.docs.map((d) => ({ id: d.id, data: d.data() }));
  return syncCareerLinks(db, seasons, new Map(seasons.map((s) => [s.id, s.data.published === true] as const)));
}
