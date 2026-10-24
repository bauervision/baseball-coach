# Production Preservation & Identity Audit — Runbook

*2026-10-22 · Every production step below is **read-only** and needs explicit product-owner authorization first. Nothing here writes to production.*

Project `baseball-coach-997ab`, database `(default)`, location `us-east1` (from `.firebaserc` and `firebase.json`).

## 0. Preconditions

- Run from the repository root in Git Bash. Make sure `FIRESTORE_EMULATOR_HOST` is **unset** (`echo $FIRESTORE_EMULATOR_HOST` prints nothing).
- The tools authenticate with Application Default Credentials (`gcloud auth application-default login`). The account needs Firestore read access (`roles/datastore.viewer`) and, for the backup checks, `roles/datastore.backupsViewer` or equivalent. The tools never read `service-account.json`.
- Choose a protected folder **outside the repository**, owned by the current user only. The tools refuse to write exports, audit reports, or rollback files inside the repo.

```bash
OUT="/c/Users/mikec/BaseballCoachProtected/2026-10-22"
mkdir -p "$OUT"
icacls "C:\\Users\\mikec\\BaseballCoachProtected" /inheritance:r /grant:r "$USERNAME:(OI)(CI)F"
```

## 1. Backup and recovery status (read-only control-plane queries)

```bash
gcloud firestore databases describe --database="(default)" --project=baseball-coach-997ab \
  --format="yaml(locationId,pointInTimeRecoveryEnablement,versionRetentionPeriod,earliestVersionTime,deleteProtectionState)"
gcloud firestore backups schedules list --database="(default)" --project=baseball-coach-997ab
gcloud firestore backups list --location=us-east1 --project=baseball-coach-997ab
```

Record what these show. If any command is refused for lack of permission, record that setting as **Unverified**. Do not enable or change anything.

## 2. Complete read-only export

```bash
node tools/export-firestore.mjs --project baseball-coach-997ab --allow-production-read \
  --out "$OUT/prod-export.json"
```

**What it reads:** every root collection and subcollection (`listCollections`, `listDocuments`, `get`), followed by server-side `count()` aggregates. It makes **no writes**.

**What it produces:** `prod-export.json` plus `prod-export.json.sha256`. It refuses to overwrite either file and refuses paths inside the repo.

**Integrity check:** the exporter compares exported document counts with server counts, per root collection and for the `players`, `games`, `lines`, and `lineups` collection groups. On any mismatch it exits with code 5.

**Console output:** collection paths and counts only, never names.

**Missing-but-populated documents:** a season doc that is missing while its players or games still exist is reported as "Season docs missing but with data beneath". This is the key evidence for whether Spring 2026 was overwritten or deleted.

**Size and cost:** one read per document plus one call per collection. For this app that means a few thousand reads at most.

## 3. Offline analysis (no Firestore access)

```bash
node tools/season-inventory.mjs --from-json "$OUT/prod-export.json"
node tools/identity-audit.mjs  --from-json "$OUT/prod-export.json" --out-dir "$OUT/audit"
```

**Season inventory:** one row per season. Columns:
- label, team, league;
- record, the `gamesPlayed` field, scheduled games;
- actual game docs, orphaned games, game lines;
- roster size, roster docs with a career ID, confirmed roster docs;
- `coachUids`, `endSeasonMode`, final awards, recognition layouts, lineups;
- unknown subcollections, `createdAt`.

**Identity audit:** `identity-audit.json` holds the proposals, conflicts, possible duplicates, missing IDs, and orphaned lines. `identity-approvals.json` holds every proposal as **pending**. The product owner edits that file. Nothing is ever approved automatically.

## 4. Restore and migration rehearsal (emulator copy only)

```bash
# terminal 1
npx firebase emulators:start --only firestore --project demo-baseball-coach
# terminal 2
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085
node tools/restore-to-emulator.mjs --project demo-baseball-coach --from-json "$OUT/prod-export.json"
node tools/export-firestore.mjs   --project demo-baseball-coach --out "$OUT/rehearsal-export.json"
node tools/identity-migrate.mjs   --project demo-baseball-coach --approvals "$OUT/audit/identity-approvals.json"
```

- The restore tool has no production mode. It checks the export's sha256 before writing, and it recreates missing-parent documents exactly as they were (subcollections only).
- While approvals are pending, the migration dry run must show `Planned updates: 0`.
- After the product owner approves specific proposals, rehearse `--apply`, re-run the dry run (it must be a no-op), and then `--rollback`, all against the emulator, using the rehearsal export as the backup.

## 5. Populating historical `coachUids` (single head coach), not yet authorized

Under the single-head-coach model, every season belongs to the one head coach. The backfill for each season doc that has no `coachUids`:

- sets `coachUids: [<headCoachUid>]`, where the uid is the head coach's `admins/{uid}`;
- is a merge write of that **one field only**;
- is done after a fresh verified export, rehearsed on the emulator copy first, and approved by the product owner.

Today this is **not needed for correct behavior**: seasons without `coachUids` are visible to the only admin. It **is** required before workspace isolation (roadmap E1). No tool performs it yet. When it is built, it should reuse the migration's backup check and identity-neutral verification.

## 6. Requirements before activating the private player registry

1. Product-owner review of the `firestore.rules` diff. It adds `playerIdentities` and `coachProfiles/{uid}/linkedPlayers`. The deployed ruleset was read on 2026-10-23: it is `firestore.rules` as of commit 09d0f60 (released 2026-08-16). See section 10 for the full comparison.
2. Deploy the rules on their own (`firebase deploy --only firestore:rules`) after the emulator rules tests pass (`npm run test:emulator`).
3. Apply the approved identity migration in the **same release** as the app build. Career history counts only confirmed seasons, so without the migration the returning players' Career toggle disappears.
4. Build with `NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY=1` and deploy.
5. Parent reads stay public until parent authentication ships (D1).

## 7. Managed-backup restore rehearsal (each step needs product-owner approval)

Status as of 2026-10-23: delete protection on; PITR on (7 days); daily (7d) and weekly Sunday (14w) schedules exist; first managed backup `READY` (daily, snapshot 2026-10-23 18:23 UTC). A completed backup is not a verified restore; this rehearsal has not been run.

1. List completed backups (read-only):
   `gcloud firestore backups list --location=us-east1 --project=baseball-coach-997ab`
2. Confirm the destination does not exist (`gcloud firestore databases list --project=baseball-coach-997ab`), then restore **into a new, separately named database**. Never into `(default)`:
   ```bash
   gcloud firestore databases restore --project=baseball-coach-997ab \
     --source-backup=projects/baseball-coach-997ab/locations/us-east1/backups/<BACKUP_ID> \
     --destination-database=restore-rehearsal-<yyyymmdd>
   ```
3. Export the restored database read-only and compare with a production export of the same period:
   `node tools/export-firestore.mjs --project baseball-coach-997ab --database restore-rehearsal-<yyyymmdd> --allow-production-read --out <protected>/restore-rehearsal.json`
   Differences are only expected for writes made between the backup's `snapshotTime` and the comparison export.
4. Delete the test database only after review (separate approval):
   `gcloud firestore databases delete --database=restore-rehearsal-<yyyymmdd> --project=baseball-coach-997ab`

## 8. Season lifecycle rollout (not executed; each step needs approval)

The app now supports `status: draft | active | finalized` on season docs, enforced by `firestore.rules`. Production seasons have **no status** today (legacy). That is compatible: legacy seasons stay open and editable, and the old `endSeasonMode` flag is shown as "Ended", never treated as finalized. No data migration is required; finalizing is a coach action in the app.

Recommended order:
1. **Identity migration and Spring 2026 metadata first.** They update historical roster/season docs, which is simplest while the seasons are still open. The migration tool uses the Admin SDK, which bypasses security rules; never run it against a finalized season without reopening it first.
2. **Rules before app.** Deploy the reviewed `firestore.rules` (`firebase deploy --only firestore:rules`), then the app build. Old rules would accept but not enforce lifecycle writes, so the app must not ship first. Legacy seasons behave the same under the new rules (verified on emulator).
3. **Finalize in the app.** The coach opens Admin → Season Update → Season Lifecycle and finalizes Spring 2026 (and Fall 2026 when review is complete), using the checklist. This writes only `status`, `finalizedAt`, `finalizedByUid`, `lifecycleHistory`, `updatedAt`.
4. **Spring 2027.** Create the season (draft) → build the roster → Make current (activates it). A finalized season cannot be made current until it is reopened.

Note: until the Spring 2026 metadata write, the app labels that season from legacy defaults ("Tigers", "Spring 2026"), which happen to be correct for the one legacy doc that lacks them.

## 9. Team Designer & branding rollout (not executed; each step needs approval)

The app now supports `teams/{teamId}` (team identity, sport, division, bundled logo, independent dark/light palettes, award collection) and a per-season `branding` snapshot. Production has no teams and no snapshots today; that is compatible:

- Seasons without a snapshot render with the deterministic legacy Tigers branding (the original tokens, logo, and Original award artwork). Verified pixel-identical against the pre-change baseline on emulator fixtures.
- No data migration is required to keep the Tigers looking the same.

Rollout order:
1. Review and deploy `firestore.rules` (teams are head-coach-only; snapshot fields are validated; a season's snapshot changes only via an explicit "apply team branding" that must equal the team's saved branding; finalized seasons can never change).
2. Deploy the app.
3. Optional, separately approved: create a "Tigers" team in Team Designer from the original colors. Linking the two 2026 seasons to it (writing `teamId` + `branding` snapshots onto historical season docs) is a data migration; do it before finalizing those seasons, or not at all — the legacy path already reproduces their appearance.

Limitations (current phase): bundled logos are the Tigers mark or team initials only; Girl Power, Boys of Summer, and Cyberball award collections are listed as Coming Soon (no artwork); softball uses the baseball stat model and terminology (see Team Designer report).

## 10. Controlled activation (prepared 2026-10-23; nothing executed, every write step needs approval)

### Verified production state (read-only, 2026-10-23)

- Credentials: isolated gcloud config (`CLOUDSDK_CONFIG=C:\Users\mikec\BaseballCoachProtected\gcloud-config`), account and ADC `mikecbauervision@gmail.com`, project and quota project `baseball-coach-997ab`.
- **Firebase CLI default login is a work account** (`firebase login:list`). Every `firebase deploy` below must pass `--account mikecbauervision@gmail.com`, or run `firebase login:use mikecbauervision@gmail.com` first.
- Protection: delete protection on; PITR on (7 days); daily (7d) and weekly Sunday (14w) schedules; one managed backup `READY` (2026-10-23 18:23 UTC), restore not yet rehearsed.
- Deployed rules: release `cloud.firestore` → ruleset created 2026-08-16, byte-identical to `firestore.rules` at 09d0f60 (copy: `tests/support/deployed-2026-08-16.firestore.rules`). No `teams`, `playerIdentities`, `coachProfiles`, lifecycle, or snapshot rules. That is the cause of "Missing or insufficient permissions" in Team Designer.
- Deployed app: Hosting site `bauer-baseball`, version `d83d27b0637b9138` released 2026-10-21 16:32 UTC (v1.3.0, code of ~2f129d2).
- Data: export `2026-10-23/prod-export.json` (sha256 `56ecd1bff9e28fac0ccbc71fec4faf379b1eba0f8aa97d7922568c3f8749a4c4`, counts verified: 1 admin, 1 config, 2 seasons, 23 players, 22 games, 217 lines, 2 lineups), identical document-for-document to the 2026-10-22 export.

### Compatibility (emulator)

| Direction | Result |
|---|---|
| Live app (2f129d2 code) writes under proposed rules, restored production copy | All 13 write calls (11 distinct paths) allowed; writes to a season the new app finalized are denied |
| New app under deployed rules | Team list/create denied (the observed bug); lifecycle **not enforced** (a "finalized" season stays writable) |
| New app under proposed rules, production-shaped fixture | Legacy seasons read with legacy labels and branding; stat entry, player edits, layouts, teams, draft setup, activation, finalize/reopen all work |
| Public read surface | Identical under deployed and proposed rules (config, seasons, players, games, lines, lineups); teams, identities, admins, and unknown season subcollections are not public |
| Live app reading migrated player docs | Reads all 23 |

**Order: data corrections → rules → app.** Rules-first is safe for the live app; app-first is not (Team Designer fails, lifecycle unenforced).

### Release sequence

| # | Step | Prod access | Reversible | Verify | Stop if |
|---|---|---|---|---|---|
| 0 | Preflight: `gcloud config list`, ADC tokeninfo email, `firebase login:list`, `echo $FIRESTORE_EMULATOR_HOST` (empty), §1 commands, Rules API release still the 2026-08-16 ruleset, Hosting still `d83d27b0637b9138` | Read | — | All match this section | Any identity, project, protection, ruleset, or version differs |
| 1 | Freeze: coach does not use the live site or localhost (same database) until step 7. Never finalize or use Team Designer/setup on localhost before step 5 | — | — | — | — |
| 2 | Fresh export: §2 command into a new protected folder; diff against 2026-10-23 export | Read | — | `Count verification passed`; diff shows only known coach activity | Unexplained differences |
| 3 | Identity migration: dry run must show **exactly 8** ops (4 Spring links, 4 Fall confirmations, ids `254afa52…`, `c2aebfcb…`, `ef3b786c…`, `35b9ace9…`); then `--backup <step-2 export> --apply --allow-production` | Write (8 player docs, 3 fields max each; Admin SDK) | Yes: `--rollback <file>` | Tool prints `Verified`; re-dry-run `Planned updates: 0`; export diff = identity fields on 8 docs only | Any other op count, plan errors, VERIFY FAILED |
| 4 | Spring 2026 metadata: `node tools/spring-2026-metadata.mjs --project baseball-coach-997ab --allow-production` (dry run prints token), then `--backup <export> --expect-update-time <token> --apply` | Write (`seasons/tigers-2026` teamName, seasonLabel only) | Yes: `--rollback <file>` | Tool prints `only teamName and seasonLabel were added` | Precondition failed (fields present with other values), stale token |
| 5 | Rules: `npx firebase deploy --only firestore:rules --project baseball-coach-997ab --account mikecbauervision@gmail.com` | Write (security rules) | Yes: redeploy the 2026-08-16 copy (only while the old app is live) | Rules API shows the new ruleset; public pages and the live admin still load and save | Deploy error, any public page or live-admin save failing |
| 6 | App: `npm run deploy` (registry flag **off**) | Write (Hosting) | Yes: Hosting rollback to `d83d27b0637b9138` | Footer version, Spring 2026 label, Team Designer lists (no permission error), career toggle for the 4 returning players, sheets print one 8×10 page | Any permission or loading error |
| 7 | Post-release check by the coach, then unfreeze | Read (+ intended coach use) | — | As step 6 | — |
| 8 | Registry flag (`NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY=1`) | Write (Hosting) | Yes: redeploy without flag | My Players links | Separate approval, not part of this release |

Coach actions afterwards (in the app, ordinary use): finalize Spring 2026 when reviewed; create Spring 2027 through New Season Setup (draft until "Make this the current season").

### Mixed versions (old and new app on one database)

- Browsers may keep the old app until refreshed. Under the new rules the old app keeps working on open seasons; it cannot change a finalized season (shows its generic save error).
- The old app's season switcher writes `teamName`/`seasonLabel` onto the target season. The proposed rules only accept `app/config.currentSeasonId` pointing at an existing season that is not a draft or finalized after the write, so a stale session can no longer make a draft current (activation is required) or a finalized one current (reopen first); its switches between legacy seasons still work (`tests/emulator/currentSeasonSafety.test.mjs`).
- Never revert rules (step 5) while the new app is live: Team Designer and lifecycle protection would break. Roll back the app first.

### Recovery

- Data: identity and Spring rollback files (written next to the backup export); protected exports; PITR (7 days) or managed-backup restore **into a new database** (§7), then repair from the comparison. Never restore into `(default)`.
- Rules: redeploy `tests/support/deployed-2026-08-16.firestore.rules` (app rolled back first).
- App: Hosting rollback to the previous version.

## 11. Draft season deletion release (prepared 2026-10-24; not deployed)

What changes in `firestore.rules` (vs the ruleset live since 2026-10-23, copy in `tests/support/deployed-2026-10-23.firestore.rules`):

- New lifecycle state `deleting`: a draft is locked (`draft → deleting`, audited `deletionStarted`) only if it is not current and its season doc has no games played, record, end-of-season flag, final awards, or recognition layouts. While locked, the season cannot be edited, activated, made current, finalized, or given new roster entries or records; it can only be cancelled back to `draft` (audited `deletionCancelled`) or have roster entries and the season doc deleted.
- Season docs can be deleted **only** in `deleting` and only when not current. Previously the coach could delete any non-finalized season directly.
- Games, lines, lineups, and unknown season subcollections are rejected on drafts (and on seasons that do not exist); roster entries require an existing season. So a draft can never hold records the client cannot enumerate.
- `app/config.currentSeasonId` also refuses `deleting` seasons.

Compatibility (emulator): the live v1.3.0 code passes all 13 legitimate write calls on a restored production copy; full emulator suite and browser suites pass.

Limits: rules cannot prove subcollections are empty. The guarantee covers every write made through the rules (the apps). Admin SDK writes bypass rules: the deletion re-checks games, lineups, and roster stats after locking and cancels if anything is there, but documents in unknown subcollections or orphaned lines under a missing game written by an Admin SDK tool would not be seen (they would be left in place, not deleted).

Release order (each step needs approval):

1. Preflight as §10 step 0 (identity, protection, live ruleset = `aac256a2…` / sha256 `25053a96…438d18`, Hosting version).
2. Fresh read-only export. For the draft to be deleted (e.g. the Falcons Spring 2027 test draft) confirm from the export: `status: "draft"`, not `app/config.currentSeasonId`, no `games`, `lineups`, or other subcollections besides `players`, roster stats all zero, no awards or layouts. Expect the export to include the coach's intentional additions since 2026-10-23 (teams, the draft, its roster entries); compare against the 2026-10-23 export and explain every difference.
3. Deploy rules (`--only firestore:rules`, `--account mikecbauervision@gmail.com`), read back and compare.
4. Deploy the app (draft deletion UI needs the new rules; the new rules work with the live app, so rules go first).
5. The coach deletes the draft in Season Update → Draft seasons (typed confirmation). Verify with a read-only export diff: only that season and its `players` docs are gone.

Rollback: rules → Rules console history (previous ruleset `aac256a2-4178-42e1-8124-b6d56d4fa78b`), app → Hosting rollback. A deleted draft is restored only from the pre-deletion export or PITR (7 days).
