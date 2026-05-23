# Connect 4 (Synchronous, Staked) — Proposed End-to-End Flow

## 1) What the current async challenge flow does today

From the existing arcade flow:

1. **Creator chooses game + stake and creates challenge** (`status: OPEN`).
2. **Creator stake is deducted immediately** and held as escrow (`escrowedCreator`).
3. Creator shares challenge code/deep link.
4. **Opponent joins and accepts stake**, opponent stake is deducted and escrowed, challenge moves to `FILLED`.
5. Both players run the seeded game independently and submit result times.
6. When both results exist, challenge becomes `COMPLETE` and settles once.
7. Settlement: winner receives full pot (or tie refund), then challenge is marked settled.

This works because current games are **asynchronous time trials** where each side can play separately and only submit a final score/time.

---

## 2) Why Connect 4 needs a different lifecycle

Connect 4 is **turn-based synchronous PvP** with shared game state, strict move order, and real-time presence constraints. It cannot rely on two independent result submissions.

So we should preserve the existing staked/escrow safety model, but add a synchronous match state machine and anti-stall rules.

---

## 3) Recommended lifecycle (feasible with current architecture)

## A. Challenge creation (creator)

1. Creator selects **Connect 4** and stake amount.
2. Validate creator has enough balance.
3. Create challenge row with:
   - `gameType = CONNECT4`
   - `status = OPEN`
   - `creatorAccepted = true`
   - `escrowedCreator = stake`
   - `expiresAt` (join window, e.g., 10–30 min for synchronous games)
   - `matchConfig` (turn timer, reconnect grace, etc.)
4. Deduct creator stake to escrow.
5. Share code/link.

> Optional but good: include `mode = synchronous` so backend behavior is explicit.

## B. Opponent join + lock

1. Opponent opens code and accepts stake.
2. Validate opponent balance and challenge still joinable.
3. Deduct opponent stake and set:
   - `opponentAccepted = true`
   - `escrowedOpponent = stake`
   - `status = FILLED`
4. Create a Connect 4 match state atomically:
   - Empty 7x6 board
   - Randomized first player (or deterministic via server seed)
   - `turn = creator|opponent`
   - `phase = WAITING_READY`

## C. Ready gate (important for synchronous fairness)

Before first move, require both players to click **Ready**.

1. Each player sets `ready=true`.
2. When both ready:
   - `phase = IN_PROGRESS`
   - `startedAt = now`
   - initialize per-turn deadline (e.g., `turnDeadlineAt`).

If one side never readies before a `readyTimeout`, treat as no-show:
- No-show forfeits (or gets a configurable penalty); other side receives pot or partial compensation per policy.

## D. Live gameplay loop (authoritative server)

For each move request:

1. Verify match `phase = IN_PROGRESS`.
2. Verify caller is the current turn player.
3. Verify move legal (column not full, within deadline).
4. Persist move and updated board in one transaction.
5. Check terminal conditions:
   - Win (4 in a row)
   - Draw (board full)
6. If not terminal:
   - Switch turn
   - Set next `turnDeadlineAt`

### Anti-stall / disconnect policy

- If active player misses deadline: **auto-forfeit**.
- If disconnected, allow short reconnect grace; once exceeded and deadline passes, forfeit.
- Keep these thresholds explicit in `matchConfig` so both parties accept rules up front.

## E. Settlement (single authoritative path)

When terminal result occurs (win/draw/forfeit), set:
- `status = COMPLETE`
- `winnerUid` / `resultType` (`WIN`, `DRAW`, `FORFEIT`)

Then settle exactly once (idempotent):

- **Winner:** receives full pot (`escrowedCreator + escrowedOpponent`).
- **Draw:** refund both escrows.
- **Forfeit:** non-forfeiting player receives full pot.

Set `settled = true` and write immutable settlement receipt metadata (amounts, winner, reason, timestamps).

---

## 4) Suggested state machine

`OPEN -> FILLED -> READY -> IN_PROGRESS -> COMPLETE -> SETTLED`

With side exits:
- `OPEN -> EXPIRED` (no opponent joined)
- `FILLED/READY -> CANCELED_NO_SHOW` (depending on policy)
- `IN_PROGRESS -> COMPLETE(FORFEIT)`

---

## 5) Data fields to add for Connect 4

- `mode: 'ASYNC' | 'SYNC'`
- `phase: 'WAITING_READY' | 'IN_PROGRESS' | 'COMPLETE'`
- `boardState` (compact representation)
- `currentTurnUid`
- `turnNumber`
- `turnDeadlineAt`
- `readyCreator`, `readyOpponent`, `readyDeadlineAt`
- `winnerUid`
- `resultType: 'WIN' | 'DRAW' | 'FORFEIT'`
- `forfeitUid?`
- `settlementTxId` / receipt metadata

---

## 6) Operational safeguards (highly recommended)

1. **Server-authoritative moves only** (never trust client board).
2. **Atomic move+turn updates** to prevent race conditions.
3. **Idempotent settle** (e.g., unique constraint on settlement event per challenge).
4. **Audit log** for every move + timeout + settlement decision.
5. **Clock authority on server** for deadlines/timeouts.

---

## 7) Why this is the most feasible approach

- Reuses your existing and understandable **stake escrow + accept + settle** mental model.
- Adds only the missing synchronous primitives: **ready gate, turn deadlines, authoritative move validation, forfeit policy**.
- Minimizes payout risk by preserving one-way, idempotent settlement.
- Supports fair staked play when both parties are online and handles disconnects deterministically.
