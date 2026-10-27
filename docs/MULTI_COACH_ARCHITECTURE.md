# Multi-Coach Architecture — Checkpoint A

*2026-10-24 · Design and implementation plan for invitation-only coaches, team routing, and public parent access. Nothing here is implemented or deployed yet. Decisions marked **OWNER** need product-owner approval before Checkpoint B.*

## 1. Starting point (verified in code)

| Area | Today |
|---|---|
| Coach sign-in | Firebase email/password on `/admin/`; authorization = `admins/{uid}` doc |
| "Session" | Prototype `localStorage` gate (`baseball-coach:session`, role `public`/`admin`) checked against `NEXT_PUBLIC_ADMIN_EMAILS`. UI only, not security |
| Current season | One global `app/config.currentSeasonId`, guarded by rules (exists, not draft/finalized/deleting) |
| Teams | `teams/{teamId}` head-coach-only, no owner field; legacy Tigers seasons have no `teamId` |
| Public reads | Every season, roster entry, game, line, and lineup is world-readable (`allow read: if true`) |
| Routing | Static export (`output: "export"`), query-param pages: `/`, `/player/?id=&season=`, `/trophies/?season=`, `/admin/`, `/profile/` |
| Hosting | `bauer-baseball`, SPA fallback rewrite `** → /index.html` |

Private data currently inside public documents (rules cannot hide fields; any readable doc is readable whole):

- `seasons/*/players/*`: `shirtSize`, `careerPlayerId`, `identityStatus`, `identityMigration`, `linkedFrom`.
- `seasons/*`: `lifecycleHistory[].byUid`, `finalizedByUid`, `reopenedByUid` (coach UIDs), `teamId`.
- `seasons/*/lineups/*`: inning positions (low sensitivity; shown on the public home today).

Private data already protected: `admins`, `teams`, `playerIdentities`, `coachProfiles/{uid}/linkedPlayers`.

## 2. Identity, invitation, workspace

```
coachInvites/{inviteId}            admin-managed (console/Admin SDK only); never client-listable
  emailLower, status: "approved" | "revoked", boundUid: null | uid, createdAt
coaches/{uid}                      created once by the coach, on acceptance
  workspaceId, inviteId, createdAt
coachWorkspaces/{workspaceId}      opaque random id
  ownerUid, status: "active", createdAt, onboarding: { completedAt? }
```

- **Sign-in:** Google only (`signInWithPopup`, `GoogleAuthProvider`). Email/password form removed from the coach UI.
- **Approval check:** rules read the invite whose `emailLower == request.auth.token.email` **and** `request.auth.token.email_verified == true` **and** `sign_in_provider == "google.com"`. Invite ids are random; the client finds its own invite with a query constrained to its own verified email (`where("emailLower","==",token.email)`), which rules allow only for that email. No one can list invites.
- **Binding:** acceptance is one batch: `coachInvites/{id}.boundUid = auth.uid` (only if currently `null`) + `coaches/{uid}` + `coachWorkspaces/{newId}` (owner = auth.uid). Rules check all three with `getAfter`. After binding, authorization uses only `coaches/{uid}` → workspace; the email is never consulted again. One invite binds one UID once, so an approved email cannot be claimed by a second identity; a revoked invite blocks new acceptance (and `status` is checked on every request via `coaches/{uid}.inviteId`).
- **Unapproved Google user:** no invite → "Access not enabled" + Sign out. Nothing is created; no team data readable (rules).
- **Existing coach:** keeps their **current Firebase UID** (see §6). Their `admins/{uid}` doc remains as the legacy compatibility marker until the old app is retired.

## 3. Ownership (one head coach per workspace, no sharing)

Denormalised, immutable owner fields so rules need at most one `get` per request:

- `teams/{teamId}`: `workspaceId`, `ownerUid` (immutable), `currentSeasonId` (§4), `publicSlug` not used — the URL uses `teamId`.
- `seasons/{seasonId}`: `teamId`, `ownerUid` (immutable, must equal the team's `ownerUid` at create), `published` (§5).
- Subcollections authorise through `get(seasons/{id}).data.ownerUid == request.auth.uid` (already fetched for lifecycle checks).
- `playerIdentities` keep `managerUids` (existing); `coachProfiles/{uid}` stays per-UID.
- Coach queries are always scoped: `teams where ownerUid == uid`, `seasons where teamId == X` (+ ownership rule). No collection-wide coach queries.
- Ids: teams/workspaces/invites random (`crypto.randomUUID`-based); existing team ids (e.g. `falcons-ab12`) are kept as they are opaque enough and already in use.

## 4. Team-specific current season

- Authority: `teams/{teamId}.currentSeasonId`. Rules on update: the season exists, has `teamId == teamId`, same owner, and after the request is not `draft`/`finalized`/`deleting` (activation in the same transaction, exactly like the current `app/config` guard).
- `app/config.currentSeasonId` becomes **legacy compatibility only**: written by the new app only while the old app is still deployed, and only for the original coach's Tigers team (mirror of `teams/{tigers}.currentSeasonId`). Precedence: new code reads the team field; the global value is never read for routing. Retired after the old app is gone (§7).
- New team without a current season → team page empty state ("No season published yet").

## 5. Public parent access

- **Publication:** `seasons/{id}.published: boolean`, independent of lifecycle; rules forbid publishing a `draft`/`deleting` season. Anonymous reads allowed only when `published == true` (season doc and its public subcollections via `get(season).published`).
- **Queries:** parents list seasons with `where("teamId","==",X).where("published","==",true)` so every result satisfies the rule (rules are not filters).
- **Team identity for parents:** `teams/{teamId}` stays private; parents get a limited `publicTeams/{teamId}` projection (name, short name, sport, division, logo, palettes, award collection, `currentSeasonId` if published) written by the coach in the same batch as team edits, validated by rules to match the team doc's public fields.
- **Private fields — OWNER decision P1:** player docs must stop carrying private fields before they can be public. Recommended: move `shirtSize`, `careerPlayerId`, `identityStatus`, `identityMigration`, `linkedFrom` into `seasons/{s}/players/{p}/private/profile` (owner-only), keep display/stat fields public. Lifecycle audit UIDs move to `seasons/{s}/private/audit`. This **changes historical documents** (a migration of Spring/Fall 2026 player docs) and every write path; the alternative (full `publicSeasons/…` projection maintained by dual writes) doubles all writes. Either way it is a data migration that needs approval.
- Existing Tigers behaviour: both 2026 seasons are migrated as `published: true` (they are public today); the Falcons draft stays unpublished.

## 6. Existing coach preservation

- **OWNER decision P2 — UID continuity.** The production coach signs in with email/password today. Firebase's default "one account per email" behaviour links a Google sign-in for the same verified Gmail address to the existing account (same UID); if that account's email is unverified, Google replaces the password provider but keeps the UID. This must be **verified read-only** (Firebase Auth user record for the coach: UID, providers, `emailVerified`) under explicit authorization before migration, and confirmed with one real Google sign-in by the owner on localhost **against the emulator first, then production**.
- Migration (Admin SDK, after a fresh verified export, rehearsed on an emulator copy): create invite (bound) + `coaches/{uid}` + workspace for the verified UID; create a Tigers team doc from `LEGACY_TIGERS_BRANDING` (or reuse an existing Tigers team) and set `teamId`/`ownerUid` on the two 2026 seasons; set `ownerUid`/`workspaceId` on existing teams (Falcons) and the Falcons draft; set `teams/{tigers}.currentSeasonId` from `app/config`; set `published` defaults; move private fields (P1). Career identities, linked children, games, lines, stats, awards, layouts unchanged. Rollback file per document as in the identity migration.

## 7. Routing (static export compatible)

- Routes: `/teams/{teamId}/` (current season), `/teams/{teamId}/seasons/{seasonId}/home`, `/…/players/{playerId}`, `/…/trophies`, print via existing sheet components.
- **Verified spike (emulator, demo build):** one prerendered shell (`app/teams/[[...path]]` with `generateStaticParams → [{ path: [] }]`) plus Hosting rewrite `/teams/** → /teams/index.html` keeps the real URL on direct load, client navigation, refresh, and back/forward; `usePathname()` returns the full path. The shell parses the path and renders the existing Home/Player/Trophies clients with an explicit `teamId`/`seasonId`.
- A season that does not belong to the team, is unpublished (for anonymous), or does not exist renders "Not found" — never a fallback to the Tigers.
- Legacy links (`/`, `/player/?id=&season=`, `/trophies/?season=`): resolve the season → its team → redirect to the team route; seasons without a team (only before migration) keep rendering as today.

## 8. Rules and rollout order (no intermediate exposure)

Rules are written once for the final model and keep a **legacy branch** for the old app: `isLegacyAdmin()` (`admins/{uid}`) may still read/write the original coach's seasons (`ownerUid == that uid` or no `ownerUid` yet). Anonymous reads switch from "everything" to "published only" in the same release.

1. Fresh verified export; rehearse migration on emulator copy.
2. Deploy the new app with the feature flag off (reads still work under current rules).
3. Run the migration (ownership, team, published flags, private-field move).
4. Deploy the new rules (published-only public reads, ownership, invites). Old v1.3.0 app: its writes on the original coach's seasons still pass via the legacy branch; its public pages lose unpublished drafts only.
5. Enable Google sign-in in Firebase Auth (console), create the owner's invite, verify sign-in, then the test account's invite.
6. Retire the legacy branch and `app/config` after the old app is gone.

Hard rule: no second coach invite exists before step 4 is verified, so no state ever has two coaches under public-read rules.

## 9. Checkpoints

| | Content | Status |
|---|---|---|
| A | This document; routing spike | **Done** |
| Foundation | Privacy split tool + rehearsal, target rules + isolation tests, Auth record check, browser guard (`docs/PUBLIC_PRIVATE_DATA.md`) | **Done (2026-10-24)** |
| B | Google sign-in, invitations, workspaces, account linking (§10) | **Done in code/emulator (2026-10-26); not activated** |
| B+ | Admin data layer on the target rules (scoped queries, ownerUid/workspaceId on writes, audit to private/audit) — full Admin, Team Designer, Season Update, New Season Setup inside a selected team | **Next** |
| C | Tallies brand, landing, sign-in; team routes, team current season, publication, public projection, legacy redirects, Copy team link (§11) | **Done in code/emulator (2026-10-26); not activated** |
| D | First-run onboarding via existing setup | Pending (needs B+) |
| E | Full emulator/browser acceptance, privacy audit, migration rehearsal, runbook | Pending |

**OWNER decision P3 — release bundling:** the Admin redesign + draft deletion release (runbook §11) is still pending. Recommended: release it first, separately; the multi-coach rules build on that ruleset.

## 10. Checkpoint B — implemented (emulator only; nothing activated)

- **Flags** (`src/lib/features.ts`, build-time, default off): `NEXT_PUBLIC_FEATURE_MULTI_COACH` (Google-first Coach Login, workspace gate on `/admin`, `coach` session role) and `NEXT_PUBLIC_FEATURE_GOOGLE_LINK` ("Link Google account" in the existing Admin). Emulator builds may override per browser context (`localStorage bc:feature:*`); production code compiles that out (`BC_EMULATOR_BUILD` is always defined by `next.config.ts`). Flags only change presentation; Firestore rules decide access.
- **Invitation acceptance** needs no server: one client batch binds `coachInvites/{id}` to the caller, creates `coaches/{uid}` and a new `coachWorkspaces/{ws}`; `firestore.target.rules` check all three together using token claims (`sign_in_provider == google.com`, `email_verified`, `email`). An invite binds once; a coach record is created once (retries/concurrent tabs recover the same workspace); workspace ids are random (`ws_…`), never uid/email. Clients cannot create, list, or revoke invites.
- **Owner tools** (Admin SDK, emulator by default, `--allow-production` for real): `tools/coach-invites.mjs` (`--list`, `--create <email> --apply`, `--revoke <id> --apply`; revoking an accepted invite disables the coach); `tools/coach-workspace-migrate.mjs` (binds the verified original UID — must equal `admins/{uid}` — to the first workspace and adds `ownerUid`/`workspaceId` to existing teams and `ownerUid` to seasons; dry run, backup check, rollback file, idempotent).
- **Access**: `isCoach()` = active `coaches/{uid}` + active workspace; disabling either removes all private access.
- **Linking**: `linkGoogle()` uses `linkWithPopup` on the signed-in password account, refuses if the uid would change, never removes the password provider. Emulator: UID unchanged, providers `google.com,password`, both sign-ins land on the same account. A *first* Google sign-in without linking would (emulator) keep the UID but drop the password provider — the UI therefore tells password users to sign in with the password and link.
- **Browser tests** use an emulator-only credential seam (`window.__bcTestGoogleIdToken`) because Firebase's popup loads `apis.google.com`, which the production guard blocks. Real Google OAuth is not tested.

### Activation prerequisites (each needs approval)

1. Admin data layer on the target rules (B+) and Checkpoints C–D (routing, publication, onboarding); privacy split + target rules release (`docs/PUBLIC_PRIVATE_DATA.md` §5).
2. Enable the Google provider in Firebase Auth (console) and add the production domain to authorized domains.
3. Build with `NEXT_PUBLIC_FEATURE_GOOGLE_LINK=1`, deploy; the owner signs in with the password and links Google; read-only check that the UID is unchanged and providers are `google.com,password`.
4. Fresh export → `coach-workspace-migrate.mjs` (rehearsed) → deploy target rules → build with `NEXT_PUBLIC_FEATURE_MULTI_COACH=1`.
5. `coach-invites.mjs --create <test account> --apply`; later the brother-in-law's address once supplied and approved.

### Limitations

- With multi-coach on, `/admin` shows the workspace landing (own teams) only; team/season management on the target rules is B+. The legacy Admin keeps working with the flag off.
- Revocation takes effect on the next request (rules read `coaches/{uid}`); it does not revoke Firebase sessions.
- Email used for matching is the token email; a coach changing their Google email keeps access (bound by UID) but cannot accept a second invite.

## 11. Checkpoint C — Tallies brand and team routing (emulator only; nothing activated)

Everything below is behind `NEXT_PUBLIC_FEATURE_MULTI_COACH` (= "Tallies mode", off in production). With it off the app is the existing Baseball Coach, unchanged (browser-tested).

**Brand.** Wordmark: lowercase `tallies` in Bubblegum Sans (Sudtipos / Angel Koziupa & Alejandro Paul, SIL OFL 1.1, Reserved Font Name "Bubblegum Sans"). Latin WOFF2 as distributed by Google Fonts, self-hosted via `next/font/local` (`src/app/fonts/`, `preload: false` so legacy pages never fetch it); license beside the font and served at `/licenses/BubblegumSans-OFL.txt`. No final period (the tagline ends in one; the bare word reads better at header sizes). Symbol: five-bar tally gate on a coral tile (`TallyMark`), legible at 16 px. Palette (ink #221B3A, cream #FFF8EE, coral #EF4F5A, sunshine #FFB627, teal #1F9D8B), scoped to `.tallies`; team themes and the Tigers are untouched. The favicon and `<title>` metadata are still Baseball Coach's (shared static files) — swap them when the Tallies site is deployed.

**Routes (static export).** `/teams/{teamId}/` = the team's *published* current season (the permanent parent link); `/teams/{teamId}/seasons/{seasonId}/home|trophies`, `…/players/{playerId}` (stats, career, recognition sheet, print). One prerendered shell (`src/app/teams/[[...path]]`) + Hosting rewrite `/teams/** → /teams/index.html`; `src/lib/teamScope.tsx` parses the path, reads `publicTeams/{teamId}`, and verifies the season is a published season of that team before anything renders. Unknown/unpublished/foreign ids → "Team page not found"; nothing published → "no season yet" with published history. Never app/config, never the Tigers default. Old links (`/player?id=&season=`, `/trophies?season=`, `/?season=`) redirect to the team route when that season is published.

**Team current season.** `teams/{t}.currentSeasonId` only (`setTeamCurrentSeason`): the season must be this team's and this owner's; a draft is activated in the same transaction (audit in `private/audit`); finalized must be reopened first. `app/config` is neither read nor written.

**Publication.** `seasons/{s}.published` is separate from status (`setSeasonPublished`). Drafts can't be published. `publicTeams/{t}.currentSeasonId` = the team's current season *if published*, else null (rules compute this exactly), so an activated-but-unpublished season is never revealed. Unpublishing is refused by rules unless the public pointer is cleared in the same batch. Public `careerLinks` are recomputed on every publication change (unpublish: links stripped first; publish: added after), including on finalized seasons (rules allow a links-only update there, ≤ 25 links).

**Coach workspace.** `/admin` (Tallies frame): own teams → `/admin/?team={id}`: Copy team link (`https://<site>/teams/{id}/` — no uid, email, season, name, division, location), View parent page, per-season Make current / Activate and make current / Publish / Unpublish. Another coach's id in the URL → "Team not found" (rules). Password-only coach sees "Link Google account". **Not yet in Tallies mode (B+):** stats entry, roster, lineups, awards, lifecycle, Team Designer, New Season Setup, My Players, team creation for an empty workspace.

**Rules (`firestore.target.rules` only).** `publishedCurrentAfter()` for `publicTeams` (all public branding fields must equal the team's); unpublish guard in `isPublicationChange(seasonId)`; `validCareerLinks`; links-only player update on finalized seasons. `firestore.rules`/`firebase.json` unchanged.

**Hosting plan.** `firebase.tallies.json` targets only site `talllies` (three Ls), rewrites `/teams/**` first, deploys no rules. Future deploy (separate approval): `NEXT_PUBLIC_FEATURE_MULTI_COACH=1 next build` then `firebase deploy --only hosting --config firebase.tallies.json --project baseball-coach-997ab --account mikecbauervision@gmail.com`. Its CSP adds what Google sign-in needs (apis.google.com, accounts.google.com, the auth domain frame) — verify against real OAuth before relying on it. `bauer-baseball` is untouched by that command.

### Production prerequisites (each separately approved)

1. Checkpoint B+ (Admin on the target rules) and D (onboarding), so coaches can run a season in Tallies mode.
2. Ownership/publication backfill tool (not built yet): Tigers `teams` doc + `publicTeams`, `teamId`/`ownerUid`/`published` on the 2026 seasons (Falcons draft unpublished), `teams/{t}.currentSeasonId` from app/config; then the privacy split (careerLinks).
3. §10 steps 2–5 (Google provider, authorized domain `talllies.web.app`, explicit owner link, workspace migration, target rules) — order in `docs/PUBLIC_PRIVATE_DATA.md` §5.
4. Tallies Hosting deploy to `talllies` with the flag on; legacy `bauer-baseball` retired or redirected afterwards (decision pending).

### Limitations

- Real Google OAuth, the Tallies CSP, and the `talllies` domain are untested (emulator credential seam only).
- careerLinks hygiene is enforced by the app's publish/unpublish flow; rules guarantee unpublished seasons are unreadable but cannot inspect each link entry.
