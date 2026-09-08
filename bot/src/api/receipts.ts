import { Router, Request, Response } from 'express';
import { getConfig } from '../config/env.js';
import { getDatabase } from '../db/index.js';
import { validateTelegramInitData } from './auth.js';
import { requireAdminAuth, requirePermission } from './admin.js';
import { getOrderById } from '../services/orders.service.js';
import { getReceiptOrchestrator } from '../services/receipt_verifier/index.js';
import { getAuditsForOrder } from '../db/receipt_evidence.dao.js';
import { RFC7807_BASE_URL } from '../services/receipt_verifier/constants.js';
import {
  ReceiptMimeType,
  Rfc7807ProblemDetails,
  SupportedBank,
  VerificationStatus,
  VerificationFailureCode,
  ReceiptVerificationError,
} from '../services/receipt_verifier/types.js';
import { logger } from '../logger/index.js';

export const receiptsRouter: Router = Router();
export const adminReceiptsRouter: Router = Router();

// ============================================================================
// Constants & Statically Compiled Patterns
// ============================================================================

const DATA_URL_PREFIX_PATTERN = /^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/;
const TMA_PREFIX_PATTERN = /^tma\s+/i;
const BEARER_PREFIX_PATTERN = /^bearer\s+/i;
const PDF_MAGIC_BYTES = '%PDF-';

interface AuthContext {
  userId: number;
  isAdmin: boolean;
  adminId?: number;
}

interface AuthenticatedAdminRequest extends Request {
  adminSession?: {
    adminId: number;
    token?: string;
  };
}

// ============================================================================
// RFC 7807 Serialization Helper
// ============================================================================

function sendProblemDetails(
  res: Response,
  status: number,
  code: VerificationFailureCode,
  title: string,
  detail: string,
  remediationHint: string,
  instance: string,
  details?: Record<string, unknown>
): void {
  const error: Rfc7807ProblemDetails = {
    type: `${RFC7807_BASE_URL}/${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    detail,
    instance,
    code,
    remediation_hint: remediationHint,
    details,
    timestamp: new Date().toISOString(),
  };
  res.setHeader('Content-Type', 'application/problem+json');
  res.status(status).json(error);
}

// ============================================================================
// Auth & Payload Helpers
// ============================================================================

function authenticateUserOrAdmin(req: Request): AuthContext | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  const config = getConfig();

  // 1. Try Telegram WebApp initData (tma ... or bearer ...)
  const rawInitData = authHeader.replace(TMA_PREFIX_PATTERN, '').replace(BEARER_PREFIX_PATTERN, '');
  const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
  if (validated && validated.user) {
    return {
      userId: validated.user.id,
      isAdmin: config.ADMIN_IDS.includes(validated.user.id),
    };
  }

  // 2. Try Admin session token (Bearer <hexToken>)
  const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1].trim();
    if (/^[a-f0-9]{64}$/i.test(token)) {
      const db = getDatabase();
      const session = db
        .prepare('SELECT admin_id as adminId, expires_at as expiresAt FROM admin_sessions WHERE token = ?')
        .get(token) as { adminId: number; expiresAt: number } | undefined;

      if (session && session.expiresAt >= Date.now() && config.ADMIN_IDS.includes(session.adminId)) {
        return {
          userId: session.adminId,
          isAdmin: true,
          adminId: session.adminId,
        };
      }
    }
  }

  return null;
}

function parseBase64Payload(dataStr: string): { buffer: Buffer; mimeType: ReceiptMimeType } {
  let mimeType: ReceiptMimeType = 'image/png';
  let base64Data = dataStr.trim();

  // Handle data URL prefix (e.g. data:image/jpeg;base64,...)
  const match = dataStr.match(DATA_URL_PREFIX_PATTERN);
  if (match) {
    const declaredMime = match[1].toLowerCase();
    if (
      declaredMime === 'image/jpeg' ||
      declaredMime === 'image/png' ||
      declaredMime === 'image/webp' ||
      declaredMime === 'application/pdf'
    ) {
      mimeType = declaredMime as ReceiptMimeType;
    }
    base64Data = match[2];
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 0) {
    // Magic byte detection fallback
    if (buffer.subarray(0, 5).toString('ascii').startsWith(PDF_MAGIC_BYTES)) {
      mimeType = 'application/pdf';
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      mimeType = 'image/jpeg';
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      mimeType = 'image/png';
    } else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      mimeType = 'image/webp';
    }
  }

  return { buffer, mimeType };
}

// ============================================================================
// Public / Customer Verification Endpoints
// ============================================================================

/**
 * POST /api/receipts/verify
 * Ingests receipt image, PDF, or reference and executes the full verification pipeline.
 */
receiptsRouter.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const instance = '/api/receipts/verify';
  const auth = authenticateUserOrAdmin(req);

  if (!auth) {
    sendProblemDetails(
      res,
      401,
      'INTERNAL_ENGINE_ERROR',
      'Unauthorized',
      'Missing or invalid authentication token (Telegram WebApp initData or Admin Token required).',
      'Authenticate via Telegram WebApp or provide a valid Admin Bearer token.',
      instance
    );
    return;
  }

  const { orderId, reference, receiptBase64, note } = req.body;
  if (!orderId) {
    sendProblemDetails(
      res,
      400,
      'CORRUPTED_FILE',
      'Missing Order ID',
      'The orderId property is required.',
      'Provide a valid orderId in the request body.',
      instance
    );
    return;
  }

  const order = getOrderById(orderId);
  if (!order) {
    sendProblemDetails(
      res,
      404,
      'INTERNAL_ENGINE_ERROR',
      'Order Not Found',
      `Order '${orderId}' could not be located.`,
      'Check the order ID or create a new order before verifying payment.',
      instance
    );
    return;
  }

  // Authorization check: only order owner or admins can verify
  if (order.user_id !== auth.userId && !auth.isAdmin) {
    sendProblemDetails(
      res,
      403,
      'INTERNAL_ENGINE_ERROR',
      'Forbidden',
      `You do not have permission to verify order '${orderId}'.`,
      'Ensure you are signed in with the Telegram account that created the order.',
      instance
    );
    return;
  }

  let fileBuffer: Buffer | undefined;
  let mimeType: ReceiptMimeType | undefined;

  if (receiptBase64 && typeof receiptBase64 === 'string') {
    try {
      const parsed = parseBase64Payload(receiptBase64);
      fileBuffer = parsed.buffer;
      mimeType = parsed.mimeType;
    } catch (err: unknown) {
      sendProblemDetails(
        res,
        400,
        'CORRUPTED_FILE',
        'Invalid Base64 Image',
        `Failed to decode receiptBase64 payload: ${err instanceof Error ? err.message : String(err)}`,
        'Provide a valid base64-encoded image or PDF.',
        instance
      );
      return;
    }
  }

  const orchestrator = getReceiptOrchestrator();

  try {
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: order.user_id,
      source: 'webapp_upload',
      fileBuffer,
      mimeType,
      directReference: reference ? String(reference).trim() : undefined,
      note: note ? String(note).trim() : undefined,
      ipAddress: req.ip,
    });

    if (result.success) {
      res.status(200).json(result);
    } else {
      const statusCode = result.error?.status || 422;
      res.setHeader('Content-Type', 'application/problem+json');
      res.status(statusCode).json(result.error);
    }
  } catch (err: unknown) {
    logger.error({ err, orderId }, 'Unhandled exception in /api/receipts/verify');
    if (err instanceof ReceiptVerificationError) {
      res.setHeader('Content-Type', 'application/problem+json');
      res.status(err.problemDetails.status).json(err.problemDetails);
      return;
    }

    sendProblemDetails(
      res,
      500,
      'INTERNAL_ENGINE_ERROR',
      'Internal Verification Error',
      err instanceof Error ? err.message : 'An unexpected error occurred during verification.',
      'Please try again later or contact support.',
      instance
    );
  }
});

/**
 * POST /api/receipts/test-qr
 * Diagnostic endpoint to test QR code decoding on an uploaded image.
 */
receiptsRouter.post('/test-qr', async (req: Request, res: Response): Promise<void> => {
  const instance = '/api/receipts/test-qr';
  const { imageBase64 } = req.body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    sendProblemDetails(
      res,
      400,
      'CORRUPTED_FILE',
      'Missing Image Data',
      'The imageBase64 parameter is required.',
      'Provide a base64 encoded image string.',
      instance
    );
    return;
  }

  let buffer: Buffer;
  try {
    const parsed = parseBase64Payload(imageBase64);
    buffer = parsed.buffer;
  } catch (err: unknown) {
    sendProblemDetails(
      res,
      400,
      'CORRUPTED_FILE',
      'Corrupted Base64 Image',
      `Could not parse base64: ${err instanceof Error ? err.message : String(err)}`,
      'Ensure image is properly base64-encoded.',
      instance
    );
    return;
  }

  const orchestrator = getReceiptOrchestrator();
  const testResult = await orchestrator.ingestionService.testQrMatrix(buffer);

  if (testResult.success) {
    res.status(200).json(testResult);
  } else {
    sendProblemDetails(
      res,
      422,
      'QR_DECODE_FAILED',
      'QR Code Matrix Decoding Failed',
      testResult.error || 'QR code matrix could not be resolved from provided image.',
      'Ensure image is clear, sharp, uncropped, and not blurred.',
      instance,
      { passesAttempted: testResult.passesAttempted, durationMs: testResult.decodeDurationMs }
    );
  }
});

/**
 * GET /api/receipts/status/:orderId
 * Retrieves verification audit record and attempt telemetry for an order.
 */
receiptsRouter.get('/status/:orderId', async (req: Request, res: Response): Promise<void> => {
  const orderId = String(req.params.orderId);
  const instance = `/api/receipts/status/${orderId}`;
  const auth = authenticateUserOrAdmin(req);

  if (!auth) {
    sendProblemDetails(
      res,
      401,
      'INTERNAL_ENGINE_ERROR',
      'Unauthorized',
      'Authentication token required to view order receipt status.',
      'Authenticate via Telegram WebApp or provide an Admin Bearer token.',
      instance
    );
    return;
  }

  const order = getOrderById(orderId);
  if (!order) {
    sendProblemDetails(
      res,
      404,
      'INTERNAL_ENGINE_ERROR',
      'Order Not Found',
      `Order '${orderId}' does not exist.`,
      'Verify order ID and try again.',
      instance
    );
    return;
  }

  if (order.user_id !== auth.userId && !auth.isAdmin) {
    sendProblemDetails(
      res,
      403,
      'INTERNAL_ENGINE_ERROR',
      'Forbidden',
      `You do not have permission to view verification status for order '${orderId}'.`,
      'Ensure you are signed in with the correct Telegram account.',
      instance
    );
    return;
  }

  const orchestrator = getReceiptOrchestrator();
  const evidence = await orchestrator.getAuditRecord(orderId);
  const attempts = getAuditsForOrder(orderId);

  res.status(200).json({
    orderId: order.id,
    orderStatus: order.status,
    amountEtb: order.amount_etb,
    paymentRail: order.payment_rail,
    evidence,
    attempts,
  });
});

// ============================================================================
// Admin Endpoints
// ============================================================================

/**
 * GET /api/admin/receipts/evidence
 * Paginated query of verified receipt evidence with filtering (requires orders.view).
 */
adminReceiptsRouter.get(
  '/evidence',
  requireAdminAuth,
  requirePermission('orders.view'),
  async (req: Request, res: Response): Promise<void> => {
    const filter = {
      orderId: req.query.orderId ? String(req.query.orderId) : undefined,
      userId: req.query.userId ? Number(req.query.userId) : undefined,
      bank: req.query.bank ? (String(req.query.bank) as SupportedBank) : undefined,
      status: req.query.status ? (String(req.query.status) as VerificationStatus) : undefined,
      reference: req.query.reference ? String(req.query.reference) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 50,
    };

    const orchestrator = getReceiptOrchestrator();
    const result = await orchestrator.queryEvidence(filter);
    res.status(200).json(result);
  }
);

/**
 * POST /api/admin/receipts/:orderId/reverify
 * Forces manual re-verification of an order receipt (requires orders.decide).
 */
adminReceiptsRouter.post(
  '/:orderId/reverify',
  requireAdminAuth,
  requirePermission('orders.decide'),
  async (req: Request, res: Response): Promise<void> => {
    const orderId = String(req.params.orderId);
    const instance = `/api/admin/receipts/${orderId}/reverify`;
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.adminSession?.adminId || 0;

    const orchestrator = getReceiptOrchestrator();

    try {
      const result = await orchestrator.reverifyOrder(orderId, adminId);
      if (result.success) {
        res.status(200).json(result);
      } else {
        const statusCode = result.error?.status || 422;
        res.setHeader('Content-Type', 'application/problem+json');
        res.status(statusCode).json(result.error);
      }
    } catch (err: unknown) {
      if (err instanceof ReceiptVerificationError) {
        res.setHeader('Content-Type', 'application/problem+json');
        res.status(err.problemDetails.status).json(err.problemDetails);
        return;
      }

      sendProblemDetails(
        res,
        500,
        'INTERNAL_ENGINE_ERROR',
        'Re-verification Failed',
        err instanceof Error ? err.message : String(err),
        'Inspect order evidence and retry.',
        instance
      );
    }
  }
);
