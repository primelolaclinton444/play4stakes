export type NoShowPolicy =
  | 'REFUND_BOTH'
  | 'CREATOR_WINS_BY_NO_SHOW'
  | 'OPPONENT_WINS_BY_NO_SHOW';

export type ForfeitPolicy = 'NON_FORFEITING_PLAYER_TAKES_POT';

export interface Connect4Policy {
  version: '2026-05-23.v1';
  openExpiresInMs: number;
  readyTimeoutMs: number;
  turnTimeoutMs: number;
  reconnectGraceMs: number;
  noShowPolicy: NoShowPolicy;
  forfeitPolicy: ForfeitPolicy;
}

/**
 * Product/policy freeze for synchronous Connect4 staked play.
 *
 * Notes:
 * - Deadlines are server authoritative.
 * - reconnectGraceMs is a UX/presence signal only; it does not extend turn deadlines.
 */
export const connect4Policy: Connect4Policy = {
  version: '2026-05-23.v1',
  openExpiresInMs: 5 * 60 * 1000,
  readyTimeoutMs: 30 * 1000,
  turnTimeoutMs: 30 * 1000,
  reconnectGraceMs: 10 * 1000,
  noShowPolicy: 'REFUND_BOTH',
  forfeitPolicy: 'NON_FORFEITING_PLAYER_TAKES_POT',
};
