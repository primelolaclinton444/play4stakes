# Connect 4 Synchronous Staked Play — Telemetry Event Contract (Phase 0)

All events require:
- `eventName` (string)
- `occurredAt` (ISO-8601)
- `challengeId` (string)
- `challengeCode` (string)
- `mode` (`SYNC`)
- `policyVersion` (string)
- `actorUid` (string | null when system generated)
- `traceId` (string)

## Lifecycle Events

1. `connect4.challenge.created`
   - Required fields:
     - `stakeAmount` (number)
     - `currency` (string)
     - `openExpiresAt` (ISO-8601)

2. `connect4.challenge.joined`
   - Required fields:
     - `creatorUid` (string)
     - `opponentUid` (string)
     - `escrowLockSuccess` (boolean)

3. `connect4.challenge.ready_status_changed`
   - Required fields:
     - `readyCreator` (boolean)
     - `readyOpponent` (boolean)
     - `readyDeadlineAt` (ISO-8601)

4. `connect4.challenge.ready_timeout`
   - Required fields:
     - `readyCreator` (boolean)
     - `readyOpponent` (boolean)
     - `outcome` (`NO_SHOW_CANCEL`)

5. `connect4.match.started`
   - Required fields:
     - `firstTurnUid` (string)
     - `turnNumber` (number)
     - `turnDeadlineAt` (ISO-8601)

6. `connect4.match.completed`
   - Required fields:
     - `resultType` (`WIN` | `DRAW` | `FORFEIT`)
     - `winnerUid` (string | null)
     - `forfeitUid` (string | null)
     - `movesCount` (number)

7. `connect4.challenge.settled`
   - Required fields:
     - `settlementTxId` (string)
     - `potAmount` (number)
     - `payoutWinnerUid` (string | null)
     - `settlementReason` (string)

## Gameplay Events

8. `connect4.move.submitted`
   - Required fields:
     - `moveIndex` (number)
     - `column` (0..6)
     - `turnNumber` (number)

9. `connect4.move.rejected`
   - Required fields:
     - `rejectReason` (`NOT_YOUR_TURN` | `COLUMN_FULL` | `OUT_OF_RANGE` | `DEADLINE_EXPIRED` | `INVALID_PHASE`)
     - `turnNumber` (number | null)
     - `column` (number | null)

10. `connect4.turn.timeout_forfeit`
   - Required fields:
     - `forfeitUid` (string)
     - `beneficiaryUid` (string)
     - `turnNumber` (number)

11. `connect4.reconnect.state_changed`
   - Required fields:
     - `subjectUid` (string)
     - `state` (`DISCONNECTED` | `RECONNECTED`)
     - `lastSeenAt` (ISO-8601)
