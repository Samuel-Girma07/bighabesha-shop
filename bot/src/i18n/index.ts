import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TranslationDict = Record<string, any>;

const translations: Record<string, TranslationDict> = {};

export function loadTranslations(localesDir?: string): void {
  const dir = localesDir || __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

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

// Auto-load English on import
loadTranslations();

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
