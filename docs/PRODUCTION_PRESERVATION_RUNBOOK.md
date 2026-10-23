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

1. Product-owner review of the `firestore.rules` diff. It adds `playerIdentities` and `coachProfiles/{uid}/linkedPlayers`, and leaves `/seasons` unchanged. Note that whether the deployed rules match the repo is **unverified**; check in the console.
2. Deploy the rules on their own (`firebase deploy --only firestore:rules`) after the emulator rules tests pass (`npm run test:emulator`).
3. Apply the approved identity migration in the **same release** as the app build. Career history counts only confirmed seasons, so without the migration the returning players' Career toggle disappears.
4. Build with `NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY=1` and deploy.
5. Parent reads stay public until parent authentication ships (D1).

## 7. Managed-backup restore rehearsal (each step needs product-owner approval)

Status as of 2026-10-22: delete protection on; PITR on (7 days); daily (7d) and weekly Sunday (14w) schedules exist; first completed backup pending.

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
