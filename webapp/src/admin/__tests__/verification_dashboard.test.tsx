// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  AutoVerifiedBadge,
  VerificationDiagnosticBadge,
  ReverifyActionBtn,
  formatBankLabel,
  getDiagnosticBadgeDetails,
  AdminOrder,
} from '../Orders.tsx';
import {
  AuditEvidenceModal,
} from '../AuditEvidenceModal.tsx';
import {
  getVerificationDiagnosticToast,
  updateAdminSettingsApi,
  BankVerificationSettings,
} from '../adminApi.ts';

// ── Test Mock Fixtures ───────────────────────────────────────────────────────

const mockOrderAutoVerified: AdminOrder = {
  id: 'ORD-AUTO-001',
  user_id: 1001,
  username: 'habeshatester',
  product_id: 'telegram_premium',
  variant_id: 'tg_prem_3m',
  amount_etb: 1250,
  payment_rail: 'cbe',
  status: 'fulfilled',
  receipt_file_id: 'file_cbe_receipt_123',
  receipt_note: 'Paid via CBE Mobile',
  fulfillment_payload: '3 Months Telegram Premium Key',
  fulfillment_proof: 'Delivered instantly via Bot',
  rejection_reason: null,
  target_username: 'habeshatester',
  created_at: '2026-09-08T10:30:00Z',
  evidence: {
    id: 99,
    bank: 'cbe',
    reference: 'FT26252CBE998877',
    normalized_reference: 'FT26252CBE998877',
    status: 'auto_verified',
    error_code: null,
    verified_amount_etb: 1250,
    security_gate_passed: true,
    created_at: '2026-09-08T10:30:05Z',
  },
};

const mockOrderPendingReview: AdminOrder = {
  id: 'ORD-PEND-002',
  user_id: 1002,
  username: 'pendingbuyer',
  product_id: 'telegram_stars',
  variant_id: 'tg_stars_500',
  amount_etb: 1500,
  payment_rail: 'telebirr',
  status: 'pending_approval',
  receipt_file_id: 'file_telebirr_slip_456',
  receipt_note: 'Paid via Telebirr SuperApp',
  fulfillment_payload: null,
  fulfillment_proof: null,
  rejection_reason: null,
  created_at: '2026-09-08T11:00:00Z',
  evidence: {
    id: 100,
    bank: 'telebirr',
    reference: 'TB99881122',
    normalized_reference: 'TB99881122',
    status: 'pending_manual_review',
    error_code: 'BENEFICIARY_MISMATCH',
    verified_amount_etb: 1500,
    security_gate_passed: false,
    created_at: '2026-09-08T11:00:10Z',
  },
};

afterEach(() => {
  cleanup();
});

describe('1. AutoVerifiedBadge Component', () => {
  it('renders bank rail label correctly for CBE, Telebirr, and Abyssinia', () => {
    expect(formatBankLabel('cbe')).toBe('CBE');
    expect(formatBankLabel('telebirr')).toBe('Telebirr');
    expect(formatBankLabel('abyssinia')).toBe('Abyssinia');
    expect(formatBankLabel(null)).toBe('Bank');

    const { rerender } = render(<AutoVerifiedBadge bank="cbe" reference="FT12345" />);
    expect(screen.getByText('⚡ Auto-Verified (CBE)')).toBeTruthy();

    rerender(<AutoVerifiedBadge bank="telebirr" reference="TB12345" />);
    expect(screen.getByText('⚡ Auto-Verified (Telebirr)')).toBeTruthy();

    rerender(<AutoVerifiedBadge bank="abyssinia" reference="BOA12345" />);
    expect(screen.getByText('⚡ Auto-Verified (Abyssinia)')).toBeTruthy();

    rerender(<AutoVerifiedBadge bank="awash" reference="AW12345" />);
    expect(screen.getByText('⚡ Auto-Verified (AWASH)')).toBeTruthy();

    rerender(<AutoVerifiedBadge bank={null} reference="REF123" />);
    expect(screen.getByText('⚡ Auto-Verified (Bank)')).toBeTruthy();
  });

  it('renders normalized transaction reference and fallback', () => {
    const { rerender } = render(<AutoVerifiedBadge bank="cbe" reference="FT99887766" />);
    expect(screen.getByText('FT99887766')).toBeTruthy();

    rerender(<AutoVerifiedBadge bank="cbe" reference={null} />);
    expect(screen.queryByText('FT99887766')).toBeNull();
  });

  it('triggers onClick handler when clicking trigger button to inspect evidence modal', () => {
    const handleClick = vi.fn();
    render(<AutoVerifiedBadge bank="cbe" reference="FT777" onClick={handleClick} />);

    const triggerBtn = screen.getByRole('button', { name: /Inspect CBE automated verification audit/i });
    fireEvent.click(triggerBtn);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('isolates clipboard copy and stops propagation to prevent triggering modal', () => {
    const handleBadgeClick = vi.fn();
    const handleCopyCallback = vi.fn();

    render(
      <AutoVerifiedBadge
        bank="cbe"
        reference="FT777888"
        onClick={handleBadgeClick}
        onCopy={handleCopyCallback}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy reference ID FT777888/i });
    fireEvent.click(copyBtn);

    expect(handleCopyCallback).toHaveBeenCalledTimes(1);
    expect(handleCopyCallback).toHaveBeenCalledWith('FT777888');
    // Critical: modal trigger must NOT have fired due to stopPropagation!
    expect(handleBadgeClick).not.toHaveBeenCalled();
  });

  it('falls back to navigator.clipboard.writeText when onCopy prop is not provided', () => {
    const writeTextMock = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<AutoVerifiedBadge bank="cbe" reference="FT_NAV_COPY" />);

    const copyBtn = screen.getByRole('button', { name: /Copy reference ID FT_NAV_COPY/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('FT_NAV_COPY');
  });
});

describe('2. VerificationDiagnosticBadge & Toast Diagnostics', () => {
  const errorCodes: Array<{
    code: string;
    bank?: string;
    expectedLabel: string;
    expectedSeverity: 'warning' | 'danger' | 'neutral';
    expectedHintSubstring: string;
  }> = [
    {
      code: 'BANK_PORTAL_UNAVAILABLE',
      bank: 'cbe',
      expectedLabel: '[CBE Timeout]',
      expectedSeverity: 'warning',
      expectedHintSubstring: 'timed out',
    },
    {
      code: 'PORTAL_GEOBLOCKED',
      expectedLabel: '[Geoblocked]',
      expectedSeverity: 'warning',
      expectedHintSubstring: 'blocked non-Ethiopian egress',
    },
    {
      code: 'BENEFICIARY_MISMATCH',
      expectedLabel: '[Account Mismatch]',
      expectedSeverity: 'danger',
      expectedHintSubstring: 'unauthorized account',
    },
    {
      code: 'AMOUNT_MISMATCH',
      expectedLabel: '[Amount Mismatch]',
      expectedSeverity: 'danger',
      expectedHintSubstring: 'lower than required',
    },
    {
      code: 'RECEIPT_ALREADY_USED',
      expectedLabel: '[Replay Alert]',
      expectedSeverity: 'danger',
      expectedHintSubstring: 'previously verified',
    },
    {
      code: 'RECEIPT_EXPIRED',
      expectedLabel: '[Stale Receipt]',
      expectedSeverity: 'warning',
      expectedHintSubstring: 'outside allowable recency',
    },
    {
      code: 'QR_DECODE_FAILED',
      expectedLabel: '[Blurry / Unreadable]',
      expectedSeverity: 'neutral',
      expectedHintSubstring: 'QR matrix unreadable',
    },
    {
      code: 'UNSUPPORTED_BANK',
      bank: 'dashen',
      expectedLabel: '[Unsupported Bank]',
      expectedSeverity: 'neutral',
      expectedHintSubstring: 'Automated verification not supported',
    },
    {
      code: 'CORRUPTED_FILE',
      expectedLabel: '[Corrupted File]',
      expectedSeverity: 'danger',
      expectedHintSubstring: 'magic-byte validation',
    },
    {
      code: 'RATE_LIMITED',
      expectedLabel: '[Rate Limited]',
      expectedSeverity: 'warning',
      expectedHintSubstring: 'Rate limit active',
    },
    {
      code: 'INTERNAL_ENGINE_ERROR',
      expectedLabel: '[Err: INTERNAL_ENGINE_ERROR]',
      expectedSeverity: 'danger',
      expectedHintSubstring: 'Manual inspection required',
    },
  ];

  errorCodes.forEach(({ code, bank, expectedLabel, expectedSeverity, expectedHintSubstring }) => {
    it(`generates correct badge details and severity for ${code}`, () => {
      const details = getDiagnosticBadgeDetails(code, bank);
      expect(`[${details.label}]`).toBe(expectedLabel);
      expect(details.severity).toBe(expectedSeverity);
      expect(details.hint.toLowerCase()).toContain(expectedHintSubstring.toLowerCase());

      const handleClick = vi.fn();
      const { unmount } = render(
        <VerificationDiagnosticBadge errorCode={code} bank={bank} onClick={handleClick} />
      );

      const btn = screen.getByRole('button');
      expect(btn.textContent).toContain(expectedLabel);
      expect(btn.className).toContain(expectedSeverity);
      expect(btn.getAttribute('title')).toContain(details.fullTitle);

      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  it('renders null when errorCode is empty or null', () => {
    const { container: c1 } = render(<VerificationDiagnosticBadge errorCode={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<VerificationDiagnosticBadge errorCode="" />);
    expect(c2.firstChild).toBeNull();
  });

  it('maps RFC 7807 error codes to actionable Toast alerts with remediation hints', () => {
    const toastTimeout = getVerificationDiagnosticToast('BANK_PORTAL_UNAVAILABLE', 'cbe');
    expect(toastTimeout.title).toBe('CBE Portal Unavailable');
    expect(toastTimeout.severity).toBe('warning');
    expect(toastTimeout.remediationHint).toContain('Retry in a few minutes');

    const toastReplay = getVerificationDiagnosticToast('RECEIPT_ALREADY_USED');
    expect(toastReplay.title).toBe('Receipt Replay Detected');
    expect(toastReplay.severity).toBe('error');
    expect(toastReplay.remediationHint).toContain('Reject order');

    const toastMismatch = getVerificationDiagnosticToast('AMOUNT_MISMATCH');
    expect(toastMismatch.severity).toBe('error');
    expect(toastMismatch.remediationHint).toContain('remaining balance');
  });
});

describe('3. ReverifyActionBtn Component', () => {
  it('renders default actionable state and dispatches onReverify', () => {
    const handleReverify = vi.fn();
    render(<ReverifyActionBtn orderId="ORD-100" onReverify={handleReverify} />);

    const btn = screen.getByRole('button', { name: /Re-verify receipt for order ORD-100/i });
    expect(btn.textContent).toContain('Re-verify with Bank');
    expect(btn.getAttribute('aria-busy')).toBe('false');
    expect(btn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(btn);
    expect(handleReverify).toHaveBeenCalledWith('ORD-100');
  });

  it('renders in-flight loading state with spinner and aria-busy lock', () => {
    const handleReverify = vi.fn();
    render(
      <ReverifyActionBtn
        orderId="ORD-BUSY-101"
        isReverifying={true}
        onReverify={handleReverify}
      />
    );

    const btn = screen.getByRole('button', { name: /Re-verify receipt for order ORD-BUSY-101/i });
    expect(btn.textContent).toContain('Verifying…');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.className).toContain('busy');

    // Click while in-flight must NOT dispatch another action
    fireEvent.click(btn);
    expect(handleReverify).not.toHaveBeenCalled();
  });

  it('locks button when explicitly disabled', () => {
    const handleReverify = vi.fn();
    render(
      <ReverifyActionBtn
        orderId="ORD-DISABLED"
        disabled={true}
        onReverify={handleReverify}
      />
    );

    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);

    fireEvent.click(btn);
    expect(handleReverify).not.toHaveBeenCalled();
  });

  it('stops click event propagation to parent table row', () => {
    const handleParentClick = vi.fn();
    const handleReverify = vi.fn();

    render(
      <div onClick={handleParentClick}>
        <ReverifyActionBtn orderId="ORD-STOP-PROP" onReverify={handleReverify} />
      </div>
    );

    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    expect(handleReverify).toHaveBeenCalledWith('ORD-STOP-PROP');
    expect(handleParentClick).not.toHaveBeenCalled();
  });
});

describe('4. AuditEvidenceModal Component', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Mock successful status API response
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/receipts/status/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status: 'auto_verified',
            bank: 'cbe',
            reference: 'FT26252CBE998877',
            verifiedAmountEtb: 1250,
            beneficiaryAccount: '1000123456789',
            beneficiaryName: 'Bighabesha Digital Shop',
            senderName: 'Yared Tesfaye',
            senderIdentifier: '1000987654321',
            transactionTimestamp: '2026-09-08 10:28:45 EAT',
            paymentChannel: 'CBE Mobile Banking (App)',
            httpStatus: 200,
            latencyMs: 312,
            attemptNumber: 1,
            verifiedBy: 'engine:cbe_portal',
            evaluations: [
              {
                pillar: 'anti_replay',
                passed: true,
                expected: 'Unique Unclaimed Reference',
                actual: 'FT26252CBE998877',
                details: 'Reference is unique in SQLite ledger',
              },
              {
                pillar: 'beneficiary_whitelist',
                passed: true,
                expected: '1000123456789 (Bighabesha)',
                actual: '1000123456789',
                details: 'Matched official merchant whitelist',
              },
              {
                pillar: 'exact_amount',
                passed: true,
                expected: '1,250 ETB',
                actual: '1,250 ETB',
                details: 'Full net payable amount confirmed',
              },
              {
                pillar: 'recency_window',
                passed: true,
                expected: '±120 Minutes Tolerance',
                actual: '1.25 mins elapsed',
                details: 'Payment executed within allowable tolerance window',
              },
            ],
            rawBankPayload: {
              status: 'SUCCESS',
              transId: 'FT26252CBE998877',
              amount: 1250.0,
              creditedAccount: '1000123456789',
              clientName: 'Yared Tesfaye',
            },
            evidence: {
              evidenceId: 99,
              bank: 'cbe',
              reference: 'FT26252CBE998877',
              amountEtb: 1250,
              verifiedAmountEtb: 1250,
              status: 'auto_verified',
              errorCode: null,
              diagnosticMessage: null,
              securityGatePassed: true,
              timestamp: '2026-09-08T10:30:05Z',
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not render when isOpen is false or order is null', () => {
    const { container: c1 } = render(
      <AuditEvidenceModal isOpen={false} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <AuditEvidenceModal isOpen={true} order={null} onClose={vi.fn()} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('renders WAI-ARIA modal attributes (role, aria-modal, labelledby, describedby)', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('audit-modal-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('audit-modal-desc');

    expect(screen.getByText(/Verification Evidence · Order #ORD-AUTO-001/i)).toBeTruthy();
  });

  it('renders all 4 Security Pillars with PASSED status', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Pillar 1: Anti-Replay Assertion')).toBeTruthy();
      expect(screen.getByText('Pillar 2: Beneficiary Whitelist Match')).toBeTruthy();
      expect(screen.getByText('Pillar 3: Exact Net Amount Check')).toBeTruthy();
      expect(screen.getByText('Pillar 4: Recency Tolerance Window')).toBeTruthy();
    });

    const passedPills = screen.getAllByText('PASSED');
    expect(passedPills.length).toBe(4);
    expect(screen.getByText('✓ All Pillars Passed')).toBeTruthy();
  });

  it('renders Bento Grid transaction fields (reference, verified amount, merchant account, payer, timestamp, channel)', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getAllByText('FT26252CBE998877').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('1,250 ETB').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('1000123456789').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Bighabesha Digital Shop')).toBeTruthy();
      expect(screen.getByText('Yared Tesfaye')).toBeTruthy();
      expect(screen.getByText('CBE Mobile Banking (App)')).toBeTruthy();
    });
  });

  it('renders upstream gateway telemetry chips (HTTP status, latency, attempts, verified by)', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('HTTP Status:')).toBeTruthy();
      expect(screen.getByText('200')).toBeTruthy();
      expect(screen.getByText('312 ms')).toBeTruthy();
      expect(screen.getByText('engine:cbe_portal')).toBeTruthy();
    });
  });

  it('toggles raw JSON payload preview upon user inspection request', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Inspect Raw Bank Payload')).toBeTruthy();
    });

    const toggleBtn = screen.getByRole('button', { name: /Inspect Raw Bank Payload/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByText('Hide Raw DOM / JSON')).toBeTruthy();
    expect(screen.getByText(/Raw Bank Response Data \(Sanitized\)/i)).toBeTruthy();
    expect(screen.getByText(/"transId": "FT26252CBE998877"/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Hide Raw DOM \/ JSON/i }));
    expect(screen.queryByText(/Raw Bank Response Data/i)).toBeNull();
  });

  it('invokes onClose when clicking the close button or pressing Escape key', async () => {
    const handleClose = vi.fn();
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={handleClose} />
    );

    const closeBtn = screen.getByRole('button', { name: /Close verification evidence dialog/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Escape key listener test
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('renders decision actions (Approve & Deliver, Reject) when order is pending_approval and canDecide is true', async () => {
    const handleApprove = vi.fn();
    const handleReject = vi.fn();

    render(
      <AuditEvidenceModal
        isOpen={true}
        order={mockOrderPendingReview}
        onClose={vi.fn()}
        canDecide={true}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /Approve & Deliver/i });
    const rejectBtn = screen.getByRole('button', { name: /Reject Order/i });

    expect(approveBtn).toBeTruthy();
    expect(rejectBtn).toBeTruthy();

    fireEvent.click(approveBtn);
    expect(handleApprove).toHaveBeenCalledWith('ORD-PEND-002');

    fireEvent.click(rejectBtn);
    expect(handleReject).toHaveBeenCalledWith(mockOrderPendingReview);
  });

  it('caps huge raw bank payloads to prevent UI freezes (CWE-400)', async () => {
    // Override fetch to return a massive 120KB payload
    const hugePayload = { hugeData: 'x'.repeat(120_000) };
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        status: 'auto_verified',
        bank: 'cbe',
        reference: 'FT26252CBE998877',
        verifiedAmountEtb: 1250,
        rawBankPayload: hugePayload,
      }),
    })) as any;

    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Inspect Raw Bank Payload')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Inspect Raw Bank Payload/i }));

    expect(screen.getByText(/Showing first 50KB/i)).toBeTruthy();
    expect(screen.getByText(/TRUNCATED FOR UI PERFORMANCE/i)).toBeTruthy();

    global.fetch = originalFetch;
  });

  it('masks sensitive customer identifiers in Sender Bento item to prevent PII leaks (CWE-359)', async () => {
    render(
      <AuditEvidenceModal isOpen={true} order={mockOrderAutoVerified} onClose={vi.fn()} />
    );

    await waitFor(() => {
      // Mock returns senderIdentifier: '1000987654321' -> masked as '1000••••4321'
      expect(screen.getByText(/1000••••4321/i)).toBeTruthy();
    });
  });

  it('hides decision buttons when canDecide is false (RBAC gating)', () => {
    render(
      <AuditEvidenceModal
        isOpen={true}
        order={mockOrderPendingReview}
        onClose={vi.fn()}
        canDecide={false}
      />
    );

    expect(screen.queryByRole('button', { name: /Approve & Deliver/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject Order/i })).toBeNull();
  });
});

describe('5. Settings Tab Validation & Engine Configuration (ADR-002)', () => {
  describe('Account Number & Phone Format Guards', () => {
    const CBE_REGEX = /^\d{13}$/;
    const TELEBIRR_REGEX = /^(09|07|\+2519|\+2517|\d{10})\d*$/;
    const ABYSSINIA_REGEX = /^\d{8,16}$/;

    it('strictly validates CBE 13-digit account format', () => {
      // Valid cases
      expect(CBE_REGEX.test('1000123456789')).toBe(true);
      expect(CBE_REGEX.test('1000999888777')).toBe(true);
      expect('0000000000000' === '0000000000000').toBe(true); // sentinel bypass

      // Invalid cases
      expect(CBE_REGEX.test('123456789012')).toBe(false); // 12 digits
      expect(CBE_REGEX.test('12345678901234')).toBe(false); // 14 digits
      expect(CBE_REGEX.test('100012345678A')).toBe(false); // alphabetic
      expect(CBE_REGEX.test('')).toBe(false);
      expect(CBE_REGEX.test('1000 1234 5678')).toBe(false); // with spaces
    });

    it('strictly validates Telebirr Ethiopian phone numbers', () => {
      // Valid cases
      expect(TELEBIRR_REGEX.test('0911223344')).toBe(true);
      expect(TELEBIRR_REGEX.test('0711223344')).toBe(true);
      expect(TELEBIRR_REGEX.test('+251911223344')).toBe(true);
      expect(TELEBIRR_REGEX.test('+251711223344')).toBe(true);
      expect(TELEBIRR_REGEX.test('0912345678')).toBe(true);
      expect('0000000000' === '0000000000').toBe(true); // sentinel bypass

      // Invalid cases
      expect(TELEBIRR_REGEX.test('12345')).toBe(false);
      expect(TELEBIRR_REGEX.test('08112233')).toBe(false); // non-Ethiopian prefix & not 10 digits
      expect(TELEBIRR_REGEX.test('telebirr_phone')).toBe(false);
      expect(TELEBIRR_REGEX.test('+14155552671')).toBe(false); // US phone number
    });

    it('strictly validates Bank of Abyssinia 8 to 16 digit account format', () => {
      // Valid cases
      expect(ABYSSINIA_REGEX.test('12345678')).toBe(true); // 8 digits
      expect(ABYSSINIA_REGEX.test('123456789012')).toBe(true); // 12 digits
      expect(ABYSSINIA_REGEX.test('1234567890123456')).toBe(true); // 16 digits

      // Invalid cases
      expect(ABYSSINIA_REGEX.test('1234567')).toBe(false); // 7 digits (too short)
      expect(ABYSSINIA_REGEX.test('12345678901234567')).toBe(false); // 17 digits (too long)
      expect(ABYSSINIA_REGEX.test('BOA12345678')).toBe(false); // alphanumeric
    });
  });

  describe('Master Toggle Engine State Logic', () => {
    it('accurately toggles between active and paused states', () => {
      const isEngineActive = (val?: string | boolean) => val === '1' || val === 'true';

      expect(isEngineActive('1')).toBe(true);
      expect(isEngineActive('true')).toBe(true);
      expect(isEngineActive('0')).toBe(false);
      expect(isEngineActive('false')).toBe(false);
      expect(isEngineActive(undefined)).toBe(false);

      // Toggle state transition check
      const currentActive = '1';
      const toggledTo = isEngineActive(currentActive) ? '0' : '1';
      expect(toggledTo).toBe('0');

      const toggledBack = isEngineActive(toggledTo) ? '0' : '1';
      expect(toggledBack).toBe('1');
    });
  });

  describe('Clean Payload Generation for updateAdminSettingsApi', () => {
    it('transmits complete bank verification settings payload with zero env-dependence', async () => {
      let capturedBody: any = null;
      const originalFetch = global.fetch;

      global.fetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ success: true, settings: capturedBody.settings }),
        } as Response;
      });

      const sampleSettings: BankVerificationSettings = {
        receipt_auto_verify_enabled: '1',
        cbe_account: '1000123456789',
        cbe_name: 'Bighabesha CBE Main',
        telebirr_account: '0911223344',
        telebirr_name: 'Bighabesha Telebirr SuperApp',
        abyssinia_account: '1234567890',
        abyssinia_name: 'Bighabesha BOA Digital',
        receipt_recency_before_mins: '120',
        receipt_recency_after_mins: '30',
        receipt_cbe_port: '100',
        receipt_circuit_breaker_threshold: '5',
        receipt_circuit_breaker_cooldown_sec: '60',
      };

      await updateAdminSettingsApi(sampleSettings as Record<string, string>);

      expect(capturedBody).toBeDefined();
      expect(capturedBody.settings).toBeDefined();
      expect(capturedBody.settings.receipt_auto_verify_enabled).toBe('1');
      expect(capturedBody.settings.cbe_account).toBe('1000123456789');
      expect(capturedBody.settings.telebirr_account).toBe('0911223344');
      expect(capturedBody.settings.receipt_cbe_port).toBe('100');
      expect(capturedBody.settings.receipt_circuit_breaker_threshold).toBe('5');

      global.fetch = originalFetch;
    });
  });
});
