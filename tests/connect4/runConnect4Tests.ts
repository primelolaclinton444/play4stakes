import assert from 'node:assert/strict';
import { applyMove, createEmptyBoard, deserializeBoard, detectWinner, isDraw, serializeBoard } from '../../lib/connect4/engine';
import { canTransition, assertTransition } from '../../lib/connect4/stateMachine';
import { adjudicateTimeout, commitAuthoritativeMove, initializeMatch, resolveTurnTimeoutForfeit, setReady, shouldStartMatch } from '../../lib/connect4/service';
import { lockEscrow, retrySettlement, settleIdempotently, type Connect4EscrowState, type SettlementStore } from '../../lib/connect4/settlement';
import { assertConnect4ActionAuthorized, Connect4RateLimiter, Connect4TamperMonitor } from '../../lib/connect4/security';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function boardFromMoves(moves: Array<[number, 1 | 2]>) {
  let board = createEmptyBoard();
  for (const [col, player] of moves) {
    board = applyMove(board, col, player).board;
  }
  return board;
}

test('rules engine serializes, deserializes, validates columns, and detects all win vectors', () => {
  const empty = createEmptyBoard();
  assert.equal(serializeBoard(empty), '0'.repeat(42));
  assert.deepEqual(deserializeBoard(serializeBoard(empty)), empty);
  assert.throws(() => applyMove(empty, -1, 1), /OUT_OF_RANGE/);

  const fullColumn = boardFromMoves([[0, 1], [0, 2], [0, 1], [0, 2], [0, 1], [0, 2]]);
  assert.throws(() => applyMove(fullColumn, 0, 1), /COLUMN_FULL/);

  assert.equal(detectWinner(boardFromMoves([[0, 1], [1, 1], [2, 1], [3, 1]])), 1);
  assert.equal(detectWinner(boardFromMoves([[0, 2], [0, 2], [0, 2], [0, 2]])), 2);
  assert.equal(detectWinner(boardFromMoves([[0, 1], [1, 2], [1, 1], [2, 2], [2, 2], [2, 1], [3, 2], [3, 2], [3, 2], [3, 1]])), 1);
  assert.equal(detectWinner(boardFromMoves([[3, 1], [2, 2], [2, 1], [1, 2], [1, 2], [1, 1], [0, 2], [0, 2], [0, 2], [0, 1]])), 1);
});

test('draw detection returns true for a full non-winning board', () => {
  const rows = [
    [1, 1, 2, 2, 1, 1, 2],
    [2, 2, 1, 1, 2, 2, 1],
    [1, 1, 2, 2, 1, 1, 2],
    [2, 2, 1, 1, 2, 2, 1],
    [1, 1, 2, 2, 1, 1, 2],
    [2, 2, 1, 1, 2, 2, 1],
  ] as const;
  const board = rows.flat() as Array<0 | 1 | 2>;
  assert.equal(detectWinner(board), null);
  assert.equal(isDraw(board), true);
});

test('state machine permits only documented lifecycle transitions', () => {
  assert.equal(canTransition('OPEN', 'FILLED'), true);
  assert.equal(canTransition('FILLED', 'WAITING_READY'), true);
  assert.equal(canTransition('WAITING_READY', 'IN_PROGRESS'), true);
  assert.equal(canTransition('IN_PROGRESS', 'COMPLETE'), true);
  assert.equal(canTransition('COMPLETE', 'SETTLED'), true);
  assert.equal(canTransition('OPEN', 'IN_PROGRESS'), false);
  assert.throws(() => assertTransition('COMPLETE', 'IN_PROGRESS'), /ILLEGAL_TRANSITION/);
});

test('challenge lifecycle supports ready, moves, completion, and timeouts', () => {
  const ready = setReady({ creatorUid: 'A', opponentUid: 'B', readyCreator: false, readyOpponent: false, readyDeadlineAt: 1000, phase: 'WAITING_READY' }, 'A', true);
  const bothReady = setReady(ready, 'B', true);
  assert.equal(shouldStartMatch(bothReady), true);

  let match = initializeMatch({ challengeId: 'C1', creatorUid: 'A', opponentUid: 'B', firstTurnUid: 'A', turnDeadlineAt: 1000 });
  match = commitAuthoritativeMove(match, 'A', 0, 100, 1100, 0, 'n1');
  assert.equal(match.currentTurnUid, 'B');
  assert.throws(() => commitAuthoritativeMove(match, 'A', 1, 200, 1200, 1), /NOT_YOUR_TURN/);
  assert.throws(() => commitAuthoritativeMove(match, 'B', 1, 1201, 1300, 1), /DEADLINE_EXPIRED/);
  const forfeit = resolveTurnTimeoutForfeit(match);
  assert.equal(forfeit.resultType, 'FORFEIT');
  assert.equal(forfeit.winnerUid, 'A');

  assert.equal(adjudicateTimeout({ status: 'OPEN', openExpiresAt: 100, now: 101 }), 'EXPIRED');
  assert.equal(adjudicateTimeout({ status: 'WAITING_READY', readyDeadlineAt: 100, now: 101 }), 'NO_SHOW_CANCEL');
  assert.equal(adjudicateTimeout({ status: 'IN_PROGRESS', turnDeadlineAt: 100, now: 101 }), 'TURN_FORFEIT');
});

test('replay and duplicate move protection reject stale indexes and reused nonces', () => {
  let match = initializeMatch({ challengeId: 'C2', creatorUid: 'A', opponentUid: 'B', firstTurnUid: 'A', turnDeadlineAt: 1000 });
  match = commitAuthoritativeMove(match, 'A', 0, 100, 1100, 0, 'nonce-a');
  assert.throws(() => commitAuthoritativeMove(match, 'B', 1, 200, 1200, 0), /INVALID_MOVE_INDEX/);
  assert.throws(() => commitAuthoritativeMove(match, 'B', 1, 200, 1200, 1, 'nonce-a'), /DUPLICATE_MOVE/);
});

test('settlement is idempotent, balance-conserving, and retry-safe', () => {
  const escrow: Connect4EscrowState = { gameType: 'CONNECT4', creatorUid: 'A', opponentUid: 'B', stake: 50, escrowedCreator: 50, escrowedOpponent: 50 };
  const store: SettlementStore = {
    wallets: { A: { uid: 'A', balance: 950 }, B: { uid: 'B', balance: 950 } },
    receipts: {},
    auditLog: [],
  };
  const settled = settleIdempotently({ escrow, store, outcome: { challengeId: 'C3', resultType: 'WIN', winnerUid: 'A', settlementTxId: 'tx1', finalizedAt: 1000 } });
  assert.equal(settled.store.wallets.A.balance, 1050);
  assert.equal(settled.store.wallets.B.balance, 950);
  assert.equal(settled.receipt.pot, 100);
  assert.equal(settled.audit?.balancesBefore.A, 950);
  assert.equal(settled.audit?.balancesAfter.A, 1050);

  const retried = retrySettlement({ escrow, store: settled.store, outcome: { challengeId: 'C3', resultType: 'WIN', winnerUid: 'A', settlementTxId: 'tx1', finalizedAt: 2000 } });
  assert.equal(retried.store.wallets.A.balance, 1050);
  assert.equal(retried.store.auditLog.length, 1);

  const draw = settleIdempotently({
    escrow,
    store: { wallets: { A: { uid: 'A', balance: 950 }, B: { uid: 'B', balance: 950 } }, receipts: {}, auditLog: [] },
    outcome: { challengeId: 'C4', resultType: 'DRAW', settlementTxId: 'tx2', finalizedAt: 1000 },
  });
  assert.equal(draw.store.wallets.A.balance, 1000);
  assert.equal(draw.store.wallets.B.balance, 1000);

  const forfeit = settleIdempotently({
    escrow,
    store: { wallets: { A: { uid: 'A', balance: 950 }, B: { uid: 'B', balance: 950 } }, receipts: {}, auditLog: [] },
    outcome: { challengeId: 'C5', resultType: 'FORFEIT', winnerUid: 'B', forfeitUid: 'A', settlementTxId: 'tx3', finalizedAt: 1000 },
  });
  assert.equal(forfeit.store.wallets.B.balance, 1050);
});

test('escrow lock rejects insufficient funds and emits audit metadata', () => {
  const escrow: Connect4EscrowState = { gameType: 'CONNECT4', creatorUid: 'A', opponentUid: 'B', stake: 50, escrowedCreator: 0, escrowedOpponent: 0 };
  assert.throws(() => lockEscrow({ challengeId: 'C6', escrow, wallets: { A: { uid: 'A', balance: 10 } }, actorUid: 'A', actor: 'CREATOR', now: 100 }), /INSUFFICIENT_FUNDS/);
  const locked = lockEscrow({ challengeId: 'C6', escrow, wallets: { A: { uid: 'A', balance: 100 } }, actorUid: 'A', actor: 'CREATOR', now: 100 });
  assert.equal(locked.wallets.A.balance, 50);
  assert.equal(locked.escrow.escrowedCreator, 50);
  assert.equal(locked.audit.reason, 'ESCROW_LOCK');
});

test('authorization, rate limits, and tamper summaries guard abuse paths', () => {
  assert.doesNotThrow(() => assertConnect4ActionAuthorized({ participants: { creatorUid: 'A', opponentUid: 'B' }, actorUid: 'A', action: 'MOVE' }));
  assert.throws(() => assertConnect4ActionAuthorized({ participants: { creatorUid: 'A', opponentUid: 'B' }, actorUid: 'C', action: 'MOVE' }), /NOT_PARTICIPANT/);

  const limiter = new Connect4RateLimiter({ MOVE_REQUEST: { windowMs: 1000, maxAttempts: 2 }, JOIN_ATTEMPT: { windowMs: 1000, maxAttempts: 1 } });
  assert.equal(limiter.check({ action: 'MOVE_REQUEST', actorUid: 'A', now: 100 }).allowed, true);
  assert.equal(limiter.check({ action: 'MOVE_REQUEST', actorUid: 'A', now: 200 }).allowed, true);
  assert.equal(limiter.check({ action: 'MOVE_REQUEST', actorUid: 'A', now: 300 }).allowed, false);

  const monitor = new Connect4TamperMonitor(2);
  assert.equal(monitor.record({ challengeId: 'C7', actorUid: 'A', reason: 'ILLEGAL_MOVE', action: 'MOVE', occurredAt: 100 }).suspicious, false);
  const summary = monitor.record({ challengeId: 'C7', actorUid: 'A', reason: 'DUPLICATE_MOVE', action: 'MOVE', occurredAt: 101 });
  assert.equal(summary.suspicious, true);
  assert.equal(summary.totalAttempts, 2);
});
