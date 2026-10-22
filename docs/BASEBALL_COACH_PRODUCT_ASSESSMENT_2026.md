# Baseball Coach — End-of-Season Product & Architecture Assessment (Fall 2026)

*Assessment date: 2026-10-21 · App version 1.3.0 · Branch `master` · Read-only investigation*

**How to read the evidence labels used throughout this document:**

| Label | Meaning |
|---|---|
| **Verified** | Confirmed by reading source and/or running a command in this repository. |
| **Inferred** | Follows logically from verified code, but the scenario was not executed. |
| **Not verified** | Depends on production Firestore, the Firebase console, or live hosting, which were not accessed. |
| **Proposed** | Future behavior recommended by this report; does not exist today. |

Production Firestore was deliberately **not** read or modified. Every statement about live data is therefore marked *Not verified* and listed in §13.

---

## 1. Executive summary

Baseball Coach is a well-built, single-team application that did its job for a real season: stats are entered once per game and every total is **recomputed from the per-game records** on each save, which is the right integrity model. The recognition system, award engine, and 8×10 print pipeline are the product's most distinctive assets.

It is **not yet safe to treat as a multi-season, multi-team, or commercial system**. The findings that matter most:

1. **There is no real parent access control.** "Enter Parent Portal" sets a browser flag; Firestore rules allow **anyone on the internet to read every season, player, game, and lineup** using the public web config embedded in the site. Exposed data is limited (children's names, jersey numbers, shirt sizes, statistics, game results), but this is a hard blocker for photos (Coach's Corner) and for commercialization. *(Verified)*
2. **Two admin actions can silently damage season data:**
   - *Season Update* resets the record, games-played count, and `createdAt` of **any season ID typed in — including an existing one**. *(Verified)*
   - *Rebuild roster (overwrite)* deletes every player document and zeroes all stats and the team record **with one click and no confirmation**. *(Verified)*
3. **Historical seasons are invisible once a new season starts.** The whole app reads one global `currentSeasonId`. When Spring 2027 becomes current, parents lose access to Fall 2026 recognition sheets, stats, and game logs (the data still exists; there is just no way to view it). *(Verified)*
4. **Tigers identity is hardcoded in ~30 places**, including logos, copy, the default season ID, and — notably — the coach-award artwork itself, which has **"TIGERS · SPRING 2026" painted into the image** and therefore prints on Fall 2026 sheets. *(Verified)*
5. **No backups, monitoring, or error reporting** are configured in the repository. A destructive reset script with a hardcoded season ID exists. *(Verified absence; backup status in the Firebase console Not verified.)*

**The good news:** the data model is already season-scoped (`seasons/{id}/…`), a CSS-token theme system exists, and stats are derivable from source game records. The smallest sound evolution is **additive**:

- add season status and a parent-facing season picker;
- add a `teams` entity that seasons reference, with branding snapshotted into each season;
- only at commercialization, add memberships and real parent authentication.

No rewrite is needed.

**Before Spring 2027 (must-do):**

- guard the two destructive admin actions;
- add a historical season viewer;
- confirm Firestore backups exist;
- upgrade Next.js (critical advisories).

---

## 2. Production readiness scorecard

| Area | Rating | Basis |
|---|---|---|
| Architecture & maintainability | **PARTIAL** | Clear module split; pure logic in `src/lib` with tests. But the 1,100-line award engine and 690-line admin actions are untested, and some modules are dead code (§3). |
| Admin authentication | **PASS** | Firebase email/password + Firestore `admins/{uid}` allowlist enforced by rules ([firestore.rules](../firestore.rules)). |
| Parent / player authorization | **FAIL** | No parent identity; all data world-readable (§3, D1). |
| Firestore rules | **PARTIAL** | Writes correctly admin-only; reads fully public; no rules tests. |
| Data integrity — stats | **PASS (with caveats)** | Totals rebuilt from game lines each save ([adminActions.ts:475-691](../src/app/(protected)/admin/_parts/adminActions.ts#L475-L691)). Caveats: D3, D8, D11. |
| Data integrity — season lifecycle | **FAIL** | D2 (season reset), D3 (roster rebuild), no finalization lock. |
| Award calculations | **PARTIAL** | Logic is coherent (ranking metric = displayed metric, verified this cycle), but **no unit tests** for `trophies.ts` or `computeLeaders`. |
| Roster & player identity | **PARTIAL** | Career identity falls back to name matching; doc IDs embed jersey number (D3, D12). |
| Parent access & privacy | **FAIL** | D1; admin email shipped in client bundle (D9). |
| Media & assets | **PARTIAL** | Static artwork works; 14 MB PSD is published by the deploy (D10); 2.2 MB PNG for Best Attitude. No Firebase Storage in use. |
| Recognition editor persistence | **PASS** | Season-scoped, merge-only writes, deterministic reconciliation, unit-tested ([recognitionLayout.ts](../src/lib/recognitionLayout.ts)). |
| Printing & PDF | **PASS** | Verified this cycle: one page, 720×576 pt, 3000×2400 raster, text-fit audit clean. |
| Performance & scalability | **PASS (current scale)** | ~2.3 MB JS, real-time listeners scoped to one season. Career stats and identity lookups scan **all seasons × all players** per call — fine for 1 team, poor at product scale. |
| Accessibility & responsive UX | **NOT VERIFIED (broadly)** | Editor has keyboard/ARIA support and mobile fit (tested earlier this cycle); no app-wide audit performed. |
| Dependency health | **PARTIAL** | 24 audit findings (1 critical); see D6 for real exposure. |
| Testing & regression coverage | **PARTIAL** | 65 tests pass, all pure helpers; nothing covers awards, stat aggregation, leaders, rules, or UI. |
| Error handling & recovery | **PARTIAL** | Actions surface errors inline; no error boundaries (`error.tsx`), no retry for the two-phase save (D11). |
| Deployment configuration | **PARTIAL** | Static export + Firebase Hosting with CSP and security headers ([firebase.json](../firebase.json)); deploy is manual from a dev machine. |
| Monitoring, logging, backup/recovery | **FAIL / NOT VERIFIED** | No monitoring or crash reporting in code; no backup tooling in repo; console-side PITR/backups not verified. |

Passing tests is **not** evidence of production readiness here: the tests do not exercise the areas where the defects live.

---

## 3. Confirmed defects and risks

Severity is impact if it happens; likelihood is for this team's realistic usage. "Confirmed" = defect verified in code. "Risk" = hypothetical or inferred scenario.

| ID | Finding | Type | Severity | Likelihood | Evidence |
|---|---|---|---|---|---|
| **D1** | All season, player, game, line, and lineup data is publicly readable; "parent portal" is a client-side flag. | Confirmed | High (privacy; commercial blocker) | Low exploitation today; certain for any shared photo feature | [firestore.rules:25-48](../firestore.rules#L25-L48) `allow read: if true`; [AuthOverlay.tsx:69-96](../src/components/auth/AuthOverlay.tsx#L69-L96) writes `{role:"public"}` to localStorage with no sign-in |
| **D2** | *Season Update* on an **existing** season ID overwrites `record` to 0-0-0, `gamesPlayed` to 0, and `createdAt`, plus team name/label. No list of existing seasons, no confirmation. | Confirmed | High (historical record shows 0-0) | Medium at season transitions | [adminActions.ts:66-112](../src/app/(protected)/admin/_parts/adminActions.ts#L66-L112) |
| **D3** | *Rebuild roster (overwrite)*: one click, no confirm. Deletes all player docs (losing shirt size, leaderboard-hidden, flags), zeroes stats and record. Stats only return after the next game save, and **only for players whose number+name (doc ID) is unchanged** — changed IDs orphan their game lines. | Confirmed | High | Low–Medium (button is labelled "overwrite") | [adminActions.ts:207-274](../src/app/(protected)/admin/_parts/adminActions.ts#L207-L274), [useRosterDraft.ts:53-61](../src/app/(protected)/admin/_parts/useRosterDraft.ts#L53-L61), ID scheme [adminHelpers.ts:159-164](../src/app/(protected)/admin/adminHelpers.ts#L159-L164) |
| **D4** | Only the current season is viewable; no season parameter anywhere in parent-facing routes. | Confirmed | Medium (loss of access, not data) | Certain at Spring 2027 | `useRosterPlayers` subscribes to `app/config.currentSeasonId` only ([rosterStore.ts](../src/lib/rosterStore.ts), `RosterWatchManager.start/wireSeason`) |
| **D5** | No backup/export tooling; [tools/reset-baseball-season.mjs](../tools/reset-baseball-season.mjs) deletes all games for hardcoded `tigers-2026` with no dry-run or confirmation, and its stat schema is stale (e.g. `strikeouts`, missing 16 current fields). | Confirmed (tooling); backups Not verified | High if run by mistake | Low | reset script lines 17, 48-58 |
| **D6** | `next@16.3.1` (pinned) has critical advisories (RCE on Windows-hosted servers, image-optimizer RCE/SSRF). **Production is a static export with no Next server**, so live exposure is mainly the local dev server — which binds to the LAN by default. `dompurify` (via jsPDF) has low XSS advisories; `firebase` gRPC advisories affect Node servers, not browsers. | Confirmed | Medium (dev machine) | Low | `npm audit` (24 findings: 1 critical, 14 high); fix: `next@16.4.2` |
| **D7** | Coach-award artwork (MVP, Dominator, Honorable Mention, Best All-Around) has **"TIGERS · SPRING 2026"** baked into the image; it prints on Fall 2026 sheets and cannot be reused for another team or season. | Confirmed | Medium (branding accuracy) | Certain | Viewed `public/trophies/dominator.png`, `mvp.png`, `honorable-mention.png`, `best-all-around.png` |
| **D8** | Hit-streak rules: (a) a game with stats but 0 hits **breaks** the streak even with 0 at-bats (walk-only or defense-only games), unlike common scoring convention; (b) the game-log streak also counts Game-Ball-only games, so it can disagree with the season "HS" stat. | Confirmed | Low (can change Hot Streak Hitter) | Medium | [adminActions.ts:632-644](../src/app/(protected)/admin/_parts/adminActions.ts#L632-L644) vs [playerGameLog.ts:191-209](../src/lib/playerGameLog.ts#L191-L209) |
| **D9** | Admin email allowlist is `NEXT_PUBLIC_ADMIN_EMAILS`, so it ships in the public JS bundle (1 address found in `out/`). Real enforcement is the `admins` collection, so this is disclosure only, but it names the account worth attacking. | Confirmed | Low | Low | [session.ts:17-43](../src/lib/session.ts#L17-L43); `grep` of `out/_next/static/chunks` |
| **D10** | `public/trophies/FinalAwards.psd` (14 MB) is copied into `out/` and would be deployed; four PSDs (~91 MB) are tracked in git despite `*.psd` in `.gitignore`; `.firebase/hosting.*.cache` is tracked. | Confirmed | Low | Certain | `ls out/trophies`, `git ls-files` |
| **D11** | Game save is two sequential batches (game+lines, then rebuilt totals). A failure or tab close between them leaves totals stale until the next save; two admins saving concurrently can race. Source data is never lost. | Inferred | Low | Low (one coach) | [adminActions.ts:473, 691](../src/app/(protected)/admin/_parts/adminActions.ts#L473) |
| **D12** | Career identity: returning players are linked by **exact name match** across all seasons; career stats also accept a name match. Two different children with the same name would merge. | Confirmed logic; collision hypothetical | Medium (wrong child's stats) | Low now, higher at product scale | [playerIdentity.ts](../src/lib/playerIdentity.ts), [playerCareerStats.ts](../src/lib/playerCareerStats.ts) |
| **D13** | No way to delete a mis-entered game in the UI; it can only be edited. A game entered twice permanently affects the record. | Confirmed (no delete path exists) | Medium | Low | Only deletes in admin code are roster rebuild and line replacement |
| **D14** | No error boundaries, crash reporting, or usage telemetry. | Confirmed absence | Low–Medium | — | No `error.tsx`/`global-error.tsx`; no Sentry/Analytics imports |
| **D15** | `DEFAULT_SEASON_ID = "tigers-2026"`: if `app/config` is missing or unreadable, the app silently shows that season (writes would target it too). | Confirmed | Low | Low | [rosterStore.ts:25](../src/lib/rosterStore.ts#L25) |
| **D16** | Hygiene: dead modules (`components/home/TokenRow`, `PreviewChip`, `ColorPickerDialog`, `ui/Accordion`, `lib/appConfig.ts`); site description "Knexus app"; `/` is defined by both `app/page.tsx` and `app/(protected)/page.tsx` (builds fine; which one renders was not verified). | Confirmed | Info | — | grep usage counts; [layout.tsx](../src/app/layout.tsx) |

**Explicitly not defects:**

- Scrimmages count toward player stats but not the team record. This is intentional and documented at [adminActions.ts:479-481](../src/app/(protected)/admin/_parts/adminActions.ts#L479-L481).
- `service-account.json` and `.env.local` are gitignored and were never committed (verified with `git log --all`).

---

## 4. Current architecture

**Stack:** Next.js 16 static export (`output: "export"`) → Firebase Hosting; client-only Firebase SDK (Auth + Firestore); jsPDF + html-to-image for exports; Tailwind 4. No server code, Cloud Functions, or Storage.

**Firestore model (verified from code):**

```
app/config                      { currentSeasonId }                 public read, admin write
admins/{uid}                    (existence = admin)                 self read, console-managed
seasons/{seasonId}              teamName, seasonLabel, league, record, gamesPlayed,
                                scheduledGames, usesGamesPlayedRecord, endSeasonMode,
                                finalAwards{mvp,dominator,…,bestAttitude},
                                recognitionLayouts{playerId:{order}}  public read, admin write
  players/{playerId}            name, number, careerPlayerId, shirtSize, primaryPos,
                                leaderboardHidden, returningPlayer, stats{…derived…}
  games/{gameId}                date, opponent, result, gameType, score, coachAwards,
                                gameBall, lineupSnapshot
    lines/{playerId}            per-game stat delta  ← source of truth for all stats
  lineups/{lineupId}            current batting/fielding lineup
```

**Strengths:**

- Season scoping is already the primary partition.
- Derived stats are rebuilt rather than incremented, which makes them idempotent and repairable.
- Lineup snapshots are frozen per game.
- Recognition layouts reconcile safely.

**Weak points:**

- Team identity lives only as strings on the season doc plus hardcoded assets.
- Roles are binary: admin or anonymous.
- Player doc IDs encode mutable data (the jersey number).

---

## 5. Current season lifecycle (as built)

| Step | How it works today | Gaps |
|---|---|---|
| Create season | Admin → Season tab → enter new season ID, team name, label, scheduled games → `switchSeason` writes the season doc and sets `app/config.currentSeasonId`. | Free-text ID; no list of seasons; overwrites existing seasons (D2). |
| Roster | Roster Builder → *Rebuild roster (overwrite)* creates player docs; "returning player" links career IDs by name. | Destructive and unconfirmed (D3); no "copy from previous season." |
| Games | Stats tab → enter per-player lines → save rebuilds all totals and record. Edit supported; delete not. | D11, D13. |
| Coach recognition | Per-game Game Ball + coach picks stored on the game; counted into stats. | — |
| End of season | Final Season Awards panel → *End season* sets `endSeasonMode: true` and final awards; enables plaque view. | No lock: games, roster, and awards stay editable; no "final" status. |
| Arrangements | Saved per player on the season doc. | — |
| Archive / history | **None.** Switching seasons hides the previous one from all users. Career totals still aggregate past seasons for returning players. | D4. |

**Developer intervention currently required:**

- adding/removing admins (Firestore console + `NEXT_PUBLIC_ADMIN_EMAILS` + rebuild/deploy);
- changing logos and colors (code + assets);
- the reset script;
- deploying.

**Not verified (important):** whether Spring 2026 data still exists as its own season. The reset script targets `tigers-2026`, the default label is "Spring 2026", and the coach-award art says Spring 2026. If Fall 2026 reused `tigers-2026` after a reset, Spring 2026 game history no longer exists. Check the `seasons` collection in the console (§12, Q1).

### Recommended future-state lifecycle (Proposed)

1. **Draft:** create the season from a form that lists existing seasons and refuses existing IDs. Optionally copy last season's roster as "returning" candidates.
2. **Active:** games and awards are editable (today's behavior).
3. **Finalize:** a checklist (final awards chosen, arrangements reviewed). Sets `status: "final"`, records `finalizedAt`, and snapshots team branding into the season. Rules block writes to final seasons except an explicit admin "reopen."
4. **Archived/viewable:** parents pick any season from a selector; recognition sheets render from that season's data and branding snapshot.

---

## 6. Spring 2027 readiness

**Can Spring 2027 start safely today?** Yes, *if* the coach creates a **new, unique** season ID and does not re-enter an old one; the new season is fully isolated. But:

| Need | Status | Action |
|---|---|---|
| Fall 2026 remains viewable to parents | **Missing** (D4) | Season selector (B1) |
| Fall 2026 can't be changed accidentally | **Missing** | Season status + rules lock (B2) |
| Safe season creation | **Unsafe** (D2) | Guard `switchSeason` (A2) |
| Safe roster setup | **Unsafe** (D3) | Confirm + non-destructive roster import (A3, B3) |
| Returning players | Works by name match | Prefer explicit "link to previous player" picker (B3) |
| Recognition carry-forward | Award catalog is global code; arrangements are per season | Fine as is |
| Coach-award art | Says "SPRING 2026" | New art without season text, or a caption overlay (C4) |
| Backups before transition | Not verified | Export Fall 2026 before switching (A1) |

---

## 7. Team branding and Bronco transition

**Is the app team-configurable?** Partly. **Configurable today (verified):**

- team name, season label, and league are fields on the season doc;
- colors flow through CSS variables (`--primary`, `--secondary`, `--accent`) via [themeTokens.ts](../src/lib/themeTokens.ts) and [globals.css](../src/app/globals.css).

**Hardcoded today (verified):**

- `TigersLogo.png` / `TigersLogoColor.png` in 8 files (navbar, auth overlay, overlay host, roster CSS, recognition sheet, globals.css);
- the Tigers brand colors as `DARK_TOKENS` constants;
- "Tigers" copy in the auth screen ("Tigers 2026 • Parent Portal"), the trophies page, and the recognition sheet ("Tigers Baseball", the appreciation message, Team Contributor);
- the `tigers-2026` fallback and the "Mustang" league default;
- coach-award artwork with team and season text baked in (D7).

**What should become configurable vs. stay historical:**

| Item | Make configurable (team) | Snapshot per season (historical) |
|---|---|---|
| Team name, short name, mascot copy | ✓ | ✓ (name as of that season) |
| Logo (mark + full color) | ✓ | ✓ (URL/asset ref frozen at finalize) |
| Primary/secondary/accent colors | ✓ | ✓ |
| Division / age group (Mustang → Bronco) | ✓ | ✓ |
| Appreciation message, sign-off | ✓ | ✓ |
| Award catalog & artwork | Global defaults, optional per-team overrides later | Artwork referenced, not copied |
| Coaches/admins | ✓ (membership) | — |

**Smallest sound evolution (Proposed):** add a `teams/{teamId}` doc (name, division, logo asset paths, colors, copy). Add `teamId` plus a `branding` snapshot to each `seasons/{id}` doc. Keep `seasons` top-level, so **no data moves**: existing seasons get `teamId: "tigers"` and a snapshot from today's constants. UI reads branding from the *viewed season's snapshot*, so a Fall 2026 sheet stays Tigers-orange even after the Bronco team adopts new colors. Logos for new teams live in `public/` at first. Firebase Storage is needed only when coaches upload their own logos (Phase E).

Organization and division do **not** need separate entities yet; division is a team/season attribute. Introduce `organizations` only for commercialization.

---

## 8. Coach's Corner proposal

### MVP (Proposed)

- **Coach authoring:** a "Coach's Corner" admin tab with a simple form: title, body (plain text with paragraphs and links; Markdown optional), category (Announcement, Practice Tip, Game Recap, Video), optional video link, up to 6 photos, pinned toggle, Draft/Published, and scope (*this season* or *evergreen*). Coaches can edit and delete their posts.
- **Parent experience:** a "Coach's Corner" nav item showing pinned posts first, then a newest-first feed with category chips. The post detail view has an embedded video (privacy-enhanced YouTube `youtube-nocookie.com` or Vimeo) and a tap-to-enlarge photo grid. Mobile-first.
- **Data:** `teams/{teamId}/posts/{postId}` `{title, body, category, pinned, status, seasonId|null, videoUrl, photos[{path,w,h}], authorUid, createdAt, updatedAt}`. Owned by the **team** with an optional `seasonId`, so evergreen tips survive season changes.
- **Media:**
  - Images are resized client-side (≈1600 px JPEG, quality 0.8, typically 200–400 KB) before upload to Firebase Storage `teams/{teamId}/posts/{postId}/…`, with a 10 MB pre-resize limit.
  - **No direct video hosting:** link to YouTube/Vimeo instead, which avoids transcoding, storage, and bandwidth costs.
- **Security:** rules make posts admin-writable; parents read only `status == "published"`. Storage rules mirror this. The CSP in [firebase.json](../firebase.json) must add `firebasestorage.googleapis.com` to `img-src` and the embed hosts to `frame-src`.

### Deferred

- parent comments and replies;
- reactions;
- notifications or email digests;
- scheduled publishing;
- rich-text editor;
- multiple authors with separate permissions.

**Comments recommendation: defer.** They bring moderation, notification, identity, and child-safety obligations that the current anonymous parent model cannot support.

### Critical dependency

Under today's rules (D1), anything Coach's Corner stores in Firestore or Storage is **public to anyone with the URL**. Two options:

- **(a)** Ship a **text + video-link only** MVP first, which is acceptable under current rules for non-sensitive content.
- **(b)** Gate photo uploads on real parent access (E2 in the roadmap).

**Recommendation:** no photos of children until parent access is authenticated, and get the product owner's decision on photo consent (§12).

**Cost (approximate; verify current Firebase pricing):** at one team's scale (tens of posts, hundreds of resized photos), Storage is well under 1 GB and Firestore reads stay within free-tier-like volumes. Egress from parents viewing photos is the main variable cost.

---

## 9. Commercial product readiness

### Architectural blockers (must be resolved before other coaches onboard)

1. **Tenant isolation:** today there is one global `app/config`, one global admin set, and public reads. Product scale needs one isolated **workspace per head coach** (workspace → teams → seasons), with rules that check the workspace owner and that workspace's parents. *(Revised 2026-10-22: single-head-coach workspaces; no organizations or multi-coach memberships.)*
2. **Parent identity:** parents need real accounts (email-link or Google sign-in) bound to a team via invite. Optionally bind them to specific players for privacy controls.
3. **Admin model:** replace the console-managed `admins` collection and the build-time email list with self-service sign-up, where the head coach owns their workspace. *(Revised 2026-10-22: no co-coach or assistant roles.)*
4. **Player identity:** stable player IDs independent of jersey number, and explicit cross-season linking instead of name matching (D3, D12).
5. **Query scaling:** career stats and identity lookup scan every season and every player. At multi-tenant scale this must become a per-player history index or be scoped to the team.

**Data placement decision:**

- *Option A:* keep `seasons` top-level with `teamId` and enforce with rule `get()` lookups (simplest migration).
- *Option B:* nest everything under `teams/{teamId}/seasons/…` (simplest, most robust rules; requires a one-time copy migration).

**Recommendation:** Option A for Phases B–C, and decide on B at Phase E with a migration script and dry-run. Either way, Phase C's `teamId` field makes the later move mechanical.

### Product experience gaps (developer knowledge currently required)

| Flow | Today |
|---|---|
| Create team, logo, theme | Code change + deploy |
| Add coach/admin | Console + env var + rebuild |
| Create first season | Free-text season ID form |
| Import roster | Manual one-by-one entry; no CSV import |
| Invite parents | Share URL; no invites |
| Season end | Works (end season + final awards + plaques) |
| Data export / deletion | None |

### Commercial considerations (to plan, not build)

- **Billing:** none. Per-team seasonal pricing fits the usage pattern better than monthly SaaS (hypothesis).
- **Operating cost:** a static site, plus Firestore reads driven by real-time listeners, plus PDF and print generated **client-side**, so exports cost the operator nothing. Media is the main cost driver.
- **Support tooling needed:** an operator console (list tenants, transfer ownership, restore a season), audit log of admin writes, export.
- **Privacy:** the product stores minors' names, performance data, and (with Coach's Corner) photos.
  - **Requires qualified legal review:** children's privacy law (e.g. COPPA in the US), parental consent for photos, retention and deletion obligations, and terms of service.
  - Technical prerequisites: authenticated access, per-team data deletion, data export, and minimal-PII defaults.
- **Analytics and monitoring:** add crash reporting and privacy-respecting usage analytics before onboarding external teams.

### Market positioning (hypotheses requiring validation)

- **Evidence-backed strengths:**
  - polished positive-recognition loop (per-game Game Ball, coach picks, season awards with custom art, printable 8×10 plaques);
  - parent-friendly player pages with game logs;
  - low operating cost.
- **Hypothesis:** the best initial customer is the **volunteer head coach of a 7–12-year-old rec or travel team** who wants to celebrate kids, not a league administrator. Position as a *recognition and development companion* that complements, rather than replaces, scorekeeping and league-management tools.
- **To validate:** whether coaches will pay, or whether leagues/parents would. Also whether manual stat entry is acceptable or import from a scorekeeping app is required. Interview 5–10 coaches outside this team before building billing.

---

## 10. Recommended architectural evolution

The four workstreams share **three foundations**. Build these once:

1. **Team entity + branding snapshot** (C1). Unlocks Bronco, historical branding, Coach's Corner ownership (`teams/{id}/posts`), and tenant boundaries later.
2. **Season status + season-aware routing** (B1/B2). Unlocks history for parents, finalize/lock, safe transitions, and season-scoped Coach's Corner posts.
3. **Workspace-owner + parent access** (E1/E2). Unlocks real parent privacy, photos, parent invites, and commercialization. Rules evolve from `isAdmin()` to "owner of this workspace" or "parent in this workspace". *(Revised 2026-10-22: one head coach per workspace.)*

Media storage (Firebase Storage with team-prefixed paths and mirrored rules) is a fourth, smaller shared capability, needed first by Coach's Corner photos and later by team logos.

Avoid in the near term:

- Cloud Functions for stats; client rebuild-from-lines is adequate at one team's scale. Revisit for D11 at product scale.
- A CMS.
- Moving collections before Phase E.

---

## 11. Prioritized roadmap

### Product scope and priorities (authoritative, 2026-10-22)

**Core product: single-head-coach Team Mode.** One head coach or team manager runs an isolated workspace and tracks their players, stats, teams, and seasons over time. That covers:

- multiple teams across seasons and divisions, with a different roster each season;
- returning-player import and coach-linked children;
- permanent player history, game stats, lineups, recognition, awards, and plaques;
- parent viewing, team branding and season history, and Coach's Corner.

Commercialization means independent head coaches, each with their own isolated workspace.

**Immediate priorities, in order:**

1. Production data preservation: verified export, backups/PITR confirmed, restore rehearsed (A1).
2. Historical player identity confirmation: audit and product-owner approval.
3. Controlled identity migration and registry activation: rules deploy, `coachUids` backfill, migration, flag.
4. Season finalization and historical season viewing (B1, B2).
5. Team identity and customizable branding (C1, C2, C4).
6. Coach's Corner (D-1, then D-2).
7. Independent coach workspace onboarding and parent authentication (E1, E2, E4).

**Excluded from planned work:** co-coach or assistant-coach accounts, shared team administration, multiple managers per workspace, coach-to-coach player transfers, universal player registries, and league or organization administration. Rows below that implied these have been revised or removed.

Complexity: **S** ≈ ≤1 day, **M** ≈ 2–4 days, **L** ≈ 1–2 weeks, **XL** ≈ multi-week.

### Quick wins (independent, low risk)

| # | Item | Complexity | When |
|---|---|---|---|
| Q1 | Upgrade `next` 16.3.1 → 16.4.2 (+ `eslint-config-next`); run `npm audit fix` for non-breaking transitives; re-run build and print checks. | S | Now |
| Q2 | Move `FinalAwards.psd` out of `public/`; `git rm --cached` the PSDs and `.firebase` cache. | S | Now |
| Q3 | Add a confirmation dialog to *Rebuild roster* (minimal version of A3). | S | Now |
| Q4 | Replace "Knexus app" metadata; delete dead modules (D16). | S | Any time |
| Q5 | Mark `tools/reset-baseball-season.mjs` as dangerous (require `--season` arg and `--yes`), or delete it. | S | Now |

### Phase A — Production hardening

| ID | Problem | Approach | Cx | Depends | Risk | Acceptance criteria | When |
|---|---|---|---|---|---|---|---|
| A1 | No verified backups (D5) | Enable Firestore PITR and/or scheduled exports in console; add a read-only `tools/export-season.mjs` (JSON dump per season). | S–M | — | Console cost (small) | A restore drill recovers a deleted test season in a non-prod project. | **Now** |
| A2 | Season Update overwrites existing seasons (D2) | Load existing season IDs; "Create season" refuses existing IDs; separate "Make current" action that only sets `currentSeasonId`. | S | — | Low | Switching to an existing season changes nothing on that season doc. | **Before Spring 2027** |
| A3 | Destructive roster rebuild (D3) | Confirm dialog with counts; preserve player docs and IDs (upsert, never delete players with game lines). | M | — | Medium (touches roster) | Rebuild never zeroes stats; players with game lines cannot be deleted. | **Before Spring 2027** |
| A4 | Untested award and stat logic | Extract stat aggregation from `saveGameAndApplyDeltas` into a pure function; add tests for it, `computeTrophies`, `computeRunnerUpAwards`, `computeLeaders`. | M | — | Low | Tests cover each award's eligibility, ties, runner-ups, and streak rules. | Before Spring 2027 |
| A5 | Rules untested | Firestore emulator rules tests (admin write, anonymous denied). | S–M | — | Low | CI/npm script proves non-admins cannot write. | Before Spring 2027 |
| A6 | Hit-streak inconsistency (D8) | Product decision on walk-only games; share one streak function between season totals and game log. | S | A4 | Changes Hot Streak winners retroactively | Game-log streak equals season HS for every player. | Before Spring 2027 |
| A7 | No game deletion (D13) | Admin "Delete game" with confirm; triggers the same rebuild. | S | A4 helpful | Low | Deleting a game updates record and totals. | Before Spring 2027 |
| A8 | No error visibility (D14) | `global-error.tsx` + lightweight crash reporting. | S | — | Privacy review of the vendor | Errors reported with no child PII. | Before commercialization |

### Phase B — Spring 2027 readiness

| ID | Problem | Approach | Cx | Depends | Acceptance criteria | When |
|---|---|---|---|---|---|---|
| B1 | History invisible (D4) | `?season=` support in player/trophies/home; a season selector; `useRosterPlayers(seasonId?)`. | M | — | A parent can open the Fall 2026 sheet while Spring 2027 is current; print/PDF identical. | **Before Spring 2027** |
| B2 | No finalization/lock | `status: active/final`, *Finalize season* checklist, rules deny writes when final (admin "reopen"). | M | A2 | Edits to a final season are rejected by rules, not just UI. | **Before Spring 2027** |
| B3 | Roster transition | "Start from last season's roster": choose returning players (explicit link to `careerPlayerId`) and add new ones. | M | A3 | Returning players keep career stats without name matching. | Before Spring 2027 |
| B4 | Coach-award art says "Spring 2026" (D7) | Commission/edit art without season text, or keep and accept; the sheet already shows the season label. | S (asset work) | — | Fall/Spring sheets don't show the wrong season. | Before Spring 2027 |

### Phase C — Team identity & Bronco readiness

| ID | Problem | Approach | Cx | Depends | Acceptance criteria | When |
|---|---|---|---|---|---|---|
| C1 | Tigers hardcoded | `teams/{teamId}` doc; seasons get `teamId` + `branding` snapshot; one migration script tags existing seasons. | M | B1 | All existing seasons render identically after migration. | Before Fall 2027 |
| C2 | Theme/logo hardcoded | `BrandingProvider` sets CSS variables and logo URLs from the viewed season's snapshot; replace `TigersLogo` references and copy. | M–L | C1 | A test team with different colors/logo renders without code changes; Tigers history unchanged. | Before Fall 2027 |
| ~~C3~~ | ~~Admin management needs console~~ | **Removed 2026-10-22:** adding or removing coaches is out of scope (single head coach). Moving the head coach off the console allowlist is covered by E1. | — | — | — | — |
| C4 | Team-specific awards | Optional per-team award art overrides; generic default art without team text. | M | C1 | New team prints sheets with no Tigers marks. | Before Fall 2027 |

### Phase D — Coach's Corner

| ID | Approach | Cx | Depends | Acceptance criteria | When |
|---|---|---|---|---|---|
| D-1 | Text + video-link MVP (posts, categories, pinned, drafts, season/evergreen) | M | C1 (team ownership), rules update | Coach publishes and edits; parents see the published feed on mobile. | After Phase B |
| D-2 | Photo galleries (client resize, Storage, rules, CSP) | M | **E2 parent auth**, consent decision | Photos visible only to authenticated team members. | After E2 |

### Phase E — Commercialization foundation

| ID | Approach | Cx | Depends | Acceptance criteria |
|---|---|---|---|---|
| E1 | Workspace ownership (one head coach) + parent role rules, parent invitations | L | C1 | Rules tests prove cross-workspace reads/writes are denied. |
| E2 | Parent accounts (email link) bound to teams; remove public reads | L | E1 | Unauthenticated users can read nothing but the sign-in page. |
| E3 | Data placement decision (top-level + `teamId` vs nested), migration with dry-run | L | E1 | Migration rehearsed on a copy; zero data diff. |
| E4 | Onboarding: create team, logo/colors, first season, CSV roster import | L | C2, E1 | A new coach goes from sign-up to first game with no developer help. |
| E5 | Operations: audit log, tenant export/delete, monitoring, support console | L | E1 | Export and deletion of one team's data verified. |
| E6 | Legal/privacy review, consent flows, terms | External | E2 | Counsel sign-off. |
| E7 | Billing | M–L | E1, E4, market validation | — |

*Historical note:* "Individual Mode", where one player is followed outside team administration, was discussed on 2026-10-21. It is not on the roadmap and should not be designed for.

**Recommended sequencing:** Q1–Q5 + A1–A3 now → B1–B2 (+A4, A5, A7) before Spring 2027 → C1–C2 during Spring 2027 → D-1 → E1/E2 → D-2 photos → rest of E after customer validation. The priority list at the top of this section takes precedence.

---

## 12. Open decisions requiring product-owner input

1. **Q1 — Was Spring 2026 preserved as its own season?** Check the Firestore `seasons` collection. If it was reset into Fall 2026, accept the loss or check for console backups.
2. Should a game with walks only (0 AB) break a hit streak? This affects Hot Streak Hitter.
3. Should completed seasons be **locked** by default, and who may reopen them?
4. Will Spring 2027 be the same Tigers team (same branding) and Fall 2027 a new Bronco team, or will the Tigers identity continue into Bronco?
5. Coach-award art: re-create without season text (reusable), or produce new art each season?
6. Coach's Corner: are photos of children wanted? If so, what consent process applies, and is it acceptable to wait for authenticated parent access?
7. Parent privacy target: is "anyone with the link" acceptable for Spring 2027, or should parent sign-in come sooner?
8. Should parents only see their own child's details, or the whole team (today: whole team)?
9. Commercial intent and timeline: is validating with outside coaches before Phase E acceptable?

---

## 13. Validation evidence and limitations

**Commands run (all non-destructive, 2026-10-21):**

| Command | Result |
|---|---|
| `npm test` | 65/65 pass (8 files: coachRecognition 6, gameBall 4, gameClassification 6, numericDraft 9, playerGameLog 8, recognitionLayout 11, unsavedEdits 7, withinReach 14) |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass (no problems) |
| `npm run build` | Pass; 6 static routes; `out/` = 24 MB (14 MB is the PSD), ~2.3 MB JS |
| `npm audit` | 24 findings: 1 critical, 14 high, 8 moderate, 1 low (see D6 for exposure analysis) |
| `npm outdated` | `next` 16.3.1 → 16.4.2; `firebase` 12.8 → 12.19 (minor) |
| `git log --all -- service-account.json .env.local` | Never committed |
| Bundle grep | 1 admin email address present in `out/_next/static/chunks` |

Recognition-sheet print and PDF behavior was validated earlier this cycle with Playwright against fixture data (one page, 720×576 pt, text-bounds audit clean). That validation used fixtures, not production data.

**Not verified (requires console or production access):**

- Contents of production Firestore: which seasons exist (Q1), the current season ID, and data volume.
- Whether deployed rules match `firestore.rules`.
- Firestore backups / PITR status; Firebase Auth settings (MFA, email-enumeration protection, password policy).
- Live hosting headers.
- Billing plan and current costs.
- App-wide accessibility (no full audit run); real-device mobile behavior beyond the editor checks.
- Pricing figures in §8–§9 are approximate and should be checked against current Firebase pricing.
- Market statements in §9 are hypotheses.

**Working-tree note:** this assessment created only this file. No application code, configuration, rules, or data were changed.
