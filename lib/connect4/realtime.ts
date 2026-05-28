import { connect4Policy } from '@/config/connect4/policy';
import type { Connect4Board } from './engine';
import type { Connect4MoveRecord } from './service';
import type { SettlementReceipt } from './settlement';
import type { MatchStatus } from './stateMachine';

export type Connect4RealtimeEventType =
  | 'ready_status'
  | 'move_committed'
  | 'timeout'
  | 'settled'
  | 'presence_changed';

export interface MatchParticipants {
  creatorUid: string;
  opponentUid: string;
}

export interface Connect4RealtimeEnvelope<TPayload> {
  type: Connect4RealtimeEventType;
  challengeId: string;
  challengeCode: string;
  occurredAt: number;
  sequence: number;
  payload: TPayload;
}

export type ReadyStatusPayload = {
  readyCreator: boolean;
  readyOpponent: boolean;
  readyDeadlineAt: number;
};

export type MoveCommittedPayload = {
  move: Connect4MoveRecord;
  boardState: Connect4Board;
  currentTurnUid?: string;
  turnNumber: number;
  turnDeadlineAt?: number;
  resultType?: 'WIN' | 'DRAW';
  winnerUid?: string;
};

export type TimeoutPayload = {
  outcome: 'EXPIRED' | 'NO_SHOW_CANCEL' | 'TURN_FORFEIT';
  forfeitUid?: string;
  winnerUid?: string;
  reason: string;
};

export type SettledPayload = {
  receipt: SettlementReceipt;
};

export type PresenceState = 'CONNECTED' | 'DISCONNECTED';

export type PresencePayload = {
  uid: string;
  state: PresenceState;
  lastSeenAt: number;
};

export type Connect4RealtimeEvent =
  | Connect4RealtimeEnvelope<ReadyStatusPayload>
  | Connect4RealtimeEnvelope<MoveCommittedPayload>
  | Connect4RealtimeEnvelope<TimeoutPayload>
  | Connect4RealtimeEnvelope<SettledPayload>
  | Connect4RealtimeEnvelope<PresencePayload>;

export type Connect4RealtimeHandler = (event: Connect4RealtimeEvent) => void;
export type ParticipantResolver = (challengeId: string) => MatchParticipants | undefined;

export interface ChannelSubscription {
  challengeId: string;
  uid: string;
  unsubscribe: () => void;
}

export class Connect4RealtimeHub {
  private readonly subscribers = new Map<string, Map<string, Map<string, Connect4RealtimeHandler>>>();
  private readonly sequences = new Map<string, number>();

  constructor(private readonly resolveParticipants: ParticipantResolver) {}

  subscribe(challengeId: string, uid: string, handler: Connect4RealtimeHandler): ChannelSubscription {
    assertParticipant(this.resolveParticipants, challengeId, uid);
    const byUser = this.subscribers.get(challengeId) ?? new Map<string, Map<string, Connect4RealtimeHandler>>();
    const handlers = byUser.get(uid) ?? new Map<string, Connect4RealtimeHandler>();
    const subscriptionId = `${uid}:${Date.now()}:${handlers.size}`;
    handlers.set(subscriptionId, handler);
    byUser.set(uid, handlers);
    this.subscribers.set(challengeId, byUser);

    return {
      challengeId,
      uid,
      unsubscribe: () => {
        const currentByUser = this.subscribers.get(challengeId);
        const currentHandlers = currentByUser?.get(uid);
        currentHandlers?.delete(subscriptionId);
        if (currentHandlers?.size === 0) currentByUser?.delete(uid);
        if (currentByUser?.size === 0) this.subscribers.delete(challengeId);
      },
    };
  }

  publish<TPayload>(event: Omit<Connect4RealtimeEnvelope<TPayload>, 'sequence'>): Connect4RealtimeEnvelope<TPayload> {
    validateEnvelope(event);
    const participants = this.resolveParticipants(event.challengeId);
    if (!participants) throw new Error('MATCH_NOT_FOUND');
    const sequence = (this.sequences.get(event.challengeId) ?? 0) + 1;
    this.sequences.set(event.challengeId, sequence);
    const sequenced = { ...event, sequence };
    const byUser = this.subscribers.get(event.challengeId);
    const allowedUids = new Set([participants.creatorUid, participants.opponentUid]);

    for (const [uid, handlers] of byUser ?? []) {
      if (!allowedUids.has(uid)) continue;
      for (const handler of handlers.values()) {
        handler(sequenced as Connect4RealtimeEvent);
      }
    }

    return sequenced;
  }
}

export class Connect4PresenceTracker {
  private readonly lastSeen = new Map<string, Map<string, number>>();

  constructor(private readonly resolveParticipants: ParticipantResolver) {}

  heartbeat(input: { challengeId: string; uid: string; now: number }): PresencePayload {
    assertParticipant(this.resolveParticipants, input.challengeId, input.uid);
    if (!Number.isFinite(input.now) || input.now <= 0) throw new Error('INVALID_TIMESTAMP');
    const byUser = this.lastSeen.get(input.challengeId) ?? new Map<string, number>();
    byUser.set(input.uid, input.now);
    this.lastSeen.set(input.challengeId, byUser);
    return { uid: input.uid, state: 'CONNECTED', lastSeenAt: input.now };
  }

  getPresence(challengeId: string, uid: string, now: number): PresencePayload {
    assertParticipant(this.resolveParticipants, challengeId, uid);
    if (!Number.isFinite(now) || now <= 0) throw new Error('INVALID_TIMESTAMP');
    const lastSeenAt = this.lastSeen.get(challengeId)?.get(uid) ?? 0;
    const state: PresenceState = lastSeenAt > 0 && now - lastSeenAt <= connect4Policy.reconnectGraceMs ? 'CONNECTED' : 'DISCONNECTED';
    return { uid, state, lastSeenAt };
  }
}

export interface CanonicalMatchSnapshot {
  challengeId: string;
  challengeCode: string;
  boardState: Connect4Board;
  moves: Connect4MoveRecord[];
  phase: MatchStatus;
  currentTurnUid?: string;
  turnNumber?: number;
  turnDeadlineAt?: number;
  readyCreator?: boolean;
  readyOpponent?: boolean;
  readyDeadlineAt?: number;
  winnerUid?: string;
  resultType?: 'WIN' | 'DRAW' | 'FORFEIT';
  forfeitUid?: string;
  settlementReceipt?: SettlementReceipt;
}

export type SnapshotResolver = (challengeId: string) => CanonicalMatchSnapshot | undefined;

export function rejoinAndResync(input: {
  challengeId: string;
  uid: string;
  resolveParticipants: ParticipantResolver;
  resolveSnapshot: SnapshotResolver;
  presence: Connect4PresenceTracker;
  now: number;
}): { snapshot: CanonicalMatchSnapshot; presence: PresencePayload } {
  assertParticipant(input.resolveParticipants, input.challengeId, input.uid);
  const snapshot = input.resolveSnapshot(input.challengeId);
  if (!snapshot) throw new Error('MATCH_NOT_FOUND');
  const presence = input.presence.heartbeat({ challengeId: input.challengeId, uid: input.uid, now: input.now });
  return { snapshot, presence };
}

function assertParticipant(resolveParticipants: ParticipantResolver, challengeId: string, uid: string): void {
  if (!challengeId) throw new Error('CHALLENGE_ID_REQUIRED');
  if (!uid) throw new Error('UID_REQUIRED');
  const participants = resolveParticipants(challengeId);
  if (!participants) throw new Error('MATCH_NOT_FOUND');
  if (uid !== participants.creatorUid && uid !== participants.opponentUid) throw new Error('UNAUTHORIZED_PARTICIPANT');
}

function validateEnvelope<TPayload>(event: Omit<Connect4RealtimeEnvelope<TPayload>, 'sequence'>): void {
  if (!event.challengeId) throw new Error('CHALLENGE_ID_REQUIRED');
  if (!event.challengeCode) throw new Error('CHALLENGE_CODE_REQUIRED');
  if (!Number.isFinite(event.occurredAt) || event.occurredAt <= 0) throw new Error('INVALID_TIMESTAMP');
  if (!event.payload) throw new Error('PAYLOAD_REQUIRED');
}
