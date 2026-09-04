import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Deterministically resolves the monorepo root directory, independent of process.cwd().
 */
export function resolveRepoRoot(moduleDir: string = __dirname): string {
  if (process.env.REPO_ROOT) {
    return path.resolve(process.env.REPO_ROOT);
  }
  let curr = path.resolve(moduleDir);
  while (curr !== path.dirname(curr)) {
    if (
      fs.existsSync(path.join(curr, 'pnpm-workspace.yaml')) ||
      (fs.existsSync(path.join(curr, 'package.json')) &&
        !fs.existsSync(path.join(curr, 'src')) &&
        fs.existsSync(path.join(curr, 'bot')))
    ) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(moduleDir, '../../..');
}

/**
 * Resolves the canonical SQLite database path.
 * - ':memory:' is preserved as-is.
 * - Absolute paths are preserved as-is.
 * - Relative paths (e.g. './data/shop.db') are resolved relative to the monorepo root.
 */
export function resolveDatabasePath(customPath?: string): string {
  const target = (customPath && customPath.trim().length > 0)
    ? customPath.trim()
    : (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim().length > 0)
      ? process.env.DATABASE_PATH.trim()
      : './data/shop.db';
  if (target === ':memory:') {
    return ':memory:';
  }
  if (path.isAbsolute(target)) {
    return path.resolve(target);
  }
  return path.resolve(resolveRepoRoot(), target);
}

/**
 * Deterministic .env candidate paths, independent of the process working
 * directory. Priority order:
 *   1. Explicit override via DOTENV_PATH env var
 *   2. Monorepo root (.env) — the single source of truth
 *   3. bot/ local directory (legacy convenience during development)
 *   4. Current working directory (last resort)
 *
 * The FIRST existing file wins; no merging. This eliminates the previous
 * launch-directory-dependent behavior where running from `bot/` vs the repo
 * root silently loaded different configurations.
 */
export function resolveEnvCandidates(moduleDir: string = __dirname): string[] {
  const candidates: string[] = [];
  if (process.env.DOTENV_PATH) {
    candidates.push(path.resolve(process.env.DOTENV_PATH));
  }
  const root = resolveRepoRoot(moduleDir);
  candidates.push(
    path.resolve(root, '.env'),
    path.resolve(moduleDir, '../../..', '.env'),
    path.resolve(moduleDir, '../..', '.env'),
    path.resolve(process.cwd(), '.env')
  );
  return [...new Set(candidates)];
}

for (const p of resolveEnvCandidates()) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: true });
    break;
  }
}

export const EnvSchema = z
  .object({
    BOT_TOKEN: z
      .string({ required_error: 'BOT_TOKEN is required' })
      .min(1, 'BOT_TOKEN is required'),
    ADMIN_IDS: z
      .string({ required_error: 'ADMIN_IDS is required' })
      .min(1, 'ADMIN_IDS is required')
      .transform((val) =>
        val
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
          .map((id) => {
            const parsed = Number(id);
            if (isNaN(parsed)) {
              throw new Error(`Invalid Admin ID in ADMIN_IDS: "${id}"`);
            }
            return parsed;
          })
      ),
    WALLET_PAY_MODE: z.enum(['mock', 'live']).default('mock'),
    WALLET_PAY_API_KEY: z.string().optional().default(''),
    // No default: missing ADMIN_PASSWORD disables the web admin login (fail-closed)
    // and is a hard boot error in production.
    ADMIN_PASSWORD: z.string().optional(),
    DATABASE_PATH: z.string().default('./data/shop.db'),
    RECEIPTS_DIR: z.string().optional(),       // defaults to <db-dir>/receipts
    RECEIPT_MAX_BYTES: z
      .string()
      .default(String(5 * 1024 * 1024))
      .transform((v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n <= 0) throw new Error('RECEIPT_MAX_BYTES must be a positive integer');
        return n;
      }),
    RECEIPT_RETENTION_DAYS: z
      .string()
      .default('90')
      .transform((v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 0) throw new Error('RECEIPT_RETENTION_DAYS must be a non-negative integer');
        return n;
      }),
    PORT: z
      .string()
      .default('3000')
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) throw new Error('PORT must be a valid number');
        return parsed;
      }),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    /**
     * Public HTTPS URL of the Mini App. NO ephemeral default: when unset the
     * bot simply omits the WebApp menu button instead of pointing users at a
     * dead trycloudflare tunnel.
     */
    WEBAPP_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    SUPPORT_USERNAME: z.string().default('Vweah'),
    // '' = disabled. Accepts hop count ("1"), boolean ("true"/"false"),
    // or an express `trust proxy` expression ("loopback", "10.0.0.0/8", ...).
    TRUST_PROXY: z.string().default(''),
    // Comma-separated list of extra allowed CORS origins (the WEBAPP_URL is always allowed).
    CORS_ORIGINS: z.string().default(''),
    // Optional integrations — features self-disable when unset.
    SUPPORT_GROUP_ID: z
      .string()
      .optional()
      .transform((v) => (v && /^-?\d+$/.test(v.trim()) ? parseInt(v.trim(), 10) : undefined)),
    CHAPA_SECRET_KEY: z.string().optional().default(''),
    TON_TREASURY_ADDRESS: z.string().optional().default(''),
    /**
     * B2B reseller fulfillment for Telegram Premium. When RESELLER_PROVIDER is
     * unset the Premium pipeline falls back to the manual 'pending_fulfillment'
     * queue (pre-010 behavior); when set, admin approval drives the provider.
     * 'mock' is dev/test only and auto-succeeds.
     * 'both' / 'cascade' enables dual-provider cascading failover (Gramix primary -> iStar fallback).
     */
    RESELLER_PROVIDER: z.enum(['mock', 'gramix', 'istar', 'generic', 'both', 'cascade']).optional(),
    RESELLER_API_KEY: z.string().optional().default(''),
    RESELLER_API_URL: z
      .string()
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    GRAMIX_API_KEY: z.string().optional().default(''),
    ISTAR_API_KEY: z.string().optional().default(''),
    GRAMIX_API_URL: z
      .string()
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    ISTAR_API_URL: z
      .string()
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    RESELLER_LOW_BALANCE_ALERT_USDT: z
      .string()
      .default('50')
      .transform((v) => {
        const n = parseFloat(v);
        if (isNaN(n) || n < 0) throw new Error('RESELLER_LOW_BALANCE_ALERT_USDT must be a non-negative number');
        return n;
      }),
    REQUIRED_CHANNEL_USERNAME: z.string().default('@bighabesha_softwares'),
    REQUIRED_CHANNEL_LINK: z.string().default('https://t.me/bighabesha_softwares'),
    FORCE_SUBSCRIBE: z
      .string()
      .default('true')
      .transform((v) => v !== 'false' && v !== '0'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      if (!cfg.ADMIN_PASSWORD || cfg.ADMIN_PASSWORD.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PASSWORD'],
          message:
            'ADMIN_PASSWORD is required in production (minimum 8 characters) — refusing to boot with insecure defaults',
        });
      }
      if (cfg.WALLET_PAY_MODE !== 'live') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WALLET_PAY_MODE'],
          message:
            'WALLET_PAY_MODE must be explicitly set to "live" in production — mock payments auto-confirm orders and are forbidden outside development',
        });
      }
      if (!cfg.WALLET_PAY_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WALLET_PAY_API_KEY'],
          message: 'WALLET_PAY_API_KEY is required in production when WALLET_PAY_MODE=live',
        });
      }
      if (!cfg.WEBAPP_URL || !cfg.WEBAPP_URL.startsWith('https://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEBAPP_URL'],
          message: 'WEBAPP_URL must be set to an HTTPS URL in production (the Mini App menu button points here)',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadEnv(envInput: Record<string, string | undefined> = process.env): AppConfig {
  const result = EnvSchema.safeParse(envInput);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  const cfg = result.data;

  // Safe auto-default (H2 hardening): behind cloudflared/nginx-on-box every
  // request arrives from the loopback address. With trust proxy disabled,
  // express-rate-limit keys ALL clients into ONE bucket (a single attacker
  // can throttle the whole store's checkout) and audit logs record every IP
  // as ::1/127.0.0.1. 'loopback' is correct for the documented topology;
  // explicit overrides always win.
  if (cfg.NODE_ENV === 'production' && !cfg.TRUST_PROXY.trim()) {
    cfg.TRUST_PROXY = 'loopback';
    // eslint-disable-next-line no-console — logger may not be configured yet during boot validation
    console.warn(
      '[config] TRUST_PROXY was empty in production — auto-set to "loopback" ' +
        '(correct behind cloudflared/nginx-on-box). Set TRUST_PROXY explicitly to override.'
    );
  }

  return cfg;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnv();
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export function isProduction(config: AppConfig = getConfig()): boolean {
  return config.NODE_ENV === 'production';
}
