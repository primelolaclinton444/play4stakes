import { applyMove, createEmptyBoard, detectWinner, isDraw, type Connect4Board, type Connect4Player } from './engine';
import { assertTransition, type MatchStatus } from './stateMachine';

export type Connect4MoveRecord = { moveIndex: number; actorUid: string; col: number; timestamp: number };

export interface Connect4Match {
  challengeId: string;
  phase: MatchStatus;
  creatorUid: string;
  opponentUid: string;
  currentTurnUid: string;
  turnNumber: number;
  turnDeadlineAt: number;
  winnerUid?: string;
  forfeitUid?: string;
  resultType?: 'WIN' | 'DRAW' | 'FORFEIT';
  boardState: Connect4Board;
  moves: Connect4MoveRecord[];
}

export function initializeMatch(input: {
  challengeId: string;
  creatorUid: string;
  opponentUid: string;
  firstTurnUid: string;
  turnDeadlineAt: number;
}): Connect4Match {
  assertTransition('WAITING_READY', 'IN_PROGRESS');
  return {
    challengeId: input.challengeId,
    creatorUid: input.creatorUid,
    opponentUid: input.opponentUid,
    phase: 'IN_PROGRESS',
    currentTurnUid: input.firstTurnUid,
    turnNumber: 1,
    turnDeadlineAt: input.turnDeadlineAt,
    boardState: createEmptyBoard(),
    moves: [],
  };
}

export function commitAuthoritativeMove(match: Connect4Match, actorUid: string, col: number, now: number, nextDeadlineAt: number): Connect4Match {
  if (match.phase !== 'IN_PROGRESS') throw new Error('INVALID_PHASE');
  if (actorUid !== match.currentTurnUid) throw new Error('NOT_YOUR_TURN');
  if (now > match.turnDeadlineAt) throw new Error('DEADLINE_EXPIRED');

  const player: Connect4Player = actorUid === match.creatorUid ? 1 : 2;
  const { board } = applyMove(match.boardState, col, player);
  const nextMoves = [...match.moves, { moveIndex: match.moves.length, actorUid, col, timestamp: now }];

  const winner = detectWinner(board);
  if (winner) {
    const winnerUid = winner === 1 ? match.creatorUid : match.opponentUid;
    return { ...match, boardState: board, moves: nextMoves, phase: 'COMPLETE', winnerUid, resultType: 'WIN' };
  }
  if (isDraw(board)) {
    return { ...match, boardState: board, moves: nextMoves, phase: 'COMPLETE', winnerUid: undefined, resultType: 'DRAW' };
  }

  return {
    ...match,
    boardState: board,
    moves: nextMoves,
    currentTurnUid: actorUid === match.creatorUid ? match.opponentUid : match.creatorUid,
    turnNumber: match.turnNumber + 1,
    turnDeadlineAt: nextDeadlineAt,
  };
}

export function resolveTurnTimeoutForfeit(match: Connect4Match): Connect4Match {
  if (match.phase !== 'IN_PROGRESS') throw new Error('INVALID_PHASE');
  const forfeitUid = match.currentTurnUid;
  const winnerUid = forfeitUid === match.creatorUid ? match.opponentUid : match.creatorUid;
  return { ...match, phase: 'FORFEIT_COMPLETE', forfeitUid, winnerUid, resultType: 'FORFEIT' };
}


export interface ReadyState {
  creatorUid: string;
  opponentUid: string;
  readyCreator: boolean;
  readyOpponent: boolean;
  readyDeadlineAt: number;
  phase: MatchStatus;
}

export function setReady(state: ReadyState, actorUid: string, ready: boolean): ReadyState {
  if (state.phase !== 'WAITING_READY') throw new Error('INVALID_PHASE');
  if (actorUid !== state.creatorUid && actorUid !== state.opponentUid) throw new Error('UNAUTHORIZED');
  const next = { ...state };
  if (actorUid === state.creatorUid) next.readyCreator = ready;
  if (actorUid === state.opponentUid) next.readyOpponent = ready;
  return next;
}

export function shouldStartMatch(state: ReadyState): boolean {
  return state.phase === 'WAITING_READY' && state.readyCreator && state.readyOpponent;
}

export function adjudicateTimeout(input: {
  status: MatchStatus;
  openExpiresAt?: number;
  readyDeadlineAt?: number;
  turnDeadlineAt?: number;
  now: number;
}): 'EXPIRED' | 'NO_SHOW_CANCEL' | 'TURN_FORFEIT' | null {
  if (input.status === 'OPEN' && input.openExpiresAt && input.now > input.openExpiresAt) return 'EXPIRED';
  if (input.status === 'WAITING_READY' && input.readyDeadlineAt && input.now > input.readyDeadlineAt) return 'NO_SHOW_CANCEL';
  if (input.status === 'IN_PROGRESS' && input.turnDeadlineAt && input.now > input.turnDeadlineAt) return 'TURN_FORFEIT';
  return null;
}
