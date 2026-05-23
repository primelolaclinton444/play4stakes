# Connect 4 Synchronous Staked Integration — Implementation Task List

This is an execution-ready backlog to implement the Connect 4 synchronous lifecycle described in `CONNECT4_STAKED_SYNC_FLOW.md`.

---

## Phase 0 — Product, Rules, and Policy Freeze

- [x] **P0.1 Finalize match policy constants**
  - Decide and document:
    - Join window duration (`openExpiresIn`)
    - Ready timeout (`readyTimeoutMs`)
    - Per-turn timeout (`turnTimeoutMs`)
    - Reconnect grace (`reconnectGraceMs`)
    - No-show/forfeit payout policy
  - Output: `connect4Policy` config with versioning.

- [x] **P0.2 Define legal/compliance copy for staked synchronous play**
  - Explicitly disclose timeout, disconnect, and forfeiture behavior in user-facing terms.
  - Output: approved copy blocks for challenge create/join/ready screens.

- [x] **P0.3 Add telemetry event schema contract**
  - Define analytics event names + required fields before implementation.
  - Output: event dictionary (challenge lifecycle + gameplay events).

---

## Phase 1 — Data Model and Persistence

- [x] **P1.1 Extend `Challenge` domain model for synchronous games**
  - Add fields:
    - `mode: 'ASYNC' | 'SYNC'`
    - `phase: 'WAITING_READY' | 'IN_PROGRESS' | 'COMPLETE'`
    - `winnerUid?`, `resultType?`, `forfeitUid?`
    - `readyCreator?`, `readyOpponent?`, `readyDeadlineAt?`
    - `turnDeadlineAt?`, `turnNumber?`, `currentTurnUid?`
  - Ensure backward compatibility for existing async games.

- [x] **P1.2 Add Connect 4 match-state entity**
  - New persisted object/table keyed by challenge code/id:
    - `boardState` (7x6 compact array/bitboard)
    - `moves[]` (append-only with move index, actor uid, col, timestamp)
    - `phase`, `startedAt`, `endedAt`
  - Add uniqueness and foreign-key guarantees.

- [x] **P1.3 Add settlement receipt metadata**
  - `settlementTxId` (idempotency key)
  - settlement snapshot fields (pot, winner, reason, finalizedAt).

- [x] **P1.4 Add migration + rollback plan**
  - Write migration script(s) and rollback script(s).
  - Include migration test on seeded local data.

---

## Phase 2 — Backend Game Engine + State Machine

- [ ] **P2.1 Implement Connect 4 rules engine (pure functions)**
  - Validate move legality.
  - Apply move to board.
  - Detect win/draw.
  - Serialize/deserialize board representation.
  - Unit test all edge cases.

- [ ] **P2.2 Implement lifecycle state machine guards**
  - Legal transitions only:
    - `OPEN -> FILLED`
    - `FILLED -> WAITING_READY`
    - `WAITING_READY -> IN_PROGRESS`
    - `IN_PROGRESS -> COMPLETE`
    - `COMPLETE -> SETTLED`
  - Handle side exits (`EXPIRED`, `FORFEIT_COMPLETE`, `NO_SHOW_CANCEL`).

- [ ] **P2.3 Implement authoritative move endpoint/service**
  - Validate actor identity and turn ownership.
  - Enforce deadline and legality.
  - Persist move + board + next turn atomically.
  - Emit live update event.

- [ ] **P2.4 Implement ready/unready handling**
  - Ready flags per player.
  - Start game only when both ready.
  - Lock first-turn deadline on start.

- [ ] **P2.5 Implement timeout adjudication worker**
  - Periodic job to process:
    - Join expiry
    - Ready timeout no-show
    - Turn timeout forfeits
  - Writes terminal outcome and queues settlement.

---

## Phase 3 — Wallet / Escrow / Settlement Hardening

- [ ] **P3.1 Reuse existing escrow lock flow for `CONNECT4` create/join**
  - Creator escrow at create.
  - Opponent escrow at accept.
  - Reject if insufficient balance at any point.

- [ ] **P3.2 Implement idempotent settlement service**
  - Exactly-once payout using `settlementTxId` or unique constraint.
  - Result mapping:
    - Win -> winner gets full pot.
    - Draw -> both refunded.
    - Forfeit -> non-forfeiting player gets full pot.

- [ ] **P3.3 Add compensating transaction behavior**
  - If settlement write fails mid-flow, retry safely without double credit.

- [ ] **P3.4 Add settlement audit log**
  - Immutable log row/event with actors, reason, balances before/after.

---

## Phase 4 — Realtime Transport and Presence

- [ ] **P4.1 Implement channel model for match updates**
  - Subscribe both players to one match channel.
  - Broadcast events: ready status, move committed, timeout, settle.

- [ ] **P4.2 Presence heartbeat + reconnect tracking**
  - Track last-seen per player.
  - Use presence only as signal; server deadlines remain authoritative.

- [ ] **P4.3 Rejoin/resync endpoint**
  - On reconnect, return canonical board, turn, deadlines, and outcome status.

---

## Phase 5 — Frontend UX (Arcade Integration)

- [ ] **P5.1 Add Connect 4 game option to Arcade game list**
  - Add card in game selector with synchronous badge.

- [ ] **P5.2 Create Connect 4 challenge creation UX**
  - Stake input + policy disclosure + create action.
  - Show share link/code after escrow lock.

- [ ] **P5.3 Create challenge join + stake accept UX**
  - Opponent sees stake and timeout rules before accepting.

- [ ] **P5.4 Build ready room screen**
  - Both players ready toggles.
  - Countdown to no-show adjudication.

- [ ] **P5.5 Build live Connect 4 board screen**
  - Turn indicator.
  - Turn timer countdown.
  - Disabled input when not your turn.

- [ ] **P5.6 Build terminal result screen**
  - Win/draw/forfeit reason.
  - Pot outcome and wallet delta.
  - Settlement confirmation status.

- [ ] **P5.7 Add reconnect/resync UX states**
  - "Reconnecting", "Resynced", "Opponent disconnected" notices.

---

## Phase 6 — Security, Integrity, and Abuse Controls

- [ ] **P6.1 Server-side authorization checks on every action**
  - Only challenge participants can ready/move/view private match events.

- [ ] **P6.2 Anti-replay and duplicate move protection**
  - Move index or nonce checks.

- [ ] **P6.3 Rate limits**
  - Per-player limits on move requests and join attempts.

- [ ] **P6.4 Tamper detection instrumentation**
  - Log repeated illegal move attempts and suspicious patterns.

---

## Phase 7 — Testing Strategy

- [ ] **P7.1 Unit tests (rules engine + state transitions)**
  - All win vectors, draw, illegal moves, transition guards.

- [ ] **P7.2 Integration tests (challenge lifecycle)**
  - Create -> accept -> ready -> moves -> complete -> settle.

- [ ] **P7.3 Concurrency tests**
  - Simultaneous move submissions.
  - Repeated settlement triggers.

- [ ] **P7.4 Failure-path tests**
  - Disconnect, timeout, no-show, worker retries, partial write failures.

- [ ] **P7.5 Wallet invariants tests**
  - Pot conservation and no double payout across retries.

- [ ] **P7.6 End-to-end UI tests**
  - Two-player happy path + forfeit path.

---

## Phase 8 — Observability and Operations

- [ ] **P8.1 Metrics dashboards**
  - Match start rate, completion rate, timeout rate, forfeit rate, settlement latency.

- [ ] **P8.2 Structured logging and trace IDs**
  - Trace create/join/move/settle chain per challenge.

- [ ] **P8.3 Alerting**
  - Settlement failures, payout retries above threshold, stuck `IN_PROGRESS` matches.

---

## Phase 9 — Rollout Plan

- [ ] **P9.1 Feature flag Connect 4 by cohort**
  - Internal -> beta -> public progression.

- [ ] **P9.2 Dry-run in staging with synthetic load**
  - 1000+ simulated matches and timeout scenarios.

- [ ] **P9.3 Launch checklist**
  - Migrations applied, dashboards live, on-call runbook published.

- [ ] **P9.4 Post-launch review**
  - 24h and 7d KPI review; tune timeouts/policy.

---

## Suggested Ticket Breakdown (ready to copy into issue tracker)

1. **Backend Epic: Connect 4 Rules + State Machine** (P1, P2)
2. **Backend Epic: Escrow & Idempotent Settlement** (P3)
3. **Realtime Epic: Presence + Match Channel** (P4)
4. **Frontend Epic: Create/Join/Ready/Board/Result UX** (P5)
5. **Quality Epic: Tests + Chaos + Invariants** (P7)
6. **Ops Epic: Observability + Rollout** (P8, P9)

---

## Definition of Done (global)

- [ ] All synchronous lifecycle transitions are server-enforced and tested.
- [ ] Settlement is provably idempotent and balance-conserving.
- [ ] Timeout/disconnect outcomes are deterministic and user-visible.
- [ ] UI supports full create -> join -> ready -> play -> settle journey.
- [ ] Metrics/alerts/runbooks are in place before public rollout.
