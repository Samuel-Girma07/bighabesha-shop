import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file into process.env if present
dotenv.config();

export const EnvSchema = z.object({
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
  DATABASE_PATH: z.string().default('./data/shop.db'),
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
  WEBAPP_URL: z.string().url().default('https://shop.bighabesha.com'),
  SUPPORT_USERNAME: z.string().default('Vweah'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadEnv(envInput: Record<string, string | undefined> = process.env): AppConfig {
  const result = EnvSchema.safeParse(envInput);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnv();
  }
  return cachedConfig;
}
