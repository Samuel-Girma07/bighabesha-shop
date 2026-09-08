import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../src/db/migrator.js';
import {
  insertReceiptEvidence,
  getReceiptEvidenceById,
  getLatestEvidenceForOrder,
  getEvidenceForOrder,
  findDuplicateFileHash,
  checkAntiReplay,
  markEvidenceMatchedInTx,
  updateEvidenceStatus,
  insertVerificationAudit,
  getAuditsForOrder,
  queryEvidence,
  pruneStaleEvidence,
  toVerificationAuditRecord,
} from '../src/db/receipt_evidence.dao.js';
import { ReceiptAlreadyUsedError } from '../src/services/receipt_verifier/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

describe('Phase 3: Bank Receipt Verification Data Architecture & DAO', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, migrationsDir);

    // Seed dummy user and order for FK tests
    db.prepare(`
      INSERT INTO users (id, username, first_name)
      VALUES (1001, 'testuser', 'Test')
    `).run();

    db.prepare(`
      INSERT INTO products (id, type, name, description)
      VALUES ('prod_1', 'stock', 'Product 1', 'Test')
    `).run();

    db.prepare(`
      INSERT INTO orders (id, user_id, product_id, amount_etb, payment_rail, status)
      VALUES ('ORD-001', 1001, 'prod_1', 1500, 'cbe', 'awaiting_payment')
    `).run();

    db.prepare(`
      INSERT INTO orders (id, user_id, product_id, amount_etb, payment_rail, status)
      VALUES ('ORD-002', 1001, 'prod_1', 1500, 'cbe', 'awaiting_payment')
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  // ==========================================================================
  // 1. Migration & Schema Verification
  // ==========================================================================

  it('applied migration 011 and registered it in _migrations', () => {
    const migrations = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    expect(migrations.map((m) => m.name)).toContain('011_bank_receipt_verification.sql');
  });

  it('created receipt_evidence and bank_verification_audits tables with correct schema', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('receipt_evidence');
    expect(names).toContain('bank_verification_audits');

    const evidenceCols = db.prepare('PRAGMA table_info(receipt_evidence)').all() as { name: string }[];
    const colNames = evidenceCols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('order_id');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('bank');
    expect(colNames).toContain('source');
    expect(colNames).toContain('raw_text');
    expect(colNames).toContain('amount_etb');
    expect(colNames).toContain('reference');
    expect(colNames).toContain('normalized_reference');
    expect(colNames).toContain('matched');
    expect(colNames).toContain('verified_amount_etb');
    expect(colNames).toContain('beneficiary_account');
    expect(colNames).toContain('security_gate_passed');
    expect(colNames).toContain('security_gate_evaluations');
    expect(colNames).toContain('status');
    expect(colNames).toContain('error_code');
    expect(colNames).toContain('raw_bank_payload');
    expect(colNames).toContain('file_path');
    expect(colNames).toContain('file_hash');
    expect(colNames).toContain('mime_type');
    expect(colNames).toContain('ip_address');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('seeded default receipt verification settings into settings table', () => {
    const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'receipt_%'").all() as { key: string; value: string }[];
    const map = new Map(settings.map((s) => [s.key, s.value]));

    expect(map.get('receipt_auto_verify_enabled')).toBe('1');
    expect(map.get('receipt_recency_before_mins')).toBe('120');
    expect(map.get('receipt_recency_after_mins')).toBe('120');
    expect(map.get('receipt_circuit_breaker_threshold')).toBe('5');
    expect(map.get('receipt_circuit_breaker_cooldown_sec')).toBe('60');
    expect(map.get('receipt_retention_days_raw_payloads')).toBe('14');
    expect(map.get('receipt_retention_days_unverified')).toBe('30');
    expect(map.get('receipt_retention_days_verified')).toBe('365');
  });

  it('enforces foreign key constraints on receipt_evidence and bank_verification_audits', () => {
    // Nonexistent order
    expect(() => {
      insertReceiptEvidence(
        {
          orderId: 'ORD-NONEXISTENT',
          userId: 1001,
          source: 'telegram_photo',
        },
        db
      );
    }).toThrow(/FOREIGN KEY/);

    // Nonexistent user
    expect(() => {
      insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 999999,
          source: 'telegram_photo',
        },
        db
      );
    }).toThrow(/FOREIGN KEY/);
  });

  it('cascades deletion from orders to receipt_evidence and bank_verification_audits', () => {
    const evidence = insertReceiptEvidence(
      {
        orderId: 'ORD-001',
        userId: 1001,
        bank: 'cbe',
        source: 'telegram_photo',
        reference: 'FT12345',
      },
      db
    );

    const auditId = insertVerificationAudit(
      {
        evidenceId: evidence.id,
        orderId: 'ORD-001',
        userId: 1001,
        bank: 'cbe',
        normalizedReference: 'FT12345',
        orderAmountEtb: 1500,
        securityGatePassed: true,
        status: 'auto_verified',
      },
      db
    );

    expect(getReceiptEvidenceById(evidence.id, db)).not.toBeNull();
    expect(getAuditsForOrder('ORD-001', db)).toHaveLength(1);

    // Delete order
    db.prepare('DELETE FROM orders WHERE id = ?').run('ORD-001');

    // Evidence should be cascade-deleted
    expect(getReceiptEvidenceById(evidence.id, db)).toBeNull();
    // Audits for this order should also be cascade-deleted
    expect(getAuditsForOrder('ORD-001', db)).toHaveLength(0);
  });

  // ==========================================================================
  // 2. Core Anti-Replay Constraint Tests
  // ==========================================================================

  describe('Core Anti-Replay Constraint (Storage Engine Backstop)', () => {
    it('allows multiple unverified (matched = 0) records with the same reference', () => {
      const e1 = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'FT999888777',
        },
        db
      );

      const e2 = insertReceiptEvidence(
        {
          orderId: 'ORD-002',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'FT999888777',
        },
        db
      );

      expect(e1.id).toBeDefined();
      expect(e2.id).toBeDefined();
      expect(e1.matched).toBe(0);
      expect(e2.matched).toBe(0);
    });

    it('successfully matches one order, and prevents another order from matching the same reference', () => {
      const e1 = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'FT999888777',
        },
        db
      );

      const e2 = insertReceiptEvidence(
        {
          orderId: 'ORD-002',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'ft999888777', // lowercase
        },
        db
      );

      // Match first order
      const matchedRow1 = markEvidenceMatchedInTx(db, {
        evidenceId: e1.id,
        bank: 'cbe',
        reference: 'FT999888777',
        normalizedReference: 'FT999888777',
        verifiedAmountEtb: 1500,
        beneficiaryAccount: '1000123456789',
        securityGateEvaluations: [],
      });
      expect(matchedRow1.matched).toBe(1);

      // Attempting to match second order with identical reference (even with different case) must fail!
      expect(() => {
        markEvidenceMatchedInTx(db, {
          evidenceId: e2.id,
          bank: 'cbe',
          reference: 'ft999888777',
          normalizedReference: 'FT999888777',
          verifiedAmountEtb: 1500,
          beneficiaryAccount: '1000123456789',
          securityGateEvaluations: [],
        });
      }).toThrow(ReceiptAlreadyUsedError);

      // Direct SQL attempt to set matched = 1 on duplicate reference must throw SQLite UNIQUE constraint error
      expect(() => {
        db.prepare(`
          UPDATE receipt_evidence
          SET matched = 1, reference = 'FT999888777'
          WHERE id = ?
        `).run(e2.id);
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('permits identical references across DIFFERENT banks', () => {
      const e1 = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'TX123456',
        },
        db
      );

      const e2 = insertReceiptEvidence(
        {
          orderId: 'ORD-002',
          userId: 1001,
          bank: 'telebirr',
          source: 'sms_forward',
          reference: 'TX123456',
        },
        db
      );

      markEvidenceMatchedInTx(db, {
        evidenceId: e1.id,
        bank: 'cbe',
        reference: 'TX123456',
        normalizedReference: 'TX123456',
        verifiedAmountEtb: 1500,
        beneficiaryAccount: '1000123456789',
        securityGateEvaluations: [],
      });

      // Different bank ('telebirr' vs 'cbe') should succeed
      const matched2 = markEvidenceMatchedInTx(db, {
        evidenceId: e2.id,
        bank: 'telebirr',
        reference: 'TX123456',
        normalizedReference: 'TX123456',
        verifiedAmountEtb: 1500,
        beneficiaryAccount: '0912345678',
        securityGateEvaluations: [],
      });

      expect(matched2.matched).toBe(1);
    });

    it('checkAntiReplay identifies existing matched orders and ignores unmatched ones', () => {
      const e1 = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'FT77777777',
        },
        db
      );

      // Initially unmatched
      const check1 = checkAntiReplay('cbe', 'FT77777777', undefined, db);
      expect(check1.isReplay).toBe(false);

      // Now match
      markEvidenceMatchedInTx(db, {
        evidenceId: e1.id,
        bank: 'cbe',
        reference: 'FT77777777',
        normalizedReference: 'FT77777777',
        verifiedAmountEtb: 1500,
        beneficiaryAccount: '1000123456789',
        securityGateEvaluations: [],
      });

      // Check replay
      const check2 = checkAntiReplay('cbe', 'ft77777777', undefined, db);
      expect(check2.isReplay).toBe(true);
      expect(check2.existingOrderId).toBe('ORD-001');

      // Exclude same order check
      const check3 = checkAntiReplay('cbe', 'ft77777777', 'ORD-001', db);
      expect(check3.isReplay).toBe(false);
    });
  });

  // ==========================================================================
  // 3. Index & Query Performance Analysis (EXPLAIN QUERY PLAN)
  // ==========================================================================

  describe('Query Plan & Index Utilization', () => {
    it('uses idx_receipt_evidence_anti_replay for matched reference lookup', () => {
      const plan = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT id FROM receipt_evidence
        WHERE bank = 'cbe' AND reference = 'FT123' COLLATE NOCASE AND matched = 1
      `).all() as { detail: string }[];

      const details = plan.map((p) => p.detail).join(' ');
      expect(details).toContain('idx_receipt_evidence_anti_replay');
    });

    it('uses idx_receipt_evidence_order for order lookups', () => {
      const plan = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM receipt_evidence
        WHERE order_id = 'ORD-001'
        ORDER BY created_at DESC
      `).all() as { detail: string }[];

      const details = plan.map((p) => p.detail).join(' ');
      expect(details).toContain('idx_receipt_evidence_order');
    });

    it('uses idx_receipt_evidence_file_hash for duplicate upload check', () => {
      const dummyHash = 'a'.repeat(64);
      const plan = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT id FROM receipt_evidence
        WHERE file_hash = '${dummyHash}'
      `).all() as { detail: string }[];

      const details = plan.map((p) => p.detail).join(' ');
      expect(details).toContain('idx_receipt_evidence_file_hash');
    });

    it('uses idx_bank_audits_order for audit lookups', () => {
      const plan = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM bank_verification_audits
        WHERE order_id = 'ORD-001'
      `).all() as { detail: string }[];

      const details = plan.map((p) => p.detail).join(' ');
      expect(details).toContain('idx_bank_audits_order');
    });
  });

  // ==========================================================================
  // 4. Data Lifecycle & Retention Pruning
  // ==========================================================================

  describe('Data Lifecycle & Retention Policies', () => {
    it('prunes heavy raw payloads older than threshold and purges unverified attempts', () => {
      // 1. Create a stale unverified attempt (> 31 days old)
      db.prepare(`
        INSERT INTO receipt_evidence (
          order_id, user_id, bank, source, reference, matched, status, created_at
        ) VALUES (
          'ORD-001', 1001, 'cbe', 'telegram_photo', 'OLD_REF_1', 0, 'rejected',
          datetime('now', '-35 days')
        )
      `).run();

      // 2. Create a recent unverified attempt (1 day old)
      db.prepare(`
        INSERT INTO receipt_evidence (
          order_id, user_id, bank, source, reference, matched, status, created_at
        ) VALUES (
          'ORD-001', 1001, 'cbe', 'telegram_photo', 'RECENT_REF', 0, 'pending_manual_review',
          datetime('now', '-1 days')
        )
      `).run();

      // 3. Create a matched record with large raw_bank_payload (> 20 days old)
      const matchedInsert = db.prepare(`
        INSERT INTO receipt_evidence (
          order_id, user_id, bank, source, reference, normalized_reference, matched, status,
          raw_bank_payload, created_at
        ) VALUES (
          'ORD-002', 1001, 'cbe', 'telegram_photo', 'MATCHED_OLD', 'MATCHED_OLD', 1, 'auto_verified',
          '{"large_raw_html": "<html>...</html>"}', datetime('now', '-20 days')
        )
      `).run();
      const matchedEvidenceId = matchedInsert.lastInsertRowid;

      // 4. Create an audit with large raw payload (> 20 days old)
      const auditInsert = db.prepare(`
        INSERT INTO bank_verification_audits (
          evidence_id, order_id, user_id, bank, normalized_reference, order_amount_etb,
          security_gate_passed, status, raw_bank_payload, raw_evidence_snippet, created_at
        ) VALUES (
          ?, 'ORD-002', 1001, 'cbe', 'MATCHED_OLD', 1500, 1, 'auto_verified',
          '{"html_dump": "large payload"}', 'OCR text stream', datetime('now', '-20 days')
        )
      `).run(matchedEvidenceId);
      const auditId = auditInsert.lastInsertRowid;

      // Execute pruning (raw > 14 days, unverified > 30 days)
      const pruneResult = pruneStaleEvidence(14, 30, db);

      expect(pruneResult.unverifiedDeleted).toBe(1); // OLD_REF_1 deleted
      expect(pruneResult.rawPayloadsPruned).toBeGreaterThanOrEqual(2); // payload nulled on evidence and audit

      // Verify OLD_REF_1 was deleted
      const oldCheck = db.prepare("SELECT * FROM receipt_evidence WHERE reference = 'OLD_REF_1'").get();
      expect(oldCheck).toBeUndefined();

      // Verify RECENT_REF still exists
      const recentCheck = db.prepare("SELECT * FROM receipt_evidence WHERE reference = 'RECENT_REF'").get();
      expect(recentCheck).toBeDefined();

      // Verify MATCHED_OLD still exists, but raw_bank_payload was truncated
      const matchedCheck = db.prepare("SELECT * FROM receipt_evidence WHERE reference = 'MATCHED_OLD'").get() as any;
      expect(matchedCheck).toBeDefined();
      expect(matchedCheck.matched).toBe(1);
      expect(matchedCheck.raw_bank_payload).toBeNull();

      // Verify audit still exists with financial fields, but raw payload was truncated
      const auditCheck = db.prepare('SELECT * FROM bank_verification_audits WHERE id = ?').get(auditId) as any;
      expect(auditCheck).toBeDefined();
      expect(auditCheck.order_amount_etb).toBe(1500);
      expect(auditCheck.raw_bank_payload).toBeNull();
      expect(auditCheck.raw_evidence_snippet).toBeNull();
    });
  });

  // ==========================================================================
  // 5. DAO Method Operations & Admin Filtering
  // ==========================================================================

  describe('DAO Methods & Admin Querying', () => {
    it('supports file hash duplicate detection', () => {
      const dummyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          source: 'telegram_photo',
          fileHash: dummyHash,
        },
        db
      );

      const found = findDuplicateFileHash(dummyHash, db);
      expect(found).not.toBeNull();
      expect(found?.order_id).toBe('ORD-001');

      const notFound = findDuplicateFileHash('nonexistent', db);
      expect(notFound).toBeNull();
    });

    it('paginates and filters admin queries accurately', () => {
      for (let i = 1; i <= 25; i++) {
        insertReceiptEvidence(
          {
            orderId: 'ORD-001',
            userId: 1001,
            bank: i % 2 === 0 ? 'cbe' : 'telebirr',
            source: 'telegram_photo',
            reference: `REF_${i}`,
            status: i % 3 === 0 ? 'auto_verified' : 'pending_manual_review',
          },
          db
        );
      }

      // Page 1 with limit 10
      const page1 = queryEvidence({ limit: 10, page: 1 }, db);
      expect(page1.total).toBe(25);
      expect(page1.items).toHaveLength(10);
      expect(page1.page).toBe(1);
      expect(page1.totalPages).toBe(3);

      // Filter by bank
      const cbeOnly = queryEvidence({ bank: 'cbe', limit: 50 }, db);
      expect(cbeOnly.items.every((item) => item.bank === 'cbe')).toBe(true);

      // Filter by reference search
      const searchRef = queryEvidence({ reference: 'REF_10' }, db);
      expect(searchRef.total).toBe(1);
      expect(searchRef.items[0].rawReference).toBe('REF_10');
    });

    it('maps DB row to VerificationAuditRecord properly', () => {
      const row = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          bank: 'cbe',
          source: 'telegram_photo',
          reference: 'FT987654',
          amountEtb: 1500,
        },
        db
      );

      const auditRecord = toVerificationAuditRecord(row);
      expect(auditRecord.orderId).toBe('ORD-001');
      expect(auditRecord.userId).toBe(1001);
      expect(auditRecord.bank).toBe('cbe');
      expect(auditRecord.rawReference).toBe('FT987654');
      expect(auditRecord.amountEtb).toBe(1500);
      expect(auditRecord.createdAt).toBeInstanceOf(Date);
    });

    it('updates evidence status and error code', () => {
      const row = insertReceiptEvidence(
        {
          orderId: 'ORD-001',
          userId: 1001,
          source: 'telegram_photo',
        },
        db
      );

      updateEvidenceStatus(row.id, 'rejected', 'AMOUNT_MISMATCH', { diff: -50 }, db);

      const updated = getReceiptEvidenceById(row.id, db);
      expect(updated?.status).toBe('rejected');
      expect(updated?.error_code).toBe('AMOUNT_MISMATCH');
      expect(updated?.raw_bank_payload).toContain('diff');
    });
  });
});
