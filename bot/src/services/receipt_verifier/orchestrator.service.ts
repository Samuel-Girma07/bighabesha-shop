import crypto from 'crypto';
import { getDatabase } from '../../db/index.js';
import {
  insertReceiptEvidence,
  getLatestEvidenceForOrder,
  markEvidenceMatchedInTx,
  updateEvidenceStatus,
  insertVerificationAudit,
  queryEvidence as daoQueryEvidence,
  toVerificationAuditRecord,
  ReceiptEvidenceRow,
} from '../../db/receipt_evidence.dao.js';
import { getOrderById, updateOrderStatus, Order } from '../orders.service.js';
import { getProductById } from '../catalog.service.js';
import { allocateStock } from '../stock.service.js';
import { isResellerEligible } from '../reseller.service.js';
import { saveReceiptImage } from '../receipts.service.js';
import { logger } from '../../logger/index.js';
import { ReceiptIngestionService } from './ingestion.service.js';
import { CbeBankAdapter } from './adapters/cbe.adapter.js';
import { TelebirrAdapter } from './adapters/telebirr.adapter.js';
import { BankAdapterRegistry, IBankAdapterRegistry } from './adapters/registry.js';
import { SecurityGateService } from './security_gate.service.js';
import {
  DEFAULT_RECENCY_BEFORE_MINUTES,
  DEFAULT_RECENCY_AFTER_MINUTES,
  RFC7807_BASE_URL,
  DEFAULT_ERROR_INSTANCE,
} from './constants.js';
import {
  IReceiptOrchestrator,
  IReceiptIngestionService,
  IBankReceiptVerifier,
  ISecurityGate,
  ReceiptSubmission,
  VerificationResult,
  VerificationAuditRecord,
  EvidenceQueryFilter,
  PaginatedResult,
  ExtractedReceiptReference,
  BankTransactionPayload,
  SecurityGateResult,
  Rfc7807ProblemDetails,
  VerificationStatus,
  SecurityPillarId,
  ReceiptVerificationError,
  ReceiptAlreadyUsedError,
  BeneficiaryMismatchError,
  AmountMismatchError,
  ReceiptExpiredError,
  UnsupportedBankError,
} from './types.js';

interface ExecutionContext {
  startTime: number;
  order: Order;
  evidenceRow: ReceiptEvidenceRow;
  submission: ReceiptSubmission;
}

/**
 * Central Orchestrator coordinating Ingestion -> Bank Adapter -> 4-Pillar Security Gate -> Fulfillment.
 */
export class ReceiptOrchestrator implements IReceiptOrchestrator {
  public readonly ingestionService: IReceiptIngestionService;
  public readonly adapterRegistry: IBankAdapterRegistry;
  public readonly securityGate: ISecurityGate;

  constructor(
    ingestionService?: IReceiptIngestionService,
    adaptersOrRegistry?: IBankReceiptVerifier[] | IBankAdapterRegistry,
    securityGate?: ISecurityGate
  ) {
    this.ingestionService = ingestionService || new ReceiptIngestionService();

    if (adaptersOrRegistry && 'findAdapter' in adaptersOrRegistry) {
      this.adapterRegistry = adaptersOrRegistry;
    } else if (Array.isArray(adaptersOrRegistry)) {
      this.adapterRegistry = new BankAdapterRegistry(adaptersOrRegistry);
    } else {
      this.adapterRegistry = new BankAdapterRegistry([new CbeBankAdapter(), new TelebirrAdapter()]);
    }

    this.securityGate = securityGate || new SecurityGateService();
  }

  /** Backwards compatibility getter for registered adapters list */
  public get adapters(): readonly IBankReceiptVerifier[] {
    return this.adapterRegistry.getAll();
  }

  /**
   * Orchestrates the complete verification lifecycle:
   * Ingestion -> Bank Adapter -> 4-Pillar Security Gate -> Fulfillment / Fallback.
   */
  public async processSubmission(submission: ReceiptSubmission): Promise<VerificationResult> {
    const startTime = Date.now();
    const order = this.resolveOrder(submission.orderId);

    // Persist receipt image buffer if provided
    const { fileHash, filePath } = await this.persistEvidenceArtifact(submission.fileBuffer, order.id);

    // Initialize initial receipt_evidence record
    const evidenceRow = insertReceiptEvidence({
      orderId: order.id,
      userId: submission.userId,
      bank: order.payment_rail === 'cbe' || order.payment_rail === 'telebirr' || order.payment_rail === 'abyssinia'
        ? order.payment_rail
        : 'unknown',
      source: submission.source,
      rawText: submission.note || submission.directReference || null,
      amountEtb: order.amount_etb,
      reference: submission.directReference || null,
      filePath: filePath || null,
      fileHash: fileHash || null,
      mimeType: submission.mimeType || null,
      ipAddress: submission.ipAddress || null,
      status: 'pending_manual_review',
    });

    const ctx: ExecutionContext = { startTime, order, evidenceRow, submission };

    let extractedData: ExtractedReceiptReference | undefined;
    let bankPayload: BankTransactionPayload | undefined;
    let gateResult: SecurityGateResult | undefined;

    try {
      // 1. Ingestion Step
      extractedData = await this.extractSubmissionReference(submission);

      // 2. Bank Adapter Resolution & Upstream Query
      const adapter = this.resolveBankAdapter(extractedData);
      bankPayload = await adapter.verify(extractedData);

      // 3. 4-Pillar Security Gate Evaluation
      const discount = order.discount_etb || 0;
      const netPayableEtb = Math.max(order.amount_etb - discount, 1);

      gateResult = await this.securityGate.evaluate(
        {
          orderId: order.id,
          userId: order.user_id,
          netPayableEtb,
          paymentRail: bankPayload.bank,
          orderCreatedAt: new Date(order.created_at),
        },
        bankPayload
      );

      this.assertGatePassed(gateResult, bankPayload, order, netPayableEtb);

      // 4. All 4 Pillars Passed: Execute Atomic Fulfillment
      this.executeFulfillmentTx({
        evidenceId: evidenceRow.id,
        order,
        bankPayload,
        gateResult,
        extractedData,
        ipAddress: submission.ipAddress,
        latencyMs: Date.now() - startTime,
      });

      return {
        success: true,
        status: 'auto_verified',
        orderId: order.id,
        bank: bankPayload.bank,
        transactionReference: bankPayload.transactionReference,
        extractedData,
        bankPayload,
        securityGateResult: gateResult,
        needsAdminReview: false,
        verifiedAt: new Date(),
        processingDurationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return this.handleFallback({
        err,
        ctx,
        extractedData,
        bankPayload,
        gateResult,
      });
    }
  }

  /**
   * Re-verifies an existing order by administrator command.
   */
  public async reverifyOrder(orderId: string, adminId: number): Promise<VerificationResult> {
    const order = this.resolveOrder(orderId);
    const latestEvidence = getLatestEvidenceForOrder(orderId);
    const reference = order.payment_ref || latestEvidence?.reference || undefined;

    return this.processSubmission({
      orderId: order.id,
      userId: order.user_id,
      source: 'manual_admin_entry',
      directReference: reference,
      note: `Admin ${adminId} requested reverification`,
    });
  }

  public async getAuditRecord(orderId: string): Promise<VerificationAuditRecord | null> {
    const row = getLatestEvidenceForOrder(orderId);
    return row ? toVerificationAuditRecord(row) : null;
  }

  public async queryEvidence(filter: EvidenceQueryFilter): Promise<PaginatedResult<VerificationAuditRecord>> {
    return daoQueryEvidence(filter);
  }

  // ============================================================================
  // Modular Verification Pipeline Helpers (SRP Decomposition)
  // ============================================================================

  private resolveOrder(orderId: string): Order {
    const order = getOrderById(orderId);
    if (!order) {
      throw new ReceiptVerificationError(
        'INTERNAL_ENGINE_ERROR',
        404,
        'Order Not Found',
        `Target order '${orderId}' does not exist.`,
        'Please create a new order before uploading payment receipt.'
      );
    }
    return order;
  }

  private async persistEvidenceArtifact(
    fileBuffer: Buffer | undefined,
    orderId: string
  ): Promise<{ fileHash?: string; filePath?: string }> {
    if (!fileBuffer || fileBuffer.length === 0) {
      return {};
    }

    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    let filePath: string | undefined;

    try {
      const base64Str = fileBuffer.toString('base64');
      const saved = await saveReceiptImage(base64Str, orderId);
      filePath = saved.filePath;
    } catch (err: unknown) {
      logger.warn(
        { orderId, err: err instanceof Error ? err.message : String(err) },
        'Could not save receipt file to disk'
      );
    }

    return { fileHash, filePath };
  }

  private async extractSubmissionReference(submission: ReceiptSubmission): Promise<ExtractedReceiptReference> {
    if (submission.fileBuffer && submission.mimeType) {
      return this.ingestionService.ingestBuffer(submission.fileBuffer, submission.mimeType);
    }

    if (submission.directReference) {
      return this.ingestionService.ingestText(submission.directReference);
    }

    if (submission.note) {
      return this.ingestionService.ingestText(submission.note);
    }

    throw new ReceiptVerificationError(
      'CORRUPTED_FILE',
      400,
      'Missing Receipt Content',
      'No receipt image, document, or transaction reference was provided.',
      'Please upload a receipt screenshot or enter your reference code.'
    );
  }

  private resolveBankAdapter(extractedData: ExtractedReceiptReference): IBankReceiptVerifier {
    const adapter = this.adapterRegistry.findAdapter(extractedData);
    if (!adapter) {
      throw new UnsupportedBankError(extractedData.bank);
    }
    return adapter;
  }

  private assertGatePassed(
    gateResult: SecurityGateResult,
    bankPayload: BankTransactionPayload,
    order: Order,
    netPayableEtb: number
  ): void {
    if (gateResult.passed) {
      return;
    }

    const failingPillar = gateResult.failedPillar?.pillar;
    throw this.mapGateFailureToError(failingPillar, bankPayload, order, netPayableEtb);
  }

  private mapGateFailureToError(
    failingPillar: SecurityPillarId | undefined,
    bankPayload: BankTransactionPayload,
    order: Order,
    netPayableEtb: number
  ): ReceiptVerificationError {
    switch (failingPillar) {
      case 'anti_replay':
        return new ReceiptAlreadyUsedError(bankPayload.transactionReference);

      case 'beneficiary_whitelist':
        return new BeneficiaryMismatchError(bankPayload.bank, bankPayload.beneficiaryAccount, []);

      case 'exact_amount':
        return new AmountMismatchError(netPayableEtb, bankPayload.amountEtb);

      case 'recency_window':
        return new ReceiptExpiredError(
          new Date(order.created_at),
          bankPayload.transactionTimestamp,
          { before: DEFAULT_RECENCY_BEFORE_MINUTES, after: DEFAULT_RECENCY_AFTER_MINUTES }
        );

      default:
        return new ReceiptVerificationError(
          'INTERNAL_ENGINE_ERROR',
          422,
          'Security Gate Mismatch',
          'Receipt failed 4-pillar security validation.',
          'Order has been routed to store administrators for manual review.'
        );
    }
  }

  // ============================================================================
  // Atomic Fulfillment Transaction
  // ============================================================================

  private executeFulfillmentTx(params: {
    evidenceId: number;
    order: Order;
    bankPayload: BankTransactionPayload;
    gateResult: SecurityGateResult;
    extractedData: ExtractedReceiptReference;
    ipAddress?: string;
    latencyMs: number;
  }): void {
    const db = getDatabase();

    const fulfillTx = db.transaction(() => {
      // A. Atomic Anti-Replay Mark in SQLite
      markEvidenceMatchedInTx(db, {
        evidenceId: params.evidenceId,
        bank: params.bankPayload.bank,
        reference: params.bankPayload.transactionReference,
        normalizedReference: params.bankPayload.transactionReference,
        verifiedAmountEtb: params.bankPayload.amountEtb,
        beneficiaryAccount: params.bankPayload.beneficiaryAccount,
        securityGateEvaluations: params.gateResult.evaluations,
        rawBankPayload: params.bankPayload.rawAuditTrail,
      });

      // B. Stock Allocation or Reseller Dispatch
      this.dispatchOrderFulfillment(params.order, params.bankPayload);

      // C. Insert detailed audit record
      insertVerificationAudit(
        {
          evidenceId: params.evidenceId,
          orderId: params.order.id,
          userId: params.order.user_id,
          bank: params.bankPayload.bank,
          rawReference: params.extractedData.rawReference,
          normalizedReference: params.bankPayload.transactionReference,
          orderAmountEtb: params.order.amount_etb,
          verifiedAmountEtb: params.bankPayload.amountEtb,
          feeEtb: params.bankPayload.feeEtb || 0,
          currency: 'ETB',
          senderName: params.bankPayload.senderName || null,
          senderIdentifier: params.bankPayload.senderIdentifier || null,
          beneficiaryAccount: params.bankPayload.beneficiaryAccount,
          beneficiaryName: params.bankPayload.beneficiaryName,
          transactionTimestamp: params.bankPayload.transactionTimestamp,
          paymentChannel: params.bankPayload.paymentChannel || null,
          securityGatePassed: true,
          securityGateEvaluations: params.gateResult.evaluations,
          status: 'auto_verified',
          rawBankPayload: params.bankPayload.rawAuditTrail,
          rawEvidenceSnippet: params.extractedData.rawPayloadSnippet || null,
          latencyMs: params.latencyMs,
          ipAddress: params.ipAddress || null,
          verifiedBy: 'receipt_orchestrator',
        },
        db
      );
    });

    fulfillTx();
    logger.info(
      { orderId: params.order.id, ref: params.bankPayload.transactionReference },
      'Order fulfilled atomically via receipt verification engine'
    );
  }

  private dispatchOrderFulfillment(order: Order, bankPayload: BankTransactionPayload): void {
    const product = getProductById(order.product_id);
    const ref = bankPayload.transactionReference;
    const bankUpper = bankPayload.bank.toUpperCase();

    if (product && product.type === 'stock') {
      const alloc = allocateStock(order.product_id, order.id);
      if (alloc.item) {
        updateOrderStatus(order.id, 'fulfilled', {
          payment_ref: ref,
          fulfillment_payload: alloc.item.payload,
          admin_notes: `[Auto-Verified ✓] Bank: ${bankUpper} | Ref: ${ref}`,
        });
      } else {
        // Out of stock: advance to pending_fulfillment so admin can restock keys
        updateOrderStatus(order.id, 'pending_fulfillment', {
          payment_ref: ref,
          admin_notes: `[Auto-Verified ✓] Stock sold out. Queued for restock. Ref: ${ref}`,
        });
      }
      return;
    }

    if (isResellerEligible(order)) {
      updateOrderStatus(order.id, 'pending_fulfillment', {
        payment_ref: ref,
        admin_notes: `[Auto-Verified ✓] Reseller product queued. Ref: ${ref}`,
      });
      return;
    }

    updateOrderStatus(order.id, 'fulfilled', {
      payment_ref: ref,
      admin_notes: `[Auto-Verified ✓] Bank: ${bankUpper} | Ref: ${ref}`,
    });
  }

  // ============================================================================
  // Fallback Manager
  // ============================================================================

  private handleFallback(params: {
    err: unknown;
    ctx: ExecutionContext;
    extractedData?: ExtractedReceiptReference;
    bankPayload?: BankTransactionPayload;
    gateResult?: SecurityGateResult;
  }): VerificationResult {
    const errorDetails = this.resolveProblemDetails(params.err);
    const status = this.resolveFallbackStatus(errorDetails.code);
    const latencyMs = Date.now() - params.ctx.startTime;

    // Update receipt_evidence in DB
    try {
      updateEvidenceStatus(params.ctx.evidenceRow.id, status, errorDetails.code, params.bankPayload?.rawAuditTrail);
    } catch (e) {
      logger.error({ err: e }, 'Failed to update evidence status on fallback');
    }

    // Insert verification audit record
    try {
      insertVerificationAudit({
        evidenceId: params.ctx.evidenceRow.id,
        orderId: params.ctx.order.id,
        userId: params.ctx.order.user_id,
        bank: params.bankPayload?.bank || params.extractedData?.bank || 'unknown',
        rawReference: params.extractedData?.rawReference || null,
        normalizedReference: params.extractedData?.normalizedReference || 'UNKNOWN',
        orderAmountEtb: params.ctx.order.amount_etb,
        verifiedAmountEtb: params.bankPayload?.amountEtb || null,
        feeEtb: params.bankPayload?.feeEtb || 0,
        currency: 'ETB',
        senderName: params.bankPayload?.senderName || null,
        senderIdentifier: params.bankPayload?.senderIdentifier || null,
        beneficiaryAccount: params.bankPayload?.beneficiaryAccount || null,
        beneficiaryName: params.bankPayload?.beneficiaryName || null,
        transactionTimestamp: params.bankPayload?.transactionTimestamp || null,
        paymentChannel: params.bankPayload?.paymentChannel || null,
        securityGatePassed: false,
        securityGateEvaluations: params.gateResult?.evaluations,
        status,
        errorCode: errorDetails.code,
        errorDetail: errorDetails.detail,
        rawBankPayload: params.bankPayload?.rawAuditTrail || null,
        rawEvidenceSnippet: params.extractedData?.rawPayloadSnippet || null,
        latencyMs,
        ipAddress: params.ctx.submission.ipAddress || null,
        verifiedBy: 'receipt_orchestrator',
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log verification audit on fallback');
    }

    // Move order to pending_approval if awaiting_payment
    if (params.ctx.order.status === 'awaiting_payment') {
      try {
        updateOrderStatus(params.ctx.order.id, 'pending_approval', {
          admin_notes: `[Fallback Review] Code: ${errorDetails.code} | ${errorDetails.detail}`,
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to set order status to pending_approval');
      }
    }

    logger.warn(
      {
        orderId: params.ctx.order.id,
        code: errorDetails.code,
        status,
        reason: errorDetails.detail,
      },
      'Receipt verification routed to admin review queue'
    );

    return {
      success: false,
      status,
      orderId: params.ctx.order.id,
      bank: params.bankPayload?.bank || params.extractedData?.bank,
      transactionReference: params.bankPayload?.transactionReference || params.extractedData?.normalizedReference,
      extractedData: params.extractedData,
      bankPayload: params.bankPayload,
      securityGateResult: params.gateResult,
      error: errorDetails,
      needsAdminReview: true,
      adminReviewReason: `${errorDetails.title}: ${errorDetails.detail}`,
      verifiedAt: new Date(),
      processingDurationMs: latencyMs,
    };
  }

  private resolveProblemDetails(err: unknown): Rfc7807ProblemDetails {
    if (err instanceof ReceiptVerificationError) {
      return err.problemDetails;
    }

    return {
      type: `${RFC7807_BASE_URL}/internal-engine-error`,
      title: 'Internal Verification Error',
      status: 500,
      detail: err instanceof Error ? err.message : 'An unexpected verification error occurred.',
      instance: DEFAULT_ERROR_INSTANCE,
      code: 'INTERNAL_ENGINE_ERROR',
      remediation_hint: 'Receipt routed to administrator review queue for manual verification.',
      timestamp: new Date().toISOString(),
    };
  }

  private resolveFallbackStatus(code: string): VerificationStatus {
    if (code === 'RECEIPT_ALREADY_USED') {
      return 'rejected';
    }
    if (code === 'BANK_PORTAL_UNAVAILABLE' || code === 'PORTAL_GEOBLOCKED') {
      return 'upstream_failure';
    }
    return 'pending_manual_review';
  }
}
