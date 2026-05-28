export type SettlementResultType = 'WIN' | 'DRAW' | 'FORFEIT';
export type EscrowActor = 'CREATOR' | 'OPPONENT';

export interface WalletAccount {
  uid: string;
  balance: number;
}

export interface EscrowState {
  creatorUid: string;
  opponentUid?: string;
  stake: number;
  escrowedCreator: number;
  escrowedOpponent: number;
}

export interface Connect4EscrowState extends EscrowState {
  gameType: 'CONNECT4';
}

export interface SettlementOutcome {
  challengeId: string;
  resultType: SettlementResultType;
  winnerUid?: string;
  forfeitUid?: string;
  settlementTxId: string;
  finalizedAt: number;
}

export interface SettlementReceipt {
  settlementTxId: string;
  challengeId: string;
  pot: number;
  winnerUid: string | null;
  reason: SettlementResultType;
  finalizedAt: number;
  payouts: Record<string, number>;
}

export interface SettlementAuditLogEntry {
  settlementTxId: string;
  challengeId: string;
  actorUids: string[];
  reason: SettlementResultType | 'ESCROW_LOCK';
  balancesBefore: Record<string, number>;
  balancesAfter: Record<string, number>;
  escrowBefore: Pick<EscrowState, 'escrowedCreator' | 'escrowedOpponent'>;
  escrowAfter: Pick<EscrowState, 'escrowedCreator' | 'escrowedOpponent'>;
  createdAt: number;
}

export interface SettlementStore {
  wallets: Record<string, WalletAccount>;
  receipts: Record<string, SettlementReceipt>;
  auditLog: SettlementAuditLogEntry[];
}

export function lockEscrow(input: {
  escrow: Connect4EscrowState;
  wallets: Record<string, WalletAccount>;
  actorUid: string;
  actor: EscrowActor;
  now: number;
  challengeId: string;
}): { escrow: Connect4EscrowState; wallets: Record<string, WalletAccount>; audit: SettlementAuditLogEntry } {
  const expectedUid = input.actor === 'CREATOR' ? input.escrow.creatorUid : input.escrow.opponentUid;
  validateStake(input.escrow.stake);
  if (!expectedUid || expectedUid !== input.actorUid) throw new Error('UNAUTHORIZED_ESCROW_ACTOR');

  const wallet = input.wallets[input.actorUid];
  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  if (wallet.balance < input.escrow.stake) throw new Error('INSUFFICIENT_FUNDS');

  const escrowField = input.actor === 'CREATOR' ? 'escrowedCreator' : 'escrowedOpponent';
  if (input.escrow[escrowField] >= input.escrow.stake) {
    throw new Error('ESCROW_ALREADY_LOCKED');
  }

  const balancesBefore = { [input.actorUid]: wallet.balance };
  const escrowBefore = snapshotEscrow(input.escrow);
  const wallets = cloneWallets(input.wallets);
  wallets[input.actorUid] = { ...wallets[input.actorUid], balance: wallet.balance - input.escrow.stake };
  const escrow = { ...input.escrow, [escrowField]: input.escrow.stake };
  const balancesAfter = { [input.actorUid]: wallets[input.actorUid].balance };

  return {
    escrow,
    wallets,
    audit: {
      settlementTxId: `escrow_${input.challengeId}_${input.actor}_${input.actorUid}_${input.now}`,
      challengeId: input.challengeId,
      actorUids: [input.actorUid],
      reason: 'ESCROW_LOCK',
      balancesBefore,
      balancesAfter,
      escrowBefore,
      escrowAfter: snapshotEscrow(escrow),
      createdAt: input.now,
    },
  };
}

export function settleIdempotently(input: {
  escrow: Connect4EscrowState;
  store: SettlementStore;
  outcome: SettlementOutcome;
}): { store: SettlementStore; escrow: Connect4EscrowState; receipt: SettlementReceipt; audit?: SettlementAuditLogEntry } {
  const existing = input.store.receipts[input.outcome.settlementTxId] ?? findReceiptByChallengeId(input.store, input.outcome.challengeId);
  if (existing) {
    return { store: input.store, escrow: input.escrow, receipt: existing };
  }

  validateStake(input.escrow.stake);
  if (!input.escrow.opponentUid) throw new Error('OPPONENT_REQUIRED_FOR_SETTLEMENT');
  if (input.escrow.opponentUid === input.escrow.creatorUid) throw new Error('PLAYERS_MUST_DIFFER');
  const creatorWallet = input.store.wallets[input.escrow.creatorUid];
  const opponentWallet = input.store.wallets[input.escrow.opponentUid];
  if (!creatorWallet || !opponentWallet) throw new Error('WALLET_NOT_FOUND');

  const pot = input.escrow.escrowedCreator + input.escrow.escrowedOpponent;
  if (input.escrow.escrowedCreator !== input.escrow.stake || input.escrow.escrowedOpponent !== input.escrow.stake) {
    throw new Error('ESCROW_NOT_FULLY_LOCKED');
  }

  const payouts = resolvePayouts(input.escrow, input.outcome, pot);
  const wallets = cloneWallets(input.store.wallets);
  const actorUids = [input.escrow.creatorUid, input.escrow.opponentUid];
  const balancesBefore = Object.fromEntries(actorUids.map((uid) => [uid, wallets[uid].balance]));

  for (const [uid, amount] of Object.entries(payouts)) {
    wallets[uid] = { ...wallets[uid], balance: wallets[uid].balance + amount };
  }

  const receipt: SettlementReceipt = {
    settlementTxId: input.outcome.settlementTxId,
    challengeId: input.outcome.challengeId,
    pot,
    winnerUid: input.outcome.winnerUid ?? null,
    reason: input.outcome.resultType,
    finalizedAt: input.outcome.finalizedAt,
    payouts,
  };
  const balancesAfter = Object.fromEntries(actorUids.map((uid) => [uid, wallets[uid].balance]));
  const escrow = { ...input.escrow, escrowedCreator: 0, escrowedOpponent: 0 };
  const escrowAfter = snapshotEscrow(escrow);
  const audit: SettlementAuditLogEntry = {
    settlementTxId: input.outcome.settlementTxId,
    challengeId: input.outcome.challengeId,
    actorUids,
    reason: input.outcome.resultType,
    balancesBefore,
    balancesAfter,
    escrowBefore: snapshotEscrow(input.escrow),
    escrowAfter,
    createdAt: input.outcome.finalizedAt,
  };

  return {
    store: {
      wallets,
      receipts: { ...input.store.receipts, [receipt.settlementTxId]: receipt },
      auditLog: [...input.store.auditLog, audit],
    },
    escrow,
    receipt,
    audit,
  };
}

export function retrySettlement(input: {
  escrow: Connect4EscrowState;
  store: SettlementStore;
  outcome: SettlementOutcome;
}): { store: SettlementStore; escrow: Connect4EscrowState; receipt: SettlementReceipt; audit?: SettlementAuditLogEntry } {
  return settleIdempotently(input);
}

function findReceiptByChallengeId(store: SettlementStore, challengeId: string): SettlementReceipt | undefined {
  return Object.values(store.receipts).find((receipt) => receipt.challengeId === challengeId);
}

function resolvePayouts(escrow: Connect4EscrowState, outcome: SettlementOutcome, pot: number): Record<string, number> {
  if (!escrow.opponentUid) throw new Error('OPPONENT_REQUIRED_FOR_SETTLEMENT');
  if (outcome.resultType === 'DRAW') {
    return {
      [escrow.creatorUid]: escrow.escrowedCreator,
      [escrow.opponentUid]: escrow.escrowedOpponent,
    };
  }

  if (!outcome.winnerUid) throw new Error('WINNER_REQUIRED');
  if (outcome.winnerUid !== escrow.creatorUid && outcome.winnerUid !== escrow.opponentUid) throw new Error('WINNER_NOT_PARTICIPANT');
  if (outcome.resultType === 'FORFEIT' && outcome.forfeitUid === outcome.winnerUid) throw new Error('FORFEITER_CANNOT_WIN');
  return { [outcome.winnerUid]: pot };
}

function cloneWallets(wallets: Record<string, WalletAccount>): Record<string, WalletAccount> {
  return Object.fromEntries(Object.entries(wallets).map(([uid, wallet]) => [uid, { ...wallet }]));
}

function snapshotEscrow(escrow: EscrowState): Pick<EscrowState, 'escrowedCreator' | 'escrowedOpponent'> {
  return { escrowedCreator: escrow.escrowedCreator, escrowedOpponent: escrow.escrowedOpponent };
}

function validateStake(stake: number): void {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('INVALID_STAKE');
}
