// Firestore rules for the private player registry and coach-linked
// children, run against this repo's firestore.rules in the emulator.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import {
  admin,
  clearFirestore,
  clientDb,
  closeClients,
  expectDenied,
  seed,
} from "./support.mjs";
import {
  createAndLinkChild,
  ensureManagedIdentity,
  linkExistingChild,
  listLinkedPlayers,
  listManagedIdentities,
} from "../../src/lib/coachPlayersStore.ts";
import { COACH_UID, IDS, OTHER_COACH_UID, legacySnapshot } from "../support/fixtures.mjs";

const PARENT_UID = "parent-not-admin";

beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID, OTHER_COACH_UID]);
});
after(closeClients);

test("a coach can create and read only identities they manage", async () => {
  const mine = clientDb(COACH_UID);
  const theirs = clientDb(OTHER_COACH_UID);

  assert.equal(
    await ensureManagedIdentity({ db: mine, uid: COACH_UID, careerPlayerId: IDS.ava, displayName: "Ava Carter" }),
    true,
  );
  assert.equal((await getDoc(doc(mine, "playerIdentities", IDS.ava))).data().displayName, "Ava Carter");

  // The other coach cannot read it, and cannot take it over.
  await expectDenied(getDoc(doc(theirs, "playerIdentities", IDS.ava)));
  assert.equal(
    await ensureManagedIdentity({ db: theirs, uid: OTHER_COACH_UID, careerPlayerId: IDS.ava, displayName: "X" }),
    false,
  );
  // Reading an id that does not exist is allowed (reveals nothing).
  assert.equal((await getDoc(doc(theirs, "playerIdentities", IDS.ben))).exists(), false);

  // Listing is scoped to managerUids.
  await ensureManagedIdentity({ db: theirs, uid: OTHER_COACH_UID, careerPlayerId: IDS.ben, displayName: "Ben Diaz" });
  assert.deepEqual((await listManagedIdentities(mine, COACH_UID)).map((i) => i.careerPlayerId), [IDS.ava]);
  assert.deepEqual((await listManagedIdentities(theirs, OTHER_COACH_UID)).map((i) => i.careerPlayerId), [IDS.ben]);
  await expectDenied(getDocs(collection(mine, "playerIdentities")));
  await expectDenied(
    getDocs(query(collection(mine, "playerIdentities"), where("managerUids", "array-contains", OTHER_COACH_UID))),
  );
});

test("identity docs reject forged managers, id changes, and deletes", async () => {
  const mine = clientDb(COACH_UID);
  const ref = doc(mine, "playerIdentities", IDS.cole);
  const base = {
    careerPlayerId: IDS.cole,
    displayName: "Cole Evans",
    createdByUid: COACH_UID,
  };
  await expectDenied(setDoc(ref, { ...base, managerUids: [COACH_UID, OTHER_COACH_UID] }));
  await expectDenied(setDoc(ref, { ...base, managerUids: [OTHER_COACH_UID] }));
  await expectDenied(setDoc(ref, { ...base, careerPlayerId: IDS.dana, managerUids: [COACH_UID] }));
  await expectDenied(setDoc(ref, { ...base, managerUids: [COACH_UID], parentEmail: "x@y" }));

  await setDoc(ref, { ...base, managerUids: [COACH_UID] });
  await expectDenied(updateDoc(ref, { managerUids: [COACH_UID, OTHER_COACH_UID] }));
  await expectDenied(updateDoc(ref, { careerPlayerId: IDS.dana }));
  await expectDenied(deleteDoc(ref));
  await updateDoc(ref, { displayName: "Cole E." });
});

test("non-admins and anonymous users cannot touch the private registry", async () => {
  const parent = clientDb(PARENT_UID);
  const anon = clientDb(null);
  const mine = clientDb(COACH_UID);
  await ensureManagedIdentity({ db: mine, uid: COACH_UID, careerPlayerId: IDS.ava, displayName: "Ava" });
  await linkExistingChild({ db: mine, uid: COACH_UID, careerPlayerId: IDS.ava, displayName: "Ava" });

  for (const db of [parent, anon]) {
    await expectDenied(getDoc(doc(db, "playerIdentities", IDS.ava)));
    await expectDenied(getDocs(collection(db, "coachProfiles", COACH_UID, "linkedPlayers")));
    await expectDenied(getDoc(doc(db, "coachProfiles", COACH_UID, "linkedPlayers", IDS.ava)));
  }
  await expectDenied(
    setDoc(doc(parent, "playerIdentities", IDS.eli), {
      careerPlayerId: IDS.eli,
      displayName: "Eli",
      managerUids: [PARENT_UID],
      createdByUid: PARENT_UID,
    }),
  );
  // A parent cannot link themselves to a child either.
  await expectDenied(
    setDoc(doc(parent, "coachProfiles", PARENT_UID, "linkedPlayers", IDS.ava), {
      careerPlayerId: IDS.ava,
      displayName: "Ava",
      relationship: "child",
      confirmed: true,
    }),
  );
});

test("linked children are private to the coach and must be managed identities", async () => {
  const mine = clientDb(COACH_UID);
  const theirs = clientDb(OTHER_COACH_UID);

  // New child: identity + link created together in one batch.
  const childId = await createAndLinkChild({ db: mine, uid: COACH_UID, displayName: "Riley Bauer" });
  assert.deepEqual((await listLinkedPlayers(mine, COACH_UID)).map((l) => l.careerPlayerId), [childId]);

  // Other coach cannot read my links or write into my profile.
  await expectDenied(listLinkedPlayers(theirs, COACH_UID));
  await expectDenied(
    linkExistingChild({ db: theirs, uid: COACH_UID, careerPlayerId: childId, displayName: "x" }),
  );

  // I cannot link an identity I don't manage (another coach's child).
  await ensureManagedIdentity({ db: theirs, uid: OTHER_COACH_UID, careerPlayerId: IDS.dana, displayName: "Dana" });
  await expectDenied(
    linkExistingChild({ db: mine, uid: COACH_UID, careerPlayerId: IDS.dana, displayName: "Dana" }),
  );
  // Nor an identity that has no registry doc yet.
  await expectDenied(
    linkExistingChild({ db: mine, uid: COACH_UID, careerPlayerId: IDS.eli, displayName: "Eli" }),
  );

  // Unconfirmed or non-child links are rejected.
  await expectDenied(
    setDoc(doc(mine, "coachProfiles", COACH_UID, "linkedPlayers", childId), {
      careerPlayerId: childId,
      displayName: "Riley",
      relationship: "child",
      confirmed: false,
    }),
  );
});

test("documented exposure: season data stays publicly readable, writes stay admin-only", async () => {
  const anon = clientDb(null);
  const parent = clientDb(PARENT_UID);
  const snap = await getDocs(collection(anon, "seasons", "tigers-fall-2026", "players"));
  assert.ok(snap.size > 0, "D1: anyone can read rosters (unchanged in this phase)");
  await expectDenied(
    setDoc(doc(parent, "seasons", "tigers-fall-2026"), { record: { wins: 0, losses: 0 } }, { merge: true }),
  );
  const season = await admin.doc("seasons/tigers-fall-2026").get();
  assert.equal(season.data().record.wins, 5);
});
