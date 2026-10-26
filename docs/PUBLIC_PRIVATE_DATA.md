# Public/Private Data Separation & Multi-Coach Security Foundation

*2026-10-24 · Stages C–F of the production-baseline phase. Nothing here is deployed or applied to production. Companion to `docs/MULTI_COACH_ARCHITECTURE.md`; target rules in `firestore.target.rules`; migration in `tools/privacy-split-migrate.mjs`.*

## 1. Field inventory (production schema, verified against the 2026-10-24 export)

Firestore rules cannot hide fields: a readable document is readable whole. "Today" is the deployed rules (all of `/seasons/**` and `app/config` world-readable).

| Document | Field(s) | Class | Today |
|---|---|---|---|
| `seasons/{s}` | teamName, seasonLabel, league, record (+ legacy `record.wins/losses`), gamesPlayed, scheduledGames, usesGamesPlayedRecord, endSeasonMode, finalAwards, recognitionLayouts, branding, status, finalizedAt/reopenedAt/activatedAt, createdAt/updatedAt | Public (published seasons) | public |
| `seasons/{s}` | teamId, ownerUid (target), published (target) | Internal (needed by rules/routing; non-personal) | public |
| `seasons/{s}` | lifecycleHistory (byUid), finalizedByUid, reopenedByUid, coachUids | **Private** (coach UIDs, audit) | public |
| `seasons/{s}/players/{p}` | id, name, number, bats, throws, primaryPos, returningPlayer, leaderboardHidden, stats, createdAt/updatedAt | Public | public |
| `seasons/{s}/players/{p}` | shirtSize | **Private** | public |
| `seasons/{s}/players/{p}` | careerPlayerId, identityStatus, identityMigration, linkedFrom | **Private** (permanent identity + links) | public |
| `seasons/{s}/games/{g}` | date, opponent, result, score, gameType, coachAwards, gameBall, lineupSnapshot, created/updatedAt | Public (published) | public |
| `…/games/{g}/lines/{p}` | playerId, name, number, delta | Public (published) | public |
| `seasons/{s}/lineups/current` | rows (positions), inningCount, title, timestamps | Public (published; shown on team home) | public |
| `teams/{t}` | branding, ownerUid, workspaceId, currentSeasonId | Private (coach); parents get `publicTeams/{t}` | coach only |
| `playerIdentities/{id}` | displayName, managerUids, createdByUid | Private | coach only |
| `coachProfiles/{uid}/linkedPlayers/*` | child links | Private | owner only |
| `admins/{uid}` | enabled | Internal | self only |
| `app/config` | currentSeasonId, updatedAt | Internal (legacy) | public |

Not present in production: private coach notes (no such field exists).

## 2. Schema (minimal relocation; ids unchanged)

- `seasons/{s}/players/{p}/private/profile` ← shirtSize, careerPlayerId, identityStatus, identityMigration, linkedFrom (owner only).
- `seasons/{s}/private/audit` ← lifecycleHistory, finalizedByUid, reopenedByUid, coachUids (owner only, append-only history).
- Public roster entries gain `careerLinks: [{seasonId, seasonPlayerId}]`: the other seasons the app's career view shows for that entry (same algorithm as `resolveCareerParticipations`), never draft/deleting seasons. Public career pages follow these links instead of querying `careerPlayerId`.
- Seasons gain `ownerUid` (immutable), `published` (boolean, explicit, never true for draft/deleting); teams gain `ownerUid`, `workspaceId`, `currentSeasonId`; new `publicTeams/{t}` projection; `coaches/{uid}`, `coachWorkspaces/{w}`, `coachInvites/{i}` (Checkpoint B).
- Games, lines, lineups, awards, layouts, stats, branding snapshots: unchanged.

## 3. Migration (`tools/privacy-split-migrate.mjs`)

Dry run by default; `--apply` needs a verified export < 24 h old and writes a rollback file first; `--allow-production` required for a real project; verify after apply (re-plan empty, values moved exactly, every other field unchanged, stats/games digest unchanged); refuses if a private doc already holds a different value; `--rollback` restores exactly.

Rehearsal on an emulator copy of the 2026-10-24 production export (275 docs): plan 29 ops (28 roster entries, 1 season `coachUids`); apply verified; 0 private fields left in public docs; 0 public links to unpublished drafts; re-run 0 ops; rollback → byte-identical to the restored copy.

Ownership/publication backfill (`ownerUid`, `teamId` for the 2026 Tigers seasons, `published`) is a separate, later migration (Checkpoint B), after the owner's UID is confirmed post-link (§5).

## 4. Mixed-version analysis

Versions that can share the database: **V1** = live v1.3.0 app; **V2** = current repo app (Admin redesign + draft deletion, rules in `firestore.rules`); **V3** = future multi-coach app (`firestore.target.rules`).

| Question | Finding |
|---|---|
| Old app writes incompatible docs? | Yes after the split: V1/V2 `savePlayerEdits`/`rebuildRoster` write `shirtSize`/`careerPlayerId` into public player docs. The target rules **reject** those writes (fail closed), so fields cannot be re-exposed — but those V1/V2 actions stop working. V1/V2 stat entry, games, lineups, layouts, awards, season switching on own seasons keep working (tested). |
| Public reads expose fields after migration? | Only if the split runs while the **current** rules are live and V1/V2 keep writing private fields back. Hence: split only together with/after a rules release that rejects private fields in public docs. |
| New rules break old app? | Target rules break V1/V2 for: player edits/roster rebuild (private fields), creating seasons without `ownerUid`/`teamId`, lifecycle actions (audit moved), draft deletion (audit moved). So V3 rules ship only together with the V3 app; V1/V2 must be retired (Hosting replaced) at that point. |
| Anonymous access to drafts? | Target: denied (`published` never true for drafts; reads require `published == true`). Today: drafts are publicly readable (Falcons draft included). |
| Coach reads another coach's records? | Target: denied (tested both directions). Today: a second coach cannot exist (no invites) — invitations must not be created before target rules are live. |
| Global config overrides team state? | Target: no — routing reads `teams/{t}.currentSeasonId`; `app/config` is writable only by the legacy coach, for that coach's own eligible seasons, and is never read for routing. Removal: when V1/V2 are retired. |
| Interrupted migration leaves mixed records? | The split is batched (≤ 200 docs per commit) and idempotent: a re-run finishes the remaining docs; until then both shapes exist side by side, so V3 must read the private doc first and fall back to the public fields (design requirement for V3; not built yet). Rollback file restores the pre-state. During an interrupted run under current rules, moved docs are *less* exposed, never more. |

Conclusion: the previously proposed order "deploy app → migrate → deploy rules" is **not safe** for the split (V1/V2 could write private fields back between migration and rules). Safe order is below.

## 5. Release sequence (each write step needs separate approval)

**Release 1 — Admin redesign + draft deletion (V2)** — independent of the rest; runbook §11.

**Release 2 — Multi-coach foundation (V3)**, only after V3 app code exists (Checkpoints B–D):

1. Read-only preflight + fresh verified export.
2. Owner links Google to the existing account **explicitly** (signed in with password → "Link Google"), after the owner approves enabling the Google provider. Emulator evidence: explicit link keeps the UID and both providers; a first Google sign-in without linking also kept the UID but removed the password provider. Production behaviour must be confirmed: read-only Auth lookup right after the link (UID unchanged, providers `google.com,password`).
3. Rehearse on an emulator copy of the fresh export: privacy split + ownership backfill + team current season + `published` defaults (2026 Tigers seasons published; Falcons draft unpublished) + V3 rules + V3 browser suite.
4. Maintenance window: Hosting deploy of V3 with multi-coach features off but reading both shapes; then the split + backfill migrations (Admin SDK, rollback files); then deploy `firestore.target.rules`; read back. V1/V2 browsers that are still open lose player-edit/roster actions (refused, not exposed).
5. Verify read-only: no private fields in public docs, drafts unreadable anonymously, owner workflows.
6. Create the owner's invite/coach record, then the approved test account's. Brother-in-law only after the owner supplies and approves the address.
7. Remove legacy `admins`/`app/config` branch after V1/V2 are gone.

Rollback: rules → previous ruleset; Hosting → previous version; data → split/backfill rollback files, protected export, PITR (7 days).

## 6. Browser-test production guard

- `npm run build:emulator` builds into `out-emulator/` with demo-only Firebase settings (overriding `.env.local`) and stamps `bc-emulator-build.json`; `npm run serve:emulator` serves it on 127.0.0.1 only and refuses an unstamped folder.
- `tests/browser/support/guard.mjs`: before Chromium launches, the target must be local, stamped, and every served script must name only `demo-` Firebase projects/auth domains — `out/` (production config) is refused before navigation. In the browser, every non-local request is aborted and fails the run.
- Covered by `tests/browserGuard.test.mjs` (production `out/` refused, forged stamp refused, external Firestore request blocked).
