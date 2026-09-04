/**
 * CBE (Commercial Bank of Ethiopia) debit SMS parser.
 *
 * Pure, fixture-driven extraction of {amount, reference, datetime} from
 * forwarded bank SMS texts. Parsers are intentionally conservative:
 * anything ambiguous returns null so humans stay in the loop.
 */

export interface ParsedCbeSms {
  amountEtb: number;
  reference: string;
  datetimeText: string | null;
  direction: 'debit' | 'credit';
  bank: 'cbe' | 'unknown';
}

interface SmsPattern {
  bank: 'cbe' | 'unknown';
  regex: RegExp;
  map: (m: RegExpMatchArray) => Omit<ParsedCbeSms, 'bank'> | null;
}

const PATTERNS: SmsPattern[] = [
  // Most specific first: amount followed by explicit reference anywhere nearby
  // "ETB 2,500.00 ... Ref: FT99XYZ1234" / "1,250.00 ETB Reference: FT..."
  {
    bank: 'cbe',
    regex: /(ETB|Birr)\s*:?[\s-]*([\d,]+(?:\.\d{1,2})?)\b[\s\S]{0,60}?Ref(?:erence)?[:\s#:]*([A-Z0-9]{6,24})/i,
    map: (m) => ({
      amountEtb: parseAmount(m[2]),
      reference: (m[3] || '').toUpperCase(),
      datetimeText: extractDate(m.input ?? ''),
      direction: m[0]?.toLowerCase().includes('credit') ? 'credit' : 'debit',
    }),
  },
  // "You have transferred 1,500.00 Birr to ..." (no reliable ref)
  {
    bank: 'cbe',
    regex: /(?:transferred|paid|sent)\s+(?:birr\s+)?([\d,]+(?:\.\d{1,2})?)\s*:?\s*(?:ETB|birr)/i,
    map: (m) => ({
      amountEtb: parseAmount(m[1]),
      reference: '',
      datetimeText: extractDate(m.input ?? ''),
      direction: 'debit',
    }),
  },
  // "Debited: ETB 1,500.00" fallback (reference optional)
  {
    bank: 'cbe',
    regex: /debited[^0-9]{0,20}(?:ETB|Birr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    map: (m) => ({
      amountEtb: parseAmount(m[1]),
      reference: '',
      datetimeText: extractDate(m.input ?? ''),
      direction: 'debit',
    }),
  },
];

function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function extractDate(text: string): string | null {
  const m = text.match(/(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[ ,]+\d{1,2}:\d{2}(?::\d{2})?)?)|( \d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
  return m ? (m[0] || m[1] || '').trim() : null;
}

/**
 * Parses a forwarded SMS into structured evidence.
 * Returns null for non-bank or unparseable content — callers must treat
 * null as "no evidence", never as a match.
 */
export function parseBankSms(text: string): ParsedCbeSms | null {
  if (!text || text.length < 10 || text.length > 1000) return null;

  for (const pattern of PATTERNS) {
    const m = text.match(pattern.regex);
    if (!m) continue;
    try {
      const mapped = pattern.map({ ...m, input: text } as RegExpMatchArray);
      if (!mapped || !Number.isFinite(mapped.amountEtb) || mapped.amountEtb <= 0) continue;
      return { ...mapped, bank: pattern.bank };
    } catch {
      continue;
    }
  }
  return null;
}

export interface SmsMatchResult {
  matched: boolean;
  reason?: string;
  orderId?: string;
}

/**
 * Matches parsed SMS evidence against a buyer's open orders:
 * exact amount AND created within the lookback window. Unique matches only —
 * ambiguity is surfaced rather than guessed.
 */
export function matchSmsToOrders(
  db: any,
  userId: number,
  parsed: { amountEtb: number; reference: string },
  windowMinutes: number = 120,
  nowMs: number = Date.now()
): SmsMatchResult {
  if (parsed.reference) {
    const existingMatched = db.prepare(`
      SELECT id FROM receipt_evidence WHERE UPPER(TRIM(reference)) = UPPER(TRIM(?)) AND matched = 1
    `).get(parsed.reference);
    if (existingMatched) {
      return { matched: false, reason: 'reference_already_used' };
    }
  }

  const candidates = db.prepare(`
    SELECT id, amount_etb, discount_etb FROM orders
    WHERE user_id = ?
      AND status IN ('awaiting_payment', 'new')
      AND created_at >= datetime('now', '-' || ? || ' minutes')
    ORDER BY created_at DESC
    LIMIT 25
  `).all(userId, String(windowMinutes)) as { id: string; amount_etb: number; discount_etb: number }[];

  const matches = candidates.filter((o) => {
    const net = o.amount_etb - (o.discount_etb || 0);
    return net === parsed.amountEtb;
  });

  if (matches.length === 0) {
    return { matched: false, reason: 'no_amount_match' };
  }
  if (matches.length > 1) {
    return { matched: false, reason: 'ambiguous' };
  }

  void nowMs;
  return { matched: true, orderId: matches[0].id };
}
