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
