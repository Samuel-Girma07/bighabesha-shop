import { SupportedBank } from './types.js';

/**
 * Canonical bank transaction references.
 *
 * WHY THIS EXISTS — the aliasing hole
 * ----------------------------------
 * One real CBE transfer has several legitimate representations:
 *
 *   FT26287ABCDE                 the bank transaction id (12 chars, what we want)
 *   FT26287ABCDE12345678         id concatenated with a longer serial
 *   v2-AbCd3fHooVRzsbaUe3yeQ    the receipt token from the mbreciept link
 *
 * Different verification lanes return the SAME transfer in different shapes:
 * the direct CBE adapter returns `detail.id`, links.et returns whatever its
 * parser produced, cheki returns its own `reference` field. Migration 011
 * already enforces UNIQUE(bank, reference) and UNIQUE(bank, normalized_reference)
 * WHERE matched = 1 — but those indexes only bite if every lane writes the
 * IDENTICAL string. Without canonicalisation, one transfer replayed through
 * two different lanes writes two different rows and the structural backstop
 * never fires.
 *
 * So canonicalisation — not a new index — is what actually closes replay.
 *
 * THE CONTRACT
 * ------------
 *   canonicalizeReference() returns the ONE string that every lane must write
 *   to `receipt_evidence.reference` / `.normalized_reference` and to the
 *   anti-replay claim table.
 *
 *   It returns `null` when the input cannot be reduced to a known shape. A
 *   null is NOT a soft pass: callers must treat it as an adapter/parse fault
 *   (trip the breaker, fall through to the next lane). Guessing a shape here
 *   would write a non-canonical string into the index and silently disable
 *   replay protection for that reference — the exact failure this module exists
 *   to prevent.
 */

/**
 * CBE transaction id: `FT` + 10 uppercase alphanumerics. This is the shape the
 * bank's own JSON API publishes in `detail.id`, and the shape cheki echoes back.
 */
const CBE_CANONICAL_PATTERN = /^FT[0-9A-Z]{10}$/;

/**
 * Telebirr receipt references are the transaction numbers Ethio Telecom prints
 * in the receipt URL (`transactioninfo.ethiotelecom.et/receipt/<ref>`). Observed
 * renderings are mixed-case alphanumeric tokens such as `DJ42EJLYPY`.
 *
 * Deliberately permissive on length and alphabet (the vendor has used several
 * shapes) but STRICT on character class: anything containing a path separator,
 * whitespace or control character is rejected outright, so a hostile or garbled
 * value can never reach the database as a "canonical" reference.
 */
const TELEBIRR_CANONICAL_PATTERN = /^[A-Z0-9]{6,32}$/;

/** Strips whitespace, control characters and every separator we accept in a URL. */
function scrub(raw: string): string {
  return raw
    .replace(/[\r\n\t]/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .toUpperCase();
}

/**
 * Extracts the trailing token from a receipt URL, if the input is a URL.
 * Handles both the Ethio Telecom host and the CBE `mbreciept` host, and copes
 * with query strings and trailing slashes.
 */
function tokenFromUrl(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  // `v2-AbCd…` receipts live at the path root of mbreciept; telebirr receipts
  // live at `/receipt/<ref>`. Take the last non-empty path segment either way.
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  const last = segments[segments.length - 1];
  // Reject a segment that still looks like a path component we do not understand.
  if (last.includes('.')) return null;
  return last;
}

/**
 * Reduces a CBE reference to its strict canonical `FT##########` form.
 *
 * Handles, in order:
 *  1. A bare canonical id — returned unchanged.
 *  2. A longer `FT…` serial — the leading 12 characters are the transaction id.
 *  3. A `v2-…` / bare receipt token — NOT canonicalisable. The token is an opaque
 *     handle, not the transaction id; the bank id is only discoverable by asking
 *     the API. Callers must resolve it through a lane first and canonicalise the
 *     bank's own id, never the token the customer typed.
 */
function canonicalizeCbe(raw: string): string | null {
  const value = scrub(raw);

  const canonical = value.match(/^(FT[0-9A-Z]{10})/);
  if (canonical) return canonical[1];

  // A receipt token tells us nothing about the bank transaction id.
  if (CBE_CANONICAL_PATTERN.test(value)) return value;
  return null;
}

/** Reduces a Telebirr transaction reference to its canonical upper-case form. */
function canonicalizeTelebirr(raw: string): string | null {
  const asUrlToken = tokenFromUrl(raw);
  const value = scrub(asUrlToken ?? raw);

  if (!TELEBIRR_CANONICAL_PATTERN.test(value)) return null;
  return value;
}

/**
 * Canonicalises a bank transaction reference for anti-replay comparison.
 *
 * @param bank  The rail the reference belongs to. `unknown` never canonicalises.
 * @param raw   The reference as the bank or a lane reported it.
 * @returns     The one string every lane must persist, or `null` when the input
 *              has no known canonical shape.
 *
 * A `null` return is a hard signal, not a soft pass. See the module header.
 */
export function canonicalizeReference(bank: SupportedBank, raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  switch (bank) {
    case 'cbe':
      return canonicalizeCbe(trimmed);
    case 'telebirr':
      return canonicalizeTelebirr(trimmed);
    case 'abyssinia':
      return canonicalizeTelebirr(trimmed);
    case 'unknown':
    default:
      return null;
  }
}

/**
 * Whether a reference is a syntactically valid CBE token for the given bank.
 *
 * Used to reject an unroutable customer typo BEFORE any network call, so a typo
 * costs nothing on any rail and never counts against a lane's circuit breaker.
 */
export function isSyntacticallyValidReference(bank: SupportedBank, raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const value = scrub(raw.trim());

  switch (bank) {
    case 'cbe':
      // Either the canonical id, a longer FT serial, or a v2 receipt token.
      return /^FT[0-9A-Z]{10,}$/.test(value) || /^V2-[A-Z0-9]{16,24}$/.test(value);
    case 'telebirr':
    case 'abyssinia':
      return TELEBIRR_CANONICAL_PATTERN.test(tokenFromUrl(value) ?? value);
    case 'unknown':
    default:
      return false;
  }
}

export const REFERENCE_PATTERNS = Object.freeze({
  cbeCanonical: CBE_CANONICAL_PATTERN,
  telebirrCanonical: TELEBIRR_CANONICAL_PATTERN,
});