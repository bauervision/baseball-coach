# Tallies Production Migration — Tooling & Data Preservation (Checkpoint D1)

*2026-10-27 · Tooling and local verification only. **Nothing here has been run against production**: no production read, write, export, backup, Auth change, rules or Hosting deploy. Every production step below is a proposal that needs its own approval.*

Tool: `tools/tallies-migrate.mjs` (CLI) with `tools/tallies-migration/` (`model.mjs` plan, `inventory.mjs` inspect, `verify.mjs` reconciliation, `emulator.mjs` the only database access). Tests: `tests/talliesMigration.test.mjs` (pure), `tests/emulator/talliesMigration.test.mjs` (CLI end to end + target rules), `tests/browser/talliesMigration.test.mjs` (legacy pages vs. Tallies routes after migration).

## 1. Source data (verified offline)

The real structure was checked **offline** against the protected export `2026-10-26/prod-export-after-hosting.json` (no Firestore access; field names, ids, and counts only — no names printed): 1 admin, `app/config` (current `tigers-fall-2026`), 3 seasons, 28 roster entries, 22 games, 217 lines, 2 lineups, 1 team.

| Season | Team | Status | Notes |
|---|---|---|---|
| `tigers-2026` (Spring 2026) | none (legacy) | none (legacy, open) | no `teamName`/`seasonLabel`; dotted `record.wins/losses`; 31-key stats; `p01`-style ids; no career ids yet (identity migration pending) |
| `tigers-fall-2026` (Fall 2026) | none (legacy) | none (legacy, open) | current in `app/config`; 8 layouts; 10 game balls; 6 lineup snapshots; career ids unconfirmed |
| `falcons-spring-2027` | `falcons-bwnb` | draft | season doc carries `coachUids`; **5 roster entries keyed by their permanent identity id**; no games/lineups |

Not present in production: a Tigers team document, any `ownerUid`/`published`/`publicTeams`, coach records/workspaces, private sub-documents. Spring 2026 is **not** finalized in production today; the tool handles both (the fixture finalizes it).

The representative fixture (`tests/support/talliesMigrationFixture.mjs`) reproduces these shapes with invented names: production-shaped Tigers (finalized Spring), a Falcons team without owner, and an identity-keyed draft that links to Tigers entries.

## 2. Source → destination mapping

In place, same database. Season, game, line, and lineup ids are kept.

| Source | Destination | Transformation |
|---|---|---|
| teamless seasons (`teamId` missing) | `teams/{t_…}` **created**: the legacy team | name from the seasons' `teamName` (else the legacy app's default "Tigers"); sport, division, logo, palettes, award collection = `LEGACY_TIGERS_BRANDING` (what the legacy app renders for those seasons); `ownerUid`, `workspaceId` from the bound owner; id opaque `t_` + 20 hex, deterministic for the set of legacy season ids, derived from no name/uid/email |
| `app/config.currentSeasonId` (read only) | `teams/{t}.currentSeasonId` | if that season is the team's and not draft/finalized/deleting; else blocked (or `--accept-no-current`) |
| `teams/{t}` (Falcons) | same doc | + `ownerUid`, `workspaceId` (immutable from now); branding unchanged |
| — | `publicTeams/{t}` **created** per team | branding projection + `currentSeasonId` only if that season is published |
| `seasons/{s}` | same doc | + `teamId` (legacy → legacy team), + `ownerUid`, + `published`; `lifecycleHistory`, `finalizedByUid`, `reopenedByUid`, `coachUids` → `seasons/{s}/private/audit` |
| `seasons/{s}/players/{p}` | same doc | `shirtSize`, `careerPlayerId`, `identityStatus`, `identityMigration`, `linkedFrom` → `…/players/{p}/private/profile`; + `careerLinks` (published seasons only, the app's own algorithm) |
| identity-keyed roster entry (id contains its `careerPlayerId`) | `…/players/sp_{20 hex}` | re-keyed to the app's opaque id `sp_` + SHA-256(seasonId ∖0 careerPlayerId) (same as `seasonPlayerDocId`); only when nothing refers to the old id (no games, lineups, awards, layouts, links) — otherwise blocked |
| games, lines, lineups, stats, awards, layouts, status, lifecycle timestamps, branding snapshots, `app/config`, `admins`, everything else | unchanged | verified equal |
| — | `migrationRuns/tallies-d1` (ledger) | Admin-SDK-only (no rule matches → clients denied): state, target digest, owner, legacy team, progress, conflicts |

Expected destination for the production shape (offline plan, owner unbound so blocked): 69 operations — 29 private documents, 1 team created, 1 team updated, 3 seasons updated, 23 roster entries updated, 5 re-keyed (5 created, 5 deleted), 2 public team summaries.

### Decisions (each reviewable in the plan's `decisions`)

- **Publication.** Legacy seasons parents can see today → `published: true` (both Tigers 2026 seasons). Everything else unpublished: the Falcons draft stays unpublished; non-legacy seasons wait for the coach. An existing `published` flag is always kept. Nothing is published because it is current.
- **Current vs. published** stay separate: the team's current season comes from the legacy setting; publication from the rule above.
- **Finalized seasons.** Only ownership, publication, and privacy-location fields change (`teamId`, `ownerUid`, `published`, the audit move, `careerLinks`); status, `finalizedAt`, stats, games, lines, lineups, awards, and layouts are verified unchanged. No reopen, no recalculation. *Owner decision:* this is the minimum the target rules need for a finalized season to be readable and owned.
- **Branding.** Legacy seasons keep no snapshot (the app renders them with the legacy branding regardless of later team edits); seasons with snapshots keep theirs.
- **Legacy roster ids are kept** (`p01`, `21-alex-rivera`): every game line, award, lineup, layout, and link refers to them, and the finalized history must not be rewritten. They contain the publicly displayed name and number only — no private field. New entries get opaque ids. Only identity-keyed ids (which expose the private permanent id) are re-keyed.
- **Spring 2026 labels.** Not written by this migration; the app's legacy defaults apply (approved separately as `tools/spring-2026-metadata.mjs`).
- **Cross-team career links** (Falcons entries → Tigers seasons) are kept as the app itself computes them for one owner; they only ever point at published seasons.

### Blockers (the plan refuses to apply)

Owner missing / not the single `admins` doc / not bound to an active coach record and workspace (`coach-workspace-migrate.mjs` first); any team or season owned by someone else; a second team with the legacy team's name (unless adopted with `--legacy-team <id>`, never duplicated); teamless seasons naming different teams; a season `teamId` without a team; a branding snapshot of another team; invalid status or `published`; a published draft; legacy current season missing or not eligible; unknown season sub-collections or missing parent documents; a private record or public projection that already holds a different value; an unsafe or colliding re-key; a team with fields the rules reject. Warnings (applied as-is, reported): missing labels, dangling award/line/lineup references, unexpected root collections, malformed values (preserved exactly).

## 3. Commands

```bash
npm run tallies:migrate -- inspect  --from-json <export.json> --out <dir>/inventory.json
npm run tallies:migrate -- plan     --from-json <export.json> --owner-uid <verified uid> --out <dir>/plan.json
npm run tallies:migrate -- apply    --project demo-… --plan <dir>/plan.json --backup <dir>/export.json
npm run tallies:migrate -- verify   --source <pre-export.json> --project demo-… --out <dir>/verify.json
npm run tallies:migrate -- rollback --project demo-… --rollback <dir>/tallies-d1-…-rollback.json
```

`inspect`, `plan`, and `verify` read an export file offline or the emulator; `apply` and `rollback` write the emulator only. Every output holds child data: it must be outside the repository (enforced) and is never overwritten. The console shows counts, season/team ids, and finding codes; roster ids and uids are redacted. Exit codes: 2 refused (usage/environment), 3 blocked plan, 4 verification failed, 5 conflict, 6 interrupted.

## 4. Production safety (structural)

- `emulator.mjs` is the only module that opens a database and has **no production branch**: no `--allow-production`, no credentials, no shared connector. Unknown options (including `--allow-production`) are rejected.
- Before a client is created: `FIRESTORE_EMULATOR_HOST` must be a loopback `host:port`; `--project` must be `demo-…` and never the production id; `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT`/`FIREBASE_PROJECT`/`FIREBASE_CONFIG` must not name another project; `GOOGLE_APPLICATION_CREDENTIALS` must be unset; the host must answer as a Firestore emulator. The client is then pinned to that host. Any doubt fails closed.
- Enabling production later is an **implementation change** in `emulator.mjs` (a reviewed connector with its own preflight), not a flag. Source guards in the unit tests fail if a production path appears.

## 5. Idempotency, conflicts, recovery

- **Desired state, not a script.** The plan is the field-level difference between the current state and a desired end state that is a pure function of the source. Applied to its own result it is unchanged, so a re-plan after a complete run is empty, and after a partial run lists exactly the remainder.
- **Target digest.** The plan carries a digest of the desired end state. `apply` refuses unless the backup and the live database both produce that digest — so a change by the coach after review, or a backup of another source, stops the run before anything is written.
- **Per-document classification** inside each transaction: already in the after-state → *unchanged*; in the planned before-state → *written*; anything else → *conflict*: the chunk is abandoned, the ledger is marked `blocked` with the paths and fields, and nothing is overwritten. Results are reported as created / updated / deleted / unchanged / conflict.
- **Ordering.** Private copies first, then teams, seasons, roster entries (re-keyed entries created together with their private profile), old ids deleted, public projections last. Transactions never split a document from its private record, so an interruption never leaves an orphan.
- **Interrupted run:** re-run `plan` + `apply` (or `apply` with the original plan). **Manual recovery** is needed only after a conflict: compare the listed documents with the backup, restore them to their backup values (or roll back), then re-run.

## 6. Verification (`verify`)

Canonical comparison of the pre-migration export with the destination (private fields merged back, migration-only fields set aside, re-keyed ids mapped back) plus re-derived invariants; machine-readable JSON + a PASS/FAIL summary; any unexplained difference fails. Checks: context; season ids and documents; season states; rosters (identity in private records); games and W/L/T; game lines, stats, per-player totals from lines, records; lineups and snapshots; awards and recognition (and that each reference resolves as before); career links (equal to the private identity and to the source career view; published targets only); team branding; ownership; publication; current season (`app/config` untouched); public team summaries; privacy (no private field public; no public id or field holding a permanent id); historical routing (every legacy player link has a destination); everything else unchanged and no unexplained documents.

## 7. Backup and rollback design

**Tested on the emulator** (D1): rollback after a full apply and after an interrupted apply returns a database byte-identical to the backup (ledger aside, marked `rolled-back`), and the migration can be re-applied afterwards. Rollback undoes each operation only while the document is still exactly in its migrated state; a document changed since is a conflict left for manual review — never overwritten, never automatic.

**Proposed for production (not executed, not verified against production):**

| Step | How | Verified by |
|---|---|---|
| Collections to back up | everything: `admins`, `app`, `seasons/**` (players, private, games, lines, lineups), `teams`, `publicTeams`, `coaches`, `coachWorkspaces`, `coachInvites`, `playerIdentities`, `coachProfiles` | export walks every collection and sub-collection |
| Consistent snapshot | freeze (no coach use of the live site or localhost), then `tools/export-firestore.mjs --allow-production-read` into a new protected folder; PITR (7 days) and the scheduled managed backups as a second copy | count verification against server aggregates (exit 5 on mismatch) + `.sha256` |
| Completeness | the export's desired end state must equal the plan's target digest and the live database's at apply time (`apply` refuses otherwise) | built into `apply` |
| Reconciliation | `verify --source <export>` against the database after apply (and a fresh read-only export) | JSON report, PASS required |
| Manifests | plan, rollback file, verification report, export + sha256 in the protected folder (outside Git), kept at least until the old app is retired; the `migrationRuns/tallies-d1` ledger stays in the database | file hashes recorded in the release notes |
| Partial migration | re-run plan + apply (resumes); or `rollback` with the rollback file | ledger `state`/`progress`/`conflicts` |
| Live app during recovery | the migration runs before the target rules are deployed; the v1.3.x app keeps reading the same documents (legacy readers lose shirt sizes only, as in `PUBLIC_PRIVATE_DATA.md` §4). Never deploy target rules on a half-migrated database | — |
| Reversible | every field write, team/public/private document creation, and re-key (rollback file) | emulator-tested |
| Manual only | documents edited after the migration (conflicts), restoring a managed backup (into a **new** database, never `(default)`), PITR | — |

A production rollback would need the same production connector approval as apply; there is no automatic destructive rollback.

## 8. Production prerequisites and proposed order (each step separately approved)

1. Owner links Google to the existing account; read-only check that the uid is unchanged (`MULTI_COACH_ARCHITECTURE.md` §10).
2. Fresh verified export; offline `inspect` + `plan` against it; owner reviews the plan.
3. `coach-workspace-migrate.mjs` (binds the owner's coach record and workspace); identity migration and Spring 2026 metadata if still wanted (they write historical docs, simplest before this migration).
4. Rehearsal: restore the fresh export into the emulator, run plan → apply → verify → rollback → apply there; the browser suite against it.
5. Implementation change enabling a reviewed production connector in `emulator.mjs` (a new checkpoint), freeze, export, apply, verify, read-only export diff.
6. Deploy `firestore.target.rules`, then the Tallies Hosting (`firebase.tallies.json`, site `talllies`); the legacy `bauer-baseball` site keeps working on the migrated data until retired.

## 9. Remaining risks

- Production data can change between this inventory and the migration (the coach's ongoing use); the target digest makes that a refusal, not a corruption, but a new plan review is then needed.
- The real owner uid binding (Google link, coach record) is unverified until step 1/3.
- Admin SDK writes bypass rules; correctness rests on the tool's own checks and `verify` (both tested here only on the emulator and on the fixture/offline shape).
- Legacy roster ids keep names visible in URLs (as today); only identity-keyed ids are re-keyed.
- Cross-team career links rely on the app's algorithm and are re-computed on every publication change.
- Production rollback, managed-backup restore, and PITR are documented, not exercised.
