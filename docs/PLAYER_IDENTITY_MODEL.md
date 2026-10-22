# Player Identity & Ownership Model

*Approved product principle · 2026-10-21 · applies to Team Mode (the current product)*

Baseball Coach is a **coach-owned team management and player recognition product**. It is not a universal baseball player registry.

A coach manages the players who take part on that coach's teams. Player **history is permanent**. **Ongoing tracking** follows only the coach's roster decisions.

## Three distinct concepts

| Concept | What it is | Where it lives | What it controls |
|---|---|---|---|
| **Permanent player identity** | A stable, opaque `careerPlayerId` (UUID) for a player within the coach's historical record. It is independent of name, jersey number, team, season, and roster doc id. | On each roster doc (`seasons/{s}/players/{p}.careerPlayerId`). Coach-managed copies live in `playerIdentities/{id}`, readable only by the coaches in `managerUids`. | Which seasons are the same child. Only **confirmed** links count toward a career: `identityStatus: "confirmed"`, or an explicit `linkedFrom` reference made at import. |
| **Season roster membership** | One player's participation on one team in one season. | `seasons/{seasonId}/players/{seasonPlayerId}` | Who is active on a team now. A player can be on several seasons or teams, or on none in the future. Membership never decides whether history exists. |
| **Coach-linked child** | A player the coach explicitly marked as their own child in My Players. | `coachProfiles/{uid}/linkedPlayers/{id}`, private to that coach | The child is **preselected** on every new roster the coach builds, for any team. The coach can deselect them; this is not enrollment. |

There is exactly one identifier. No other player id may be introduced.

## Behavior

### When a player leaves the coach's team

The coach simply does not import that player into the next season. Nothing else happens:

- Their roster docs, game lines, stats, awards, recognition layouts, and printed sheets stay as they were.
- Their permanent identity stays. Rules deny deleting `playerIdentities`.
- They are not added to future rosters automatically. Only linked children are preselected.
- They remain searchable under **Import returning players?**, so the coach can bring them back later. When they return, they keep the same `careerPlayerId`.
- The product does not follow them to other coaches or teams, or synchronize their stats.

Removing a roster entry is only allowed for a mistaken entry with **no** history at all, and requires typing the player's name.

### When a coach builds a new roster, including for a new team

- **Linked children** are preselected. Deselecting a child affects only this roster. The child stays linked and stays preselected next time.
- **Former players** appear in search and are never preselected.
- **New players** get a new identity.
- Every new season starts at zero stats. Earlier seasons are never modified. Career totals sum only explicitly linked seasons, so a skipped season leaves no gap or error.

### Scope across coaches

- The returning-player picker lists only seasons the coach manages (`coachUids`).
- `playerIdentities` are readable only by the coaches listed in `managerUids`. That list is fixed when the identity is created, so there is no transfer workflow.
- A linked child must be an identity the coach manages.
- If another coach separately rosters the same child, that child has an independent identity in that coach's record. The two are never discovered or merged automatically.

## Out of scope

The following are **not** part of the product model and must not be built:

- Universal player ownership.
- Global player search.
- Cross-coach transfers or claims.
- Following a player's career after they leave.

## Future: Individual Mode (deferred concept only)

**Team Mode** is the current product: teams, seasons, rosters, lineups, games, stats, recognition, awards, and parent views.

**Individual Mode** is a possible future experience in which a coach or parent follows one player without running a team. For example, a parent keeps recording Luke's stats through JV, varsity, or college. It would reuse the permanent identity and the per-game stat foundation, and leave most team-management features dormant.

Status: **not designed and not implemented.** There is no UI, no mode switch, no individual game entry, no parent-owned accounts, and no transfer, ownership, or level-specific stats. No abstraction exists in the code to support it, and none should be added before the opportunity is validated. See the roadmap (assessment §11, Phase F).
