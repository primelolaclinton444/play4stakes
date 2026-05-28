export type MatchStatus =
  | 'OPEN'
  | 'FILLED'
  | 'WAITING_READY'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'SETTLED'
  | 'EXPIRED'
  | 'FORFEIT_COMPLETE'
  | 'NO_SHOW_CANCEL';

const legal: Record<MatchStatus, MatchStatus[]> = {
  OPEN: ['FILLED', 'EXPIRED'],
  FILLED: ['WAITING_READY'],
  WAITING_READY: ['IN_PROGRESS', 'NO_SHOW_CANCEL'],
  IN_PROGRESS: ['COMPLETE', 'FORFEIT_COMPLETE'],
  COMPLETE: ['SETTLED'],
  SETTLED: [],
  EXPIRED: [],
  FORFEIT_COMPLETE: ['SETTLED'],
  NO_SHOW_CANCEL: ['SETTLED'],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return legal[from].includes(to);
}

export function assertTransition(from: MatchStatus, to: MatchStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`ILLEGAL_TRANSITION:${from}->${to}`);
  }
}
