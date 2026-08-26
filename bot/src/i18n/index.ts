import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TranslationDict = Record<string, any>;

const translations: Record<string, TranslationDict> = {};

/**
 * Loads all *.json locale dictionaries from the given directory.
 *
 * - Development (`pnpm dev` via tsx): reads directly from `src/i18n/`.
 * - Production (`pnpm start` via dist): the build pipeline copies
 *   `src/i18n/*.json` into `dist/i18n/` (see `scripts/copy-assets.mjs`,
 *   wired into the package `build` script), so the compiled bundle finds
 *   its dictionaries next to the emitted JS.
 */
export function loadTranslations(localesDir?: string): void {
  const dir = localesDir || __dirname;

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    logger.error({ err, dir }, 'Could not read locales directory — translations will be unavailable');
    return;
  }

  for (const file of files) {
    const lang = path.basename(file, '.json');
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    try {
      translations[lang] = JSON.parse(content);
      logger.debug({ lang }, `Loaded translations for ${lang}`);
    } catch (err) {
      logger.error({ err, file }, `Failed to parse translation file ${file}`);
    }
  }
}

// Auto-load English (and any sibling locales) on import
loadTranslations();

export function getLoadedLanguages(): string[] {
  return Object.keys(translations);
}

export function t(
  lang: string = 'en',
  key: string,
  params?: Record<string, string | number>
): string {
  const targetLang = translations[lang] ? lang : 'en';
  const dict = translations[targetLang] || translations['en'] || {};

  const keys = key.split('.');
  let current: any = dict;

  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      // Fallback to English if missing in target language
      if (targetLang !== 'en' && translations['en']) {
        let fallback: any = translations['en'];
        for (const fk of keys) {
          if (fallback && typeof fallback === 'object' && fk in fallback) {
            fallback = fallback[fk];
          } else {
            fallback = null;
            break;
          }
        }
        if (typeof fallback === 'string') {
          current = fallback;
          break;
        }
      }
      current = null;
      break;
    }
  }

  if (typeof current !== 'string') {
    return key;
  }

  let result = current;
  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
    }
  }

  return result;
}
