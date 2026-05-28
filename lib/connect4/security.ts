export type Connect4Action = 'READY' | 'MOVE' | 'VIEW_PRIVATE_EVENTS' | 'JOIN' | 'REJOIN';
export type RateLimitAction = 'MOVE_REQUEST' | 'JOIN_ATTEMPT';
export type TamperReason =
  | 'UNAUTHORIZED_ACTION'
  | 'INVALID_MOVE_INDEX'
  | 'DUPLICATE_MOVE'
  | 'RATE_LIMITED'
  | 'ILLEGAL_MOVE'
  | 'INVALID_NONCE';

export interface Connect4Participants {
  creatorUid: string;
  opponentUid?: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: 'NOT_AUTHENTICATED' | 'NOT_PARTICIPANT' | 'OPPONENT_REQUIRED';
}

export interface ReplayGuardState {
  lastMoveIndex: number;
  usedNonces: ReadonlySet<string>;
}

export interface RateLimitRule {
  windowMs: number;
  maxAttempts: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface TamperEvent {
  challengeId: string;
  actorUid: string;
  reason: TamperReason;
  action: Connect4Action | RateLimitAction;
  occurredAt: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TamperSummary {
  actorUid: string;
  challengeId: string;
  totalAttempts: number;
  reasons: Record<TamperReason, number>;
  suspicious: boolean;
}

const defaultRules: Record<RateLimitAction, RateLimitRule> = {
  MOVE_REQUEST: { windowMs: 10_000, maxAttempts: 20 },
  JOIN_ATTEMPT: { windowMs: 60_000, maxAttempts: 5 },
};

export function authorizeConnect4Action(input: {
  participants: Connect4Participants;
  actorUid?: string | null;
  action: Connect4Action;
}): AuthorizationDecision {
  if (!input.actorUid) return { allowed: false, reason: 'NOT_AUTHENTICATED' };
  if (input.action !== 'JOIN' && !input.participants.opponentUid) {
    return { allowed: false, reason: 'OPPONENT_REQUIRED' };
  }
  if (input.actorUid !== input.participants.creatorUid && input.actorUid !== input.participants.opponentUid) {
    return { allowed: false, reason: 'NOT_PARTICIPANT' };
  }
  return { allowed: true };
}

export function assertConnect4ActionAuthorized(input: {
  participants: Connect4Participants;
  actorUid?: string | null;
  action: Connect4Action;
}): void {
  const decision = authorizeConnect4Action(input);
  if (!decision.allowed) throw new Error(decision.reason ?? 'UNAUTHORIZED_ACTION');
}

export function assertMoveReplaySafe(input: {
  expectedMoveIndex: number;
  providedMoveIndex: number;
  nonce?: string;
  replayState: ReplayGuardState;
}): void {
  if (!Number.isInteger(input.providedMoveIndex) || input.providedMoveIndex !== input.expectedMoveIndex) {
    throw new Error('INVALID_MOVE_INDEX');
  }
  if (input.providedMoveIndex <= input.replayState.lastMoveIndex) {
    throw new Error('DUPLICATE_MOVE');
  }
  if (input.nonce !== undefined) {
    if (!input.nonce.trim()) throw new Error('INVALID_NONCE');
    if (input.replayState.usedNonces.has(input.nonce)) throw new Error('DUPLICATE_MOVE');
  }
}

export class Connect4RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly rules: Record<RateLimitAction, RateLimitRule> = defaultRules) {}

  check(input: { action: RateLimitAction; actorUid: string; now: number }): RateLimitDecision {
    if (!input.actorUid) throw new Error('UID_REQUIRED');
    if (!Number.isFinite(input.now) || input.now <= 0) throw new Error('INVALID_TIMESTAMP');

    const rule = this.rules[input.action];
    const key = `${input.action}:${input.actorUid}`;
    const cutoff = input.now - rule.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((ts) => ts > cutoff);
    const resetAt = recent.length > 0 ? recent[0] + rule.windowMs : input.now + rule.windowMs;

    if (recent.length >= rule.maxAttempts) {
      this.attempts.set(key, recent);
      return { allowed: false, remaining: 0, resetAt };
    }

    const updated = [...recent, input.now];
    this.attempts.set(key, updated);
    return { allowed: true, remaining: Math.max(0, rule.maxAttempts - updated.length), resetAt: updated[0] + rule.windowMs };
  }
}

export class Connect4TamperMonitor {
  private readonly events: TamperEvent[] = [];

  constructor(private readonly suspiciousThreshold = 3) {}

  record(event: TamperEvent): TamperSummary {
    if (!event.challengeId) throw new Error('CHALLENGE_ID_REQUIRED');
    if (!event.actorUid) throw new Error('UID_REQUIRED');
    if (!Number.isFinite(event.occurredAt) || event.occurredAt <= 0) throw new Error('INVALID_TIMESTAMP');
    this.events.push({ ...event });
    return this.summarize(event.challengeId, event.actorUid);
  }

  summarize(challengeId: string, actorUid: string): TamperSummary {
    const relevant = this.events.filter((event) => event.challengeId === challengeId && event.actorUid === actorUid);
    const reasons = relevant.reduce<Record<TamperReason, number>>((acc, event) => {
      acc[event.reason] = (acc[event.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<TamperReason, number>);

    return {
      actorUid,
      challengeId,
      totalAttempts: relevant.length,
      reasons,
      suspicious: relevant.length >= this.suspiciousThreshold,
    };
  }

  listEvents(): TamperEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}
