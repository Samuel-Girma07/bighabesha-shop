import Database from 'better-sqlite3';
import { getDatabase, prepared } from './index.js';
import { logger } from '../logger/index.js';
import {
  SupportedBank,
  ReceiptInputSource,
  ReceiptMimeType,
  VerificationStatus,
  VerificationFailureCode,
  SecurityPillarEvaluation,
  VerificationAuditRecord,
  EvidenceQueryFilter,
  PaginatedResult,
  ReceiptAlreadyUsedError,
} from '../services/receipt_verifier/types.js';

// ============================================================================
// Database Row Representations
// ============================================================================

export interface ReceiptEvidenceRow {
  id: number;
  order_id: string;
  user_id: number;
  bank: SupportedBank;
  source: ReceiptInputSource;
  raw_text: string | null;
  amount_etb: number | null;
  reference: string | null;
  normalized_reference: string | null;
  matched: number;
  verified_amount_etb: number | null;
  beneficiary_account: string | null;
  security_gate_passed: number;
  security_gate_evaluations: string | null;
  status: VerificationStatus;
  error_code: VerificationFailureCode | null;
  raw_bank_payload: string | null;
  file_path: string | null;
  file_hash: string | null;
  mime_type: ReceiptMimeType | null;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankVerificationAuditRow {
  id: number;
  evidence_id: number | null;
  order_id: string;
  user_id: number;
  bank: SupportedBank;
  raw_reference: string | null;
  normalized_reference: string;
  order_amount_etb: number;
  verified_amount_etb: number | null;
  fee_etb: number;
  currency: string;
  sender_name: string | null;
  sender_identifier: string | null;
  beneficiary_account: string | null;
  beneficiary_name: string | null;
  transaction_timestamp: string | null;
  payment_channel: string | null;
  security_gate_passed: number;
  security_gate_evaluations: string | null;
  status: VerificationStatus;
  error_code: VerificationFailureCode | null;
  error_detail: string | null;
  raw_bank_payload: string | null;
  raw_evidence_snippet: string | null;
  http_status: number | null;
  latency_ms: number | null;
  ip_address: string | null;
  attempt_number: number;
  verified_by: string;
  created_at: string;
}

// ============================================================================
// DTOs & Function Signatures
// ============================================================================

export interface CreateReceiptEvidenceInput {
  orderId: string;
  userId: number;
  bank?: SupportedBank;
  source: ReceiptInputSource;
  rawText?: string | null;
  amountEtb?: number | null;
  reference?: string | null;
  filePath?: string | null;
  fileHash?: string | null;
  mimeType?: ReceiptMimeType | null;
  ipAddress?: string | null;
  status?: VerificationStatus;
}

export interface MarkEvidenceMatchedInput {
  evidenceId: number;
  bank: SupportedBank;
  reference: string;
  normalizedReference: string;
  verifiedAmountEtb: number;
  beneficiaryAccount: string;
  securityGateEvaluations: SecurityPillarEvaluation[];
  rawBankPayload?: Record<string, unknown> | null;
}

export interface CreateBankVerificationAuditInput {
  evidenceId?: number | null;
  orderId: string;
  userId: number;
  bank: SupportedBank;
  rawReference?: string | null;
  normalizedReference: string;
  orderAmountEtb: number;
  verifiedAmountEtb?: number | null;
  feeEtb?: number;
  currency?: string;
  senderName?: string | null;
  senderIdentifier?: string | null;
  beneficiaryAccount?: string | null;
  beneficiaryName?: string | null;
  transactionTimestamp?: Date | string | null;
  paymentChannel?: string | null;
  securityGatePassed: boolean;
  securityGateEvaluations?: SecurityPillarEvaluation[];
  status: VerificationStatus;
  errorCode?: VerificationFailureCode | null;
  errorDetail?: string | null;
  rawBankPayload?: Record<string, unknown> | null;
  rawEvidenceSnippet?: string | null;
  httpStatus?: number | null;
  latencyMs?: number | null;
  ipAddress?: string | null;
  attemptNumber?: number;
  verifiedBy?: string;
}

export interface AntiReplayCheckResult {
  isReplay: boolean;
  existingOrderId?: string;
  matchedAt?: string;
}

export interface PruneResult {
  rawPayloadsPruned: number;
  unverifiedDeleted: number;
}

// ============================================================================
// Helper Mapping Functions
// ============================================================================

export function toVerificationAuditRecord(row: ReceiptEvidenceRow): VerificationAuditRecord {
  let securityGateEvaluations: SecurityPillarEvaluation[] | undefined;
  if (row.security_gate_evaluations) {
    try {
      securityGateEvaluations = JSON.parse(row.security_gate_evaluations);
    } catch {
      securityGateEvaluations = undefined;
    }
  }

  let rawBankPayload: Record<string, unknown> | undefined;
  if (row.raw_bank_payload) {
    try {
      rawBankPayload = JSON.parse(row.raw_bank_payload);
    } catch {
      rawBankPayload = undefined;
    }
  }

  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    source: row.source,
    bank: row.bank,
    rawReference: row.reference ?? undefined,
    normalizedReference: row.normalized_reference ?? undefined,
    amountEtb: row.amount_etb ?? undefined,
    verifiedAmountEtb: row.verified_amount_etb ?? undefined,
    beneficiaryAccount: row.beneficiary_account ?? undefined,
    securityGatePassed: row.security_gate_passed === 1,
    securityGateEvaluations,
    status: row.status,
    errorCode: row.error_code ?? undefined,
    rawBankPayload,
    ipAddress: row.ip_address ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Receipt Evidence DAO Methods
// ============================================================================

/**
 * Inserts a new receipt evidence submission into SQLite.
 */
export function insertReceiptEvidence(
  input: CreateReceiptEvidenceInput,
  db: Database.Database = getDatabase()
): ReceiptEvidenceRow {
  const normalized = input.reference?.trim() ? input.reference.trim().toUpperCase() : null;

  const stmt = db.prepare(`
    INSERT INTO receipt_evidence (
      order_id, user_id, bank, source, raw_text, amount_etb,
      reference, normalized_reference, matched, status,
      file_path, file_hash, mime_type, ip_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.orderId,
    input.userId,
    input.bank || 'unknown',
    input.source,
    input.rawText || null,
    input.amountEtb ?? null,
    input.reference?.trim() || null,
    normalized,
    input.status || 'pending_manual_review',
    input.filePath || null,
    input.fileHash || null,
    input.mimeType || null,
    input.ipAddress || null
  );

  const row = db.prepare('SELECT * FROM receipt_evidence WHERE id = ?').get(result.lastInsertRowid) as ReceiptEvidenceRow;
  return row;
}

/**
 * Retrieves a receipt evidence row by primary key.
 */
export function getReceiptEvidenceById(
  id: number,
  db: Database.Database = getDatabase()
): ReceiptEvidenceRow | null {
  const row = db.prepare('SELECT * FROM receipt_evidence WHERE id = ?').get(id) as ReceiptEvidenceRow | undefined;
  return row || null;
}

/**
 * Retrieves the latest evidence submission for a given order.
 */
export function getLatestEvidenceForOrder(
  orderId: string,
  db: Database.Database = getDatabase()
): ReceiptEvidenceRow | null {
  const row = db.prepare(`
    SELECT * FROM receipt_evidence
    WHERE order_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(orderId) as ReceiptEvidenceRow | undefined;

  return row || null;
}

/**
 * Retrieves all evidence submissions for an order.
 */
export function getEvidenceForOrder(
  orderId: string,
  db: Database.Database = getDatabase()
): ReceiptEvidenceRow[] {
  return db.prepare(`
    SELECT * FROM receipt_evidence
    WHERE order_id = ?
    ORDER BY created_at ASC
  `).all(orderId) as ReceiptEvidenceRow[];
}

/**
 * Searches for a duplicate file upload across all receipts using SHA-256 hash.
 */
export function findDuplicateFileHash(
  fileHash: string,
  db: Database.Database = getDatabase()
): ReceiptEvidenceRow | null {
  const row = db.prepare(`
    SELECT * FROM receipt_evidence
    WHERE file_hash = ?
    LIMIT 1
  `).get(fileHash) as ReceiptEvidenceRow | undefined;

  return row || null;
}

/**
 * Pillar 1: Anti-Replay Assertion Query.
 * Checks whether this transaction reference was already verified and matched to another order.
 */
export function checkAntiReplay(
  bank: SupportedBank,
  reference: string,
  excludeOrderId?: string,
  db: Database.Database = getDatabase()
): AntiReplayCheckResult {
  const cleanRef = reference.trim().toUpperCase();
  if (!cleanRef) {
    return { isReplay: false };
  }

  const query = `
    SELECT id, order_id, created_at
    FROM receipt_evidence
    WHERE bank = ?
      AND (reference = ? COLLATE NOCASE OR normalized_reference = ?)
      AND matched = 1
      ${excludeOrderId ? 'AND order_id != ?' : ''}
    LIMIT 1
  `;

  const params = excludeOrderId
    ? [bank, cleanRef, cleanRef, excludeOrderId]
    : [bank, cleanRef, cleanRef];

  const matched = db.prepare(query).get(...params) as { id: number; order_id: string; created_at: string } | undefined;

  if (matched) {
    return {
      isReplay: true,
      existingOrderId: matched.order_id,
      matchedAt: matched.created_at,
    };
  }

  return { isReplay: false };
}

/**
 * Marks receipt evidence as successfully verified and matched within an active transaction.
 * Enforces the UNIQUE partial index on (bank, reference) WHERE matched = 1.
 * Throws ReceiptAlreadyUsedError if another process already claimed this reference.
 */
export function markEvidenceMatchedInTx(
  db: Database.Database,
  input: MarkEvidenceMatchedInput
): ReceiptEvidenceRow {
  const cleanRef = input.reference.trim();
  const normalized = input.normalizedReference.trim().toUpperCase();

  try {
    const updateStmt = db.prepare(`
      UPDATE receipt_evidence
      SET matched = 1,
          bank = ?,
          reference = ?,
          normalized_reference = ?,
          verified_amount_etb = ?,
          beneficiary_account = ?,
          security_gate_passed = 1,
          security_gate_evaluations = ?,
          status = 'auto_verified',
          error_code = NULL,
          raw_bank_payload = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    updateStmt.run(
      input.bank,
      cleanRef,
      normalized,
      input.verifiedAmountEtb,
      input.beneficiaryAccount,
      JSON.stringify(input.securityGateEvaluations),
      input.rawBankPayload ? JSON.stringify(input.rawBankPayload) : null,
      input.evidenceId
    );

    const updatedRow = db.prepare('SELECT * FROM receipt_evidence WHERE id = ?').get(input.evidenceId) as ReceiptEvidenceRow;
    return updatedRow;
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.message?.includes('UNIQUE constraint failed')) {
      logger.warn(
        { bank: input.bank, reference: cleanRef, evidenceId: input.evidenceId },
        'Anti-Replay unique index collision in markEvidenceMatchedInTx'
      );
      throw new ReceiptAlreadyUsedError(cleanRef);
    }
    throw err;
  }
}

/**
 * Updates receipt evidence status and optional error code when verification fails or requires manual review.
 */
export function updateEvidenceStatus(
  evidenceId: number,
  status: VerificationStatus,
  errorCode?: VerificationFailureCode | null,
  rawBankPayload?: Record<string, unknown> | null,
  db: Database.Database = getDatabase()
): void {
  db.prepare(`
    UPDATE receipt_evidence
    SET status = ?,
        error_code = ?,
        raw_bank_payload = COALESCE(?, raw_bank_payload),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status,
    errorCode || null,
    rawBankPayload ? JSON.stringify(rawBankPayload) : null,
    evidenceId
  );
}

// ============================================================================
// Bank Verification Audits DAO Methods
// ============================================================================

/**
 * Inserts a granular attempt-level audit record into bank_verification_audits.
 */
export function insertVerificationAudit(
  input: CreateBankVerificationAuditInput,
  db: Database.Database = getDatabase()
): number {
  const stmt = db.prepare(`
    INSERT INTO bank_verification_audits (
      evidence_id, order_id, user_id, bank, raw_reference, normalized_reference,
      order_amount_etb, verified_amount_etb, fee_etb, currency, sender_name,
      sender_identifier, beneficiary_account, beneficiary_name, transaction_timestamp,
      payment_channel, security_gate_passed, security_gate_evaluations, status,
      error_code, error_detail, raw_bank_payload, raw_evidence_snippet, http_status,
      latency_ms, ip_address, attempt_number, verified_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const txTimestamp = input.transactionTimestamp instanceof Date
    ? input.transactionTimestamp.toISOString()
    : input.transactionTimestamp || null;

  const result = stmt.run(
    input.evidenceId ?? null,
    input.orderId,
    input.userId,
    input.bank,
    input.rawReference || null,
    input.normalizedReference.trim().toUpperCase(),
    input.orderAmountEtb,
    input.verifiedAmountEtb ?? null,
    input.feeEtb ?? 0,
    input.currency || 'ETB',
    input.senderName || null,
    input.senderIdentifier || null,
    input.beneficiaryAccount || null,
    input.beneficiaryName || null,
    txTimestamp,
    input.paymentChannel || null,
    input.securityGatePassed ? 1 : 0,
    input.securityGateEvaluations ? JSON.stringify(input.securityGateEvaluations) : null,
    input.status,
    input.errorCode || null,
    input.errorDetail || null,
    input.rawBankPayload ? JSON.stringify(input.rawBankPayload) : null,
    input.rawEvidenceSnippet || null,
    input.httpStatus ?? null,
    input.latencyMs ?? null,
    input.ipAddress || null,
    input.attemptNumber ?? 1,
    input.verifiedBy || 'engine'
  );

  return Number(result.lastInsertRowid);
}

/**
 * Retrieves all verification audit attempts for an order.
 */
export function getAuditsForOrder(
  orderId: string,
  db: Database.Database = getDatabase()
): BankVerificationAuditRow[] {
  return db.prepare(`
    SELECT * FROM bank_verification_audits
    WHERE order_id = ?
    ORDER BY created_at ASC
  `).all(orderId) as BankVerificationAuditRow[];
}

// ============================================================================
// Admin Queries & Pagination
// ============================================================================

/**
 * Queries receipt evidence records with filtering and pagination for admin dashboards.
 */
export function queryEvidence(
  filter: EvidenceQueryFilter,
  db: Database.Database = getDatabase()
): PaginatedResult<VerificationAuditRecord> {
  const page = Math.max(1, filter.page || 1);
  const limit = Math.min(100, Math.max(1, filter.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filter.orderId) {
    conditions.push('order_id = ?');
    params.push(filter.orderId);
  }

  if (filter.userId) {
    conditions.push('user_id = ?');
    params.push(filter.userId);
  }

  if (filter.bank) {
    conditions.push('bank = ?');
    params.push(filter.bank);
  }

  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }

  if (filter.reference) {
    conditions.push('(reference LIKE ? COLLATE NOCASE OR normalized_reference LIKE ?)');
    params.push(`%${filter.reference.trim()}%`, `%${filter.reference.trim().toUpperCase()}%`);
  }

  if (filter.startDate) {
    conditions.push('created_at >= ?');
    params.push(filter.startDate);
  }

  if (filter.endDate) {
    conditions.push('created_at <= ?');
    params.push(filter.endDate);
  }

  const whereClause = conditions.join(' AND ');

  const countRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM receipt_evidence
    WHERE ${whereClause}
  `).get(...params) as { total: number };

  const total = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(total / limit);

  const rows = db.prepare(`
    SELECT *
    FROM receipt_evidence
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ReceiptEvidenceRow[];

  const items = rows.map(toVerificationAuditRecord);

  return {
    items,
    total,
    page,
    limit,
    totalPages,
  };
}

// ============================================================================
// Lifecycle Management & Pruning
// ============================================================================

/**
 * Executes retention pruning:
 * 1. Truncates heavy raw HTML/JSON payloads older than `daysRaw` days.
 * 2. Purges unverified, stale attempts older than `daysUnverified` days.
 */
export function pruneStaleEvidence(
  daysRaw: number = 14,
  daysUnverified: number = 30,
  db: Database.Database = getDatabase()
): PruneResult {
  let rawPayloadsPruned = 0;
  let unverifiedDeleted = 0;

  const pruneTx = db.transaction(() => {
    // 1. Truncate heavy diagnostic payloads from audits older than daysRaw
    const auditPayloadResult = db.prepare(`
      UPDATE bank_verification_audits
      SET raw_bank_payload = NULL,
          raw_evidence_snippet = NULL
      WHERE created_at < datetime('now', '-' || ? || ' days')
        AND (raw_bank_payload IS NOT NULL OR raw_evidence_snippet IS NOT NULL)
    `).run(daysRaw);

    // Also null out raw_bank_payload on receipt_evidence older than daysRaw
    const evidencePayloadResult = db.prepare(`
      UPDATE receipt_evidence
      SET raw_bank_payload = NULL
      WHERE created_at < datetime('now', '-' || ? || ' days')
        AND raw_bank_payload IS NOT NULL
    `).run(daysRaw);

    rawPayloadsPruned = auditPayloadResult.changes + evidencePayloadResult.changes;

    // 2. Delete unverified rejected/failed evidence older than daysUnverified
    const deleteResult = db.prepare(`
      DELETE FROM receipt_evidence
      WHERE matched = 0
        AND status IN ('rejected', 'upstream_failure')
        AND created_at < datetime('now', '-' || ? || ' days')
    `).run(daysUnverified);

    unverifiedDeleted = deleteResult.changes;
  });

  pruneTx();

  logger.info(
    { rawPayloadsPruned, unverifiedDeleted, daysRaw, daysUnverified },
    'Receipt evidence lifecycle pruning executed'
  );

  return {
    rawPayloadsPruned,
    unverifiedDeleted,
  };
}
