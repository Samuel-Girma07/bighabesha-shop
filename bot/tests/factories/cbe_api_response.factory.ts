/**
 * Synthetic factory for the CBE public transaction-detail JSON API.
 *
 * ============================================================================
 * EVERY VALUE IN THIS FILE IS INVENTED
 * ============================================================================
 * Nothing here is captured from a live bank response. The account number, the
 * party names, the amounts and the `v2-` token are all fabricated placeholders
 * that exist only to be pattern-matched in tests. Real bank data must never
 * enter this repository (see the project's standing data-hygiene rule), so no
 * fixture may be replaced with a real receipt: if a test needs a value that is
 * not here, invent one.
 *
 * The SHAPE, on the other hand, is load-bearing and must match the live
 * contract exactly:
 *
 *   - every field arrives as a STRING (only `isPlatformTransaction`,
 *     `isOtherBank` are real booleans);
 *   - `amountCredited` is the settled amount and is NOT equal to
 *     `amountDebited` / `totalChargeAmount` / `totalTaxAmount`;
 *   - `creditAccountNo` is masked server-side, 13 characters with asterisks,
 *     and there is no unmasked account anywhere in the document;
 *   - `dateTimes[0]` is ISO-8601 UTC with a trailing `Z`; the `*Date` and
 *     `*ValueDate` fields are compact `YYYYMMDD` with no time component;
 *   - `id` is a 12-character transaction id, NOT the 23-character request token.
 *
 * The values below are checked against those invariants by
 * `receipt_cbe_json_api.test.ts` so a "harmless" fixture edit cannot quietly
 * encode the wrong one.
 */

import type { ExtractedReceiptReference } from '../../src/services/receipt_verifier/types.js';

/** Invented 20-character token body; the reference is `v2-` plus this. */
export const SYNTHETIC_TOKEN_BODY = 'Ts7Qv4Nb2Xk9Rm5Pw3Zd';

/** Full `v2-…` path segment, prefix included, exactly as the SMS carries it. */
export const SYNTHETIC_CBE_TOKEN = `v2-${SYNTHETIC_TOKEN_BODY}`;

/** Invented 12-character bank transaction id (never equal to the token). */
export const SYNTHETIC_CBE_TX_ID = 'TXR4K9Z7Q2WX';

/** Invented masked beneficiary account: 13 characters, asterisks preserved. */
export const SYNTHETIC_MASKED_ACCOUNT = '1000******000';

/** Invented masked account belonging to nobody we know — the negative case. */
export const SYNTHETIC_FOREIGN_MASKED_ACCOUNT = '1000******777';

export interface SyntheticCbeApiOptions {
  /** Bank transaction id published in the document. */
  transactionId?: string;
  /** `COMPLETED` for a settled transfer; anything else is unconfirmed. */
  status?: string;
  /** SETTLED amount credited to the receiver. `null` omits the key. */
  amountCredited?: string | null;
  /** Amount taken from the sender (settled + fees). `null` omits the key. */
  amountDebited?: string | null;
  totalChargeAmount?: string | null;
  totalTaxAmount?: string | null;
  serviceChargeValue?: string | null;
  vatValue?: string | null;
  drCharge?: string | null;
  /** Masked beneficiary account. `null` omits the key. */
  creditAccountNo?: string | null;
  /** Beneficiary name, cleartext. `null` omits the key. */
  creditAccountHolder?: string | null;
  /** Payer name, cleartext. `null` omits the key. */
  debitAccountHolder?: string | null;
  /** `dateTimes` array. `null` omits the key entirely. */
  dateTimes?: string[] | null;
  /** Compact `YYYYMMDD` value dates — deliberately date-only, no time. */
  valueDateCompact?: string | null;
  channel?: string;
  platformTransactionType?: string;
  isOtherBank?: boolean;
}

/**
 * Builds a plausible transaction-detail document.
 *
 * Passing `null` for a field OMITS it from the document, which is how the
 * "field the bank did not send" variants are produced. Omitting is materially
 * different from sending an empty string: the adapter must fail closed on both,
 * and the difference is worth asserting separately.
 */
export function buildCbeApiResponse(options: SyntheticCbeApiOptions = {}): Record<string, unknown> {
  const settled = options.amountCredited === undefined ? '1250.00' : options.amountCredited;
  const charge = options.totalChargeAmount === undefined ? '10.00' : options.totalChargeAmount;
  const tax = options.totalTaxAmount === undefined ? '2.00' : options.totalTaxAmount;

  const doc: Record<string, unknown> = {
    id: options.transactionId ?? SYNTHETIC_CBE_TX_ID,
    transactionType: 'FT',
    debitAccountNo: '1000******555',
    currencyMktDr: 'ETB',
    debitCurrency: 'ETB',
    debitValueDate: options.valueDateCompact === undefined ? '20260421' : options.valueDateCompact,
    debitTheirRef: SYNTHETIC_CBE_TOKEN,
    creditTheirRef: SYNTHETIC_CBE_TOKEN,
    creditCurrency: 'ETB',
    creditValueDate: options.valueDateCompact === undefined ? '20260421' : options.valueDateCompact,
    processingDate: options.valueDateCompact === undefined ? '20260421' : options.valueDateCompact,
    paymentDetails: ['SYNTHETIC PAYMENT DETAIL LINE'],
    chargeComDisplay: '0.00',
    commissionCode: 'NORMAL',
    chargeCode: 'CHRG',
    positionType: 'CREDIT',
    amountCreditedWithCurrency: settled,
    totalChargeAmountWithCurrency: charge,
    totalTaxAmountWithCurrency: tax,
    totRecComm: '0.00',
    rateFixing: '1.0000',
    authDate: options.valueDateCompact === undefined ? '20260421' : options.valueDateCompact,
    roundType: 'NONE',
    currNo: 'ETB',
    creditAccountHolder: options.creditAccountHolder === undefined ? 'Bighabesha Shop' : options.creditAccountHolder,
    debitAccountHolder: options.debitAccountHolder === undefined ? 'TEST PAYER ALPHA' : options.debitAccountHolder,
    encodedReceipt: '',
    isPlatformTransaction: false,
    isOtherBank: options.isOtherBank ?? false,
    description: 'Synthetic intra-bank transfer',
    status: options.status ?? 'COMPLETED',
  };

  // `amountDebited` deliberately exceeds the settled amount by the fee and tax
  // below. A fixture where they were equal could not catch an adapter that
  // reads the wrong one, which is the exact defect this rail had on Telebirr.
  doc.amountDebited = options.amountDebited === undefined ? '1262.00' : options.amountDebited;

  assign(doc, 'amountCredited', settled);
  assign(doc, 'totalChargeAmount', charge);
  assign(doc, 'totalTaxAmount', tax);
  assign(doc, 'serviceChargeValue', options.serviceChargeValue === undefined ? '10.00' : options.serviceChargeValue);
  assign(doc, 'vatValue', options.vatValue === undefined ? '2.00' : options.vatValue);
  assign(doc, 'drCharge', options.drCharge === undefined ? '0.00' : options.drCharge);
  assign(doc, 'creditAccountNo', options.creditAccountNo === undefined ? SYNTHETIC_MASKED_ACCOUNT : options.creditAccountNo);
  assign(doc, 'dateTimes', options.dateTimes === undefined
    ? [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')]
    : options.dateTimes);

  if (options.channel !== undefined) doc.channel = options.channel;
  if (options.platformTransactionType !== undefined) {
    doc.platformTransactionType = options.platformTransactionType;
  }

  return doc;
}

/** Assigns unless the value is `null`, which means "the bank sent nothing". */
function assign(doc: Record<string, unknown>, key: string, value: unknown): void {
  if (value === null) {
    delete doc[key];
    return;
  }
  doc[key] = value;
}

/** Serialises {@link buildCbeApiResponse} the way the upstream API would. */
export function buildCbeApiBody(options: SyntheticCbeApiOptions = {}): string {
  return JSON.stringify(buildCbeApiResponse(options));
}

/**
 * The RFC 7807 body CBE returns for an unknown or tampered token.
 *
 * Note the status: **500**, not 404. The endpoint has no way to distinguish
 * "no such token" from "token altered in transit", so it reports both as a
 * server fault with a security note. That is precisely why the adapter has to
 * read the `detail` text to tell a bad customer reference apart from a real
 * outage.
 */
export function buildCbeInvalidTokenBody(): string {
  return JSON.stringify({
    type: 'https://mb.cbe.com.et/errors/invalid-legacy-token',
    title: 'Internal Server Error',
    status: 500,
    detail: 'Security Alert: Invalid or tampered legacy token!',
    instance: '/api/v1/transactions/public/transaction-detail',
    traceId: '0000000000000000',
  });
}

/** The exact API URL the adapter must request for a given reference token. */
export function cbeApiUrl(token: string = SYNTHETIC_CBE_TOKEN): string {
  return `https://mb.cbe.com.et/api/v1/transactions/public/transaction-detail/${token}`;
}

/** The customer-facing receipt link as it appears in the confirmation SMS. */
export function cbeReceiptUrl(token: string = SYNTHETIC_CBE_TOKEN): string {
  return `https://mbreciept.cbe.com.et/${token}`;
}

/** A minimal `ExtractedReceiptReference` for direct adapter-level tests. */
export function cbeReference(
  token: string = SYNTHETIC_CBE_TOKEN,
  overrides: Partial<ExtractedReceiptReference> = {}
): ExtractedReceiptReference {
  return {
    bank: 'cbe',
    rawReference: token,
    normalizedReference: token,
    extractedAt: new Date(),
    confidence: 1,
    decodeMethod: 'qr_matrix',
    ...overrides,
  };
}