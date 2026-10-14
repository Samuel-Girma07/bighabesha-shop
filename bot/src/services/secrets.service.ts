import crypto from 'crypto';
import { getDatabase, prepared } from '../db/index.js';
import { logger } from '../logger/index.js';

/**
 * Encryption-at-rest for API keys, webhook secrets and the TON hot-wallet seed.
 *
 * ## Why this module is separate from settings.service.ts
 *
 * `settings.service.ts` is on the hot path of nearly every request that renders
 * a price or a checkout screen. Pulling `node:crypto` key derivation into it
 * would put an AES setup cost on all of them for no benefit. This module is
 * only touched when a secret is actually written or read, which is a handful of
 * times a day.
 *
 * ## The two independent concerns
 *
 * There are two different questions about a setting, and conflating them was
 * the original design mistake:
 *
 *   - **Is this row sensitive?**      -> `SECRET_SETTING_KEYS` in
 *                                       settings.service.ts. Enforced at the
 *                                       API boundary so the value never reaches
 *                                       a browser, a PUT payload or an audit row.
 *   - **Is this row's `value` ciphertext?** -> `settings.is_secret`. Enforced
 *                                       here, so `getSecret()` cannot be used
 *                                       to read a plaintext row by accident.
 *
 * A row can be sensitive and not yet encrypted. Two rows are exactly that:
 * `download_link_secret` and `receipt_ethiopia_proxy_url` predate this module
 * and are marked `is_secret = 1` by migration 015 while still holding plaintext.
 * `decryptSecret()` passes a non-envelope value through unchanged so they keep
 * working without a forced rotation.
 *
 * ## Reading the master key
 *
 * `SECRET_ENCRYPTION_KEY` is read from `process.env` directly rather than
 * through `getConfig()`. Going through the config accessor would run the whole
 * env schema — which requires `BOT_TOKEN` and `ADMIN_IDS` — just to obtain one
 * crypto key, coupling secret storage to unrelated startup requirements and
 * making it untestable in isolation. The adapters already read their proxy
 * variables the same way. `NODE_ENV` is read the same way for the production
 * check below. Both keys are still declared in the `EnvSchema` so they are
 * documented and type-checked like every other variable; they are simply not
 * consumed through the cached config singleton.
 *
 * ## Losing the master key
 *
 * There is no recovery path. `SECRET_ENCRYPTION_KEY` is the only thing standing
 * between a leaked database dump and every API key in it. If it is lost, every
 * secret written through `setSecret()` is permanently unreadable — including the
 * TON hot-wallet seed, which would mean the funds behind it are unreachable.
 * Back it up before the first secret is stored.
 */

const ENVELOPE_PREFIX = 'enc:v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const AUTH_TAG_BYTES = 16;

export class SecretStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreUnavailableError';
  }
}

/**
 * True when a stored value is an AES-GCM envelope produced by this module.
 * Anything else is a legacy plaintext row and is handled as such.
 */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${ENVELOPE_PREFIX}:`);
}

/**
 * Derive the 32-byte master key from `SECRET_ENCRYPTION_KEY`.
 *
 * Accepts either a base64-encoded 32-byte value or a raw passphrase, which is
 * hashed with SHA-256 to reach the required length. The passphrase form exists
 * so an operator can set something memorable in the Render dashboard without
 * having to produce valid base64; it is weaker (no key stretching) and the log
 * line below says so.
 *
 * Production throws on a missing or unusable key: booting and then failing every
 * secret read at runtime is the worse outcome, because the shop keeps taking
 * orders it can never verify against a provider. Dev and test warn once and
 * return null so the suite does not need a key to run.
 */
let masterKeyCache: Buffer | null | undefined;
let hasWarnedAboutMissingKey = false;

function getMasterKey(): Buffer | null {
  if (masterKeyCache !== undefined) return masterKeyCache;

  const raw = (process.env.SECRET_ENCRYPTION_KEY ?? '').trim();
  const isProduction = (process.env.NODE_ENV ?? '').trim() === 'production';

  if (raw.length === 0) {
    masterKeyCache = null;
    if (isProduction) {
      throw new SecretStoreUnavailableError(
        'SECRET_ENCRYPTION_KEY is not set. Secrets cannot be encrypted or decrypted. ' +
          'Generate one with `openssl rand -base64 32` and set it in the Render environment ' +
          'and your local .env.'
      );
    }
    if (!hasWarnedAboutMissingKey) {
      hasWarnedAboutMissingKey = true;
      logger.warn(
        'SECRET_ENCRYPTION_KEY is not set — secret storage is disabled for this process'
      );
    }
    return null;
  }

  // Exact-length base64 is the documented form and is used as-is.
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
    masterKeyCache = decoded;
    return masterKeyCache;
  }

  // Anything else is treated as a passphrase. No key stretching is applied, so
  // this is only acceptable when the value has enough entropy to begin with.
  masterKeyCache = crypto.createHash('sha256').update(raw, 'utf8').digest();
  logger.warn(
    'SECRET_ENCRYPTION_KEY is not 32 bytes of base64; it was hashed with SHA-256 instead. ' +
      'Use `openssl rand -base64 32` for the documented form.'
  );
  return masterKeyCache;
}

/** Test helper: drops the cached derived key so the next call re-reads config. */
export function resetSecretStoreCache(): void {
  masterKeyCache = undefined;
  hasWarnedAboutMissingKey = false;
}

export function encryptSecret(plaintext: string): string {
  const key = getMasterKey();
  if (!key) {
    throw new SecretStoreUnavailableError(
      'Cannot encrypt a secret without SECRET_ENCRYPTION_KEY'
    );
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an envelope. A non-envelope value is returned unchanged as a legacy
 * plaintext row — see the module header.
 */
export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored;

  const key = getMasterKey();
  if (!key) {
    throw new SecretStoreUnavailableError(
      'Cannot decrypt a secret without SECRET_ENCRYPTION_KEY'
    );
  }

  // `enc:v1:<iv>:<tag>:<ct>` splits into FIVE parts, not four — the `enc:v1`
  // prefix contains its own colon. Getting this wrong makes every correctly
  // stored value look like a malformed envelope.
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new SecretStoreUnavailableError(
      `Malformed secret envelope: expected "enc:v1:<iv>:<tag>:<ct>", got ${parts.length} colon-separated parts`
    );
  }

  try {
    // parts = ['enc', 'v1', iv, tag, ciphertext]
    const iv = Buffer.from(parts[2], 'base64');
    const authTag = Buffer.from(parts[3], 'base64');
    const ciphertext = Buffer.from(parts[4], 'base64');

    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error('unexpected iv or auth tag length');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    // Never surface the underlying crypto error verbatim to an API caller: it
    // can carry byte-level detail about the ciphertext. This message is enough
    // for an operator to act on, and it names the likely cause.
    throw new SecretStoreUnavailableError(
      'Stored secret could not be decrypted. Either SECRET_ENCRYPTION_KEY does not match ' +
        'the key this value was written with, or the stored value has been corrupted. ' +
        `Cause: ${err instanceof Error ? err.message : 'unknown'}`
    );
  }
}

/**
 * Last-4-only mask for display. Deliberately NOT `redactSecret()` from
 * logger/index.ts, which reveals the first four characters as well — enough of
 * an API key prefix to be useful to an attacker holding a partial dump.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 4) return '****';
  return `****${trimmed.slice(-4)}`;
}

export type SecretAuditAction = 'set' | 'clear' | 'rotate' | 'forced' | 'seed';

export interface SecretWriteOptions {
  /**
   * Commit without running the provider validation callback. Required by the
   * `skipValidation` escape hatch so an operator is never locked out of saving
   * a key because the provider is mid-outage. Audited as `forced`.
   */
  skipValidation?: boolean;
  /** What the value is being used for, e.g. 'links.et API key'. Audit context only. */
  label?: string;
  ip?: string;
}

/**
 * Result of validating a staged secret.
 *
 * `ok: false` is a normal outcome, not an exception: a wrong key is a
 * configuration mistake the operator needs to read, not a crash. Phase 0 ships
 * with a format-only validator; Phase 2 swaps in a real provider auth call.
 */
export type SecretValidator = (value: string) => Promise<SecretValidationResult>;

export interface SecretValidationResult {
  ok: boolean;
  /** Operator-facing reason. Never contains the value. */
  detail?: string;
}

export const SECRET_SETTING_KEY_META: Readonly<Record<string, string>> = {
  verify_links_api_key: 'links.et verification API key',
  verify_verifyet_api_key: 'verify.et verification API key',
  provider_gramix_api_key: 'Gramix reseller API key',
  provider_catfee_api_key: 'CatFee.io API access key',
  provider_catfee_api_secret: 'CatFee.io API signing secret',
  provider_mystars_api_key: 'MyStars.tg API key',
  provider_mystars_webhook_secret: 'MyStars.tg webhook signing secret',
  provider_mystars_wallet_seed: 'TON hot-wallet seed mnemonic',
  download_link_secret: 'Receipt download-link signing secret',
  receipt_ethiopia_proxy_url: 'Ethiopian egress proxy URI',
};

/**
 * Keys that must be written through the encrypted store and NOT through
 * `PUT /api/admin/settings`.
 *
 * This is deliberately NARROWER than `SECRET_SETTING_KEYS`. That set is the
 * sensitivity denylist and it also contains two legacy rows —
 * `receipt_ethiopia_proxy_url` and `download_link_secret` — which predate
 * encryption, are written through the generic settings endpoint today, and are
 * protected by filtering them out of responses plus redaction at the
 * `recordAudit` choke point. Stripping those too would be a regression: the
 * dashboard would stop being able to set the egress proxy at all.
 *
 * The distinction is that this set can ONLY be written through `setSecret()`,
 * because the generic endpoint has no way to encrypt what it receives.
 */
export const ENCRYPTED_SETTING_KEYS: ReadonlySet<string> = new Set([
  'verify_links_api_key',
  'verify_verifyet_api_key',
  'provider_gramix_api_key',
  'provider_catfee_api_key',
  'provider_catfee_api_secret',
  'provider_mystars_api_key',
  'provider_mystars_webhook_secret',
  'provider_mystars_wallet_seed',
]);

/** Phase 0 default: shape and length only. No network call, no provider knowledge. */
export const formatOnlySecretValidator: SecretValidator = async (value) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, detail: 'Value is empty.' };
  }
  if (trimmed.length < 8) {
    return {
      ok: false,
      detail: `Value is only ${trimmed.length} characters. That is too short to be a usable credential.`,
    };
  }
  if (/\s/.test(trimmed)) {
    return {
      ok: false,
      detail: 'Value contains whitespace. A trailing newline from copy-paste is the usual cause.',
    };
  }
  return { ok: true };
};

function assertSecretRow(key: string, row: { is_secret: number } | undefined): void {
  if (!row) {
    throw new SecretStoreUnavailableError(
      `Setting "${key}" does not exist, so it cannot hold a secret. ` +
        'Check that migration 015 has been applied.'
    );
  }
  if (row.is_secret !== 1) {
    throw new SecretStoreUnavailableError(
      `Setting "${key}" is not flagged is_secret, so it is not registered as an encrypted secret. ` +
        'Writing a credential here would store it in plaintext.'
    );
  }
}

export function getSecret(key: string, defaultValue = ''): string {
  try {
    const row = getDatabase()
      .prepare('SELECT value, is_secret FROM settings WHERE key = ?')
      .get(key) as { value: string; is_secret: number } | undefined;

    assertSecretRow(key, row);
    if (!row || row.value === '') return defaultValue;

    return decryptSecret(row.value);
  } catch (err) {
    if (err instanceof SecretStoreUnavailableError) throw err;
    logger.error({ err, key }, 'Failed to read secret from database');
    return defaultValue;
  }
}

export function getSecretMasked(key: string): string {
  try {
    const row = getDatabase()
      .prepare('SELECT value, is_secret FROM settings WHERE key = ?')
      .get(key) as { value: string; is_secret: number } | undefined;

    assertSecretRow(key, row);
    if (!row || row.value === '') return '';
    return maskSecret(decryptSecret(row.value));
  } catch (err) {
    if (err instanceof SecretStoreUnavailableError) throw err;
    logger.error({ err, key }, 'Failed to read masked secret from database');
    return '';
  }
}

export function isSecretConfigured(key: string): boolean {
  try {
    const row = getDatabase()
      .prepare('SELECT value, is_secret FROM settings WHERE key = ?')
      .get(key) as { value: string; is_secret: number } | undefined;
    return !!row && row.is_secret === 1 && row.value.trim().length > 0;
  } catch (err) {
    logger.error({ err, key }, 'Failed to check secret configuration');
    return false;
  }
}

/**
 * Stage → validate → commit.
 *
 * The new value is held in memory only. The stored value is untouched until the
 * validator passes, so a bad key can never reach the database and the working
 * key keeps serving traffic throughout. This is the whole reason the flow is
 * split rather than being a plain `setSecret` guarded by a UI confirm.
 */
export async function stageAndCommitSecret(
  key: string,
  value: string,
  adminId: number,
  validator: SecretValidator = formatOnlySecretValidator,
  options: SecretWriteOptions = {}
): Promise<{ committed: boolean; detail: string }> {
  const trimmed = value.trim();
  const label = options.label ?? SECRET_SETTING_KEY_META[key] ?? key;

  if (trimmed.length === 0) {
    return { committed: false, detail: `Refusing to clear ${label} through the set path. Use Clear instead.` };
  }

  let detail = '';
  if (options.skipValidation) {
    detail = `Validation skipped for ${label}. The stored value was NOT checked against the provider.`;
    logger.warn({ key, adminId }, detail);
  } else {
    let result: SecretValidationResult;
    try {
      result = await validator(trimmed);
    } catch (err) {
      // A validator that throws is treated as a failed validation, never as a
      // licence to commit. The old value stays live.
      logger.error({ err, key, adminId }, 'Secret validator threw; refusing to commit');
      return {
        committed: false,
        detail: `Could not validate ${label}: ${err instanceof Error ? err.message : 'validator error'}. Nothing was saved.`,
      };
    }

    if (!result.ok) {
      return {
        committed: false,
        detail: `${label} rejected: ${result.detail ?? 'validation failed'}. Nothing was saved and the previous value is still active.`,
      };
    }
    detail = `${label} validated and saved.`;
  }

  setSecret(key, trimmed);
  recordSettingsAudit({
    adminId,
    key,
    action: options.skipValidation ? 'forced' : 'set',
    maskedValue: maskSecret(trimmed),
    ip: options.ip,
  });

  logger.info({ key, adminId, forced: !!options.skipValidation, label }, 'Secret updated successfully');
  return { committed: true, detail };
}

/**
 * Encrypt and store. Prefer `stageAndCommitSecret`; this exists for the
 * service-owned cases (a generated secret on first use) where there is no
 * operator-supplied value to validate.
 */
export function setSecret(key: string, plaintext: string): void {
  const db = getDatabase();
  const row = db.prepare('SELECT is_secret FROM settings WHERE key = ?').get(key) as
    | { is_secret: number }
    | undefined;
  assertSecretRow(key, row);

  const encrypted = encryptSecret(plaintext);
  prepared(
    `INSERT INTO settings (key, value, is_secret, updated_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       is_secret = 1,
       updated_at = CURRENT_TIMESTAMP,
       rotated_at = CASE WHEN settings.value <> excluded.value THEN CURRENT_TIMESTAMP ELSE settings.rotated_at END`
  ).run(key, encrypted);
}

export function clearSecret(key: string, adminId: number, ip?: string): void {
  const db = getDatabase();
  const row = db.prepare('SELECT is_secret FROM settings WHERE key = ?').get(key) as
    | { is_secret: number }
    | undefined;
  assertSecretRow(key, row);

  prepared(
    `INSERT INTO settings (key, value, is_secret, updated_at)
     VALUES (?, '', 1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = '',
       is_secret = 1,
       updated_at = CURRENT_TIMESTAMP`
  ).run(key);

  recordSettingsAudit({
    adminId,
    key,
    action: 'clear',
    maskedValue: null,
    ip,
  });
  logger.warn({ key, adminId }, 'Secret cleared');
}

export interface SettingsAuditInput {
  adminId: number;
  key: string;
  action: SecretAuditAction | string;
  maskedValue?: string | null;
  ip?: string;
}

export function recordSettingsAudit(input: SettingsAuditInput): void {
  try {
    prepared(
      `INSERT INTO settings_audit (admin_id, key, action, masked_value, ip)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.adminId, input.key, input.action, input.maskedValue ?? null, input.ip ?? null);
  } catch (err) {
    // An audit failure must not roll back the change it was recording. The
    // value is already committed; refusing here would leave the operator
    // believing a key was not saved when it was.
    logger.error({ err, key: input.key }, 'Failed to write settings_audit row');
  }
}

/**
 * Drop audit rows past the 365-day retention window.
 *
 * Called from the existing maintenance sweep rather than a new scheduler: the
 * sweep already runs and already owns "delete things that are no longer
 * useful", and adding a second timer for one table would be a new failure mode
 * for no benefit.
 *
 * `settings_audit` is deliberately NOT pruned by the `receipt_retention_days_*`
 * settings — those govern receipt evidence, not configuration history.
 */
export function pruneSettingsAudit(retentionDays = 365): number {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const result = prepared('DELETE FROM settings_audit WHERE created_at < ?').run(cutoff);
    const deleted = result.changes;
    if (deleted > 0) {
      logger.info({ deleted, retentionDays }, 'Pruned settings_audit rows past retention');
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, 'Failed to prune settings_audit');
    return 0;
  }
}
