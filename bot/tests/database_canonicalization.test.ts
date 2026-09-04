import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
  resolveRepoRoot,
  resolveDatabasePath,
  resetConfigCache,
} from '../src/config/env.js';
import { resolveReceiptsDir } from '../src/services/receipts.service.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import {
  upsertUser,
  saveUserPhone,
  saveUserLanguage,
  getUserById,
  isUserRegistered,
} from '../src/services/users.service.js';
import {
  handleSetLanguage,
  renderLanguageMenu,
} from '../src/bot/handlers/orders.js';
import { startHandler } from '../src/bot/handlers/start.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database Canonicalization, Path Resolution & Receipts Directory', () => {
  const originalCwd = process.cwd();
  const originalRepoRootEnv = process.env.REPO_ROOT;
  const originalDbPathEnv = process.env.DATABASE_PATH;
  const originalReceiptsDirEnv = process.env.RECEIPTS_DIR;

  beforeEach(() => {
    delete process.env.REPO_ROOT;
    delete process.env.DATABASE_PATH;
    delete process.env.RECEIPTS_DIR;
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111111';
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalRepoRootEnv !== undefined) {
      process.env.REPO_ROOT = originalRepoRootEnv;
    } else {
      delete process.env.REPO_ROOT;
    }
    if (originalDbPathEnv !== undefined) {
      process.env.DATABASE_PATH = originalDbPathEnv;
    } else {
      delete process.env.DATABASE_PATH;
    }
    if (originalReceiptsDirEnv !== undefined) {
      process.env.RECEIPTS_DIR = originalReceiptsDirEnv;
    } else {
      delete process.env.RECEIPTS_DIR;
    }
    resetConfigCache();
  });

  describe('resolveRepoRoot', () => {
    it('accurately identifies monorepo root containing pnpm-workspace.yaml', () => {
      const repoRoot = resolveRepoRoot();
      expect(fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, 'bot'))).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
    });

    it('honors process.env.REPO_ROOT override when explicitly configured', () => {
      const mockRoot = path.resolve(os.tmpdir(), 'mock-repo-root');
      process.env.REPO_ROOT = mockRoot;
      expect(resolveRepoRoot()).toBe(mockRoot);
    });

    it('consistently resolves same repo root regardless of process.cwd() changes', () => {
      const canonicalRoot = resolveRepoRoot();
      const botDir = path.join(canonicalRoot, 'bot');
      const tempDir = os.tmpdir();

      process.chdir(botDir);
      expect(resolveRepoRoot()).toBe(canonicalRoot);

      process.chdir(canonicalRoot);
      expect(resolveRepoRoot()).toBe(canonicalRoot);

      process.chdir(tempDir);
      expect(resolveRepoRoot()).toBe(canonicalRoot);
    });
  });

  describe('resolveDatabasePath', () => {
    it('strictly preserves ":memory:" indicator untouched for test isolation', () => {
      expect(resolveDatabasePath(':memory:')).toBe(':memory:');
    });

    it('preserves absolute database paths on any filesystem', () => {
      const absPath = path.resolve(os.tmpdir(), 'isolated-test-shop.db');
      expect(resolveDatabasePath(absPath)).toBe(absPath);
    });

    it('canonicalizes relative "./data/shop.db" to <repo_root>/data/shop.db across varied cwds', () => {
      const canonicalRoot = resolveRepoRoot();
      const expectedDbPath = path.resolve(canonicalRoot, 'data/shop.db');

      // 1. From repository root
      process.chdir(canonicalRoot);
      expect(resolveDatabasePath('./data/shop.db')).toBe(expectedDbPath);
      expect(resolveDatabasePath('data/shop.db')).toBe(expectedDbPath);

      // 2. From bot/ directory (simulating `cd bot && npm run dev`)
      const botDir = path.join(canonicalRoot, 'bot');
      process.chdir(botDir);
      expect(resolveDatabasePath('./data/shop.db')).toBe(expectedDbPath);
      expect(resolveDatabasePath()).toBe(expectedDbPath);

      // 3. From an external temporary directory
      process.chdir(os.tmpdir());
      expect(resolveDatabasePath('./data/shop.db')).toBe(expectedDbPath);
      expect(resolveDatabasePath()).toBe(expectedDbPath);
    });

    it('resolves custom relative path relative to monorepo root', () => {
      const canonicalRoot = resolveRepoRoot();
      expect(resolveDatabasePath('./custom/test.db')).toBe(path.resolve(canonicalRoot, 'custom/test.db'));
    });

    it('respects DATABASE_PATH environment variable if customPath is omitted', () => {
      const canonicalRoot = resolveRepoRoot();
      process.env.DATABASE_PATH = ':memory:';
      expect(resolveDatabasePath()).toBe(':memory:');

      process.env.DATABASE_PATH = './data/custom_env.db';
      expect(resolveDatabasePath()).toBe(path.resolve(canonicalRoot, 'data/custom_env.db'));
    });
  });

  describe('resolveReceiptsDir', () => {
    it('returns <repo_root>/data/receipts by default', () => {
      const canonicalRoot = resolveRepoRoot();
      const receiptsDir = resolveReceiptsDir();
      expect(receiptsDir).toBe(path.resolve(canonicalRoot, 'data/receipts'));
    });

    it('returns <repo_root>/data/receipts when databasePath is ":memory:"', () => {
      const canonicalRoot = resolveRepoRoot();
      const receiptsDir = resolveReceiptsDir(':memory:');
      expect(receiptsDir).toBe(path.resolve(canonicalRoot, 'data/receipts'));
    });

    it('honors explicit RECEIPTS_DIR environment variable override', () => {
      const customReceipts = path.resolve(os.tmpdir(), 'shop_receipts_store');
      process.env.RECEIPTS_DIR = customReceipts;
      resetConfigCache();

      expect(resolveReceiptsDir()).toBe(customReceipts);
    });

    it('resolves receipts adjacent to custom database file', () => {
      const customDb = path.resolve(os.tmpdir(), 'store', 'shop.db');
      const expectedReceiptsDir = path.resolve(os.tmpdir(), 'store', 'receipts');
      expect(resolveReceiptsDir(customDb)).toBe(expectedReceiptsDir);
    });
  });
});

describe('Amharic Language Persistence & Dynamic Language Menu', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111111';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('handleSetLanguage with "am" persists language_code = "am" to SQLite user row', async () => {
    const userId = 555001;
    upsertUser({
      id: userId,
      username: 'amharic_buyer',
      first_name: 'Almaz',
      language_code: 'en',
    });

    let answeredText = '';
    let editedText = '';
    let replyMarkup: any = null;

    const mockCtx: any = {
      from: { id: userId, username: 'amharic_buyer' },
      callbackQuery: { id: 'cb_test_am' },
      answerCallbackQuery: async (options: { text: string; show_alert?: boolean }) => {
        answeredText = options.text;
      },
      editMessageText: async (text: string, options: any) => {
        editedText = text;
        replyMarkup = options?.reply_markup;
      },
    };

    await handleSetLanguage(mockCtx, 'am');

    // 1. Verify DB persistence
    const userInDb = getUserById(userId);
    expect(userInDb).toBeDefined();
    expect(userInDb?.language_code).toBe('am');

    // Direct SQLite raw check
    const rawRow = db.prepare('SELECT language_code FROM users WHERE id = ?').get(userId) as any;
    expect(rawRow.language_code).toBe('am');

    // 2. Verify callback feedback
    expect(answeredText).toContain('ቋንቋው በተሳካ ሁኔታ ወደ አማርኛ ተቀይሯል');

    // 3. Verify dynamic menu re-render
    expect(editedText).toContain('የቋንቋ ምርጫ');
    expect(replyMarkup).toBeDefined();
    const buttons = replyMarkup.inline_keyboard.flat();
    const amharicBtn = buttons.find((b: any) => b.callback_data === 'set_lang_am');
    const englishBtn = buttons.find((b: any) => b.callback_data === 'set_lang_en');

    expect(amharicBtn).toBeDefined();
    expect(amharicBtn.style).toBe('success');
    expect(amharicBtn.text).toContain('አክቲቭ');

    expect(englishBtn).toBeDefined();
    expect(englishBtn.style).toBe('primary');
    expect(englishBtn.text).not.toContain('Active');
  });

  it('handleSetLanguage with "en" persists language_code = "en" to SQLite user row', async () => {
    const userId = 555002;
    upsertUser({
      id: userId,
      username: 'english_buyer',
      first_name: 'Solomon',
      language_code: 'am',
    });

    let answeredText = '';
    let editedText = '';
    let replyMarkup: any = null;

    const mockCtx: any = {
      from: { id: userId, username: 'english_buyer' },
      callbackQuery: { id: 'cb_test_en' },
      answerCallbackQuery: async (options: { text: string; show_alert?: boolean }) => {
        answeredText = options.text;
      },
      editMessageText: async (text: string, options: any) => {
        editedText = text;
        replyMarkup = options?.reply_markup;
      },
    };

    await handleSetLanguage(mockCtx, 'en');

    // 1. Verify DB persistence
    const userInDb = getUserById(userId);
    expect(userInDb).toBeDefined();
    expect(userInDb?.language_code).toBe('en');

    const rawRow = db.prepare('SELECT language_code FROM users WHERE id = ?').get(userId) as any;
    expect(rawRow.language_code).toBe('en');

    // 2. Verify callback feedback
    expect(answeredText).toContain('Language successfully set to English');

    // 3. Verify dynamic menu re-render
    expect(editedText).toContain('Language Settings');
    expect(replyMarkup).toBeDefined();
    const buttons = replyMarkup.inline_keyboard.flat();
    const englishBtn = buttons.find((b: any) => b.callback_data === 'set_lang_en');
    const amharicBtn = buttons.find((b: any) => b.callback_data === 'set_lang_am');

    expect(englishBtn).toBeDefined();
    expect(englishBtn.style).toBe('success');
    expect(englishBtn.text).toContain('Active');

    expect(amharicBtn).toBeDefined();
    expect(amharicBtn.style).toBe('primary');
    expect(amharicBtn.text).not.toContain('አክቲቭ');
  });

  it('renderLanguageMenu dynamically reflects current database language code without mutating state', async () => {
    const userId = 555003;
    upsertUser({
      id: userId,
      username: 'lang_checker',
      language_code: 'am',
    });

    let renderedText = '';
    let markup: any = null;

    const mockCtx: any = {
      from: { id: userId },
      callbackQuery: { id: 'cb_render' },
      editMessageText: async (text: string, options: any) => {
        renderedText = text;
        markup = options?.reply_markup;
      },
    };

    await renderLanguageMenu(mockCtx);

    expect(renderedText).toContain('የቋንቋ ምርጫ');
    const buttons = markup.inline_keyboard.flat();
    const amharicBtn = buttons.find((b: any) => b.callback_data === 'set_lang_am');
    expect(amharicBtn.style).toBe('success');

    // Switch to English in DB and re-render
    saveUserLanguage(userId, 'en');
    await renderLanguageMenu(mockCtx);

    expect(renderedText).toContain('Language Settings');
    const updatedButtons = markup.inline_keyboard.flat();
    const updatedEnglishBtn = updatedButtons.find((b: any) => b.callback_data === 'set_lang_en');
    expect(updatedEnglishBtn.style).toBe('success');
  });
});

describe('User Registration & Language Persistence across Restarts (/start)', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111111';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('first-time user is prompted for language selection on /start', async () => {
    const newUserId = 900001;
    let sentReplyText = '';
    let sentOptions: any = null;

    const mockCtx: any = {
      from: { id: newUserId, username: 'first_timer', first_name: 'First' },
      reply: async (text: string, options: any) => {
        sentReplyText = text;
        sentOptions = options;
      },
      replyWithPhoto: async () => {},
      setChatMenuButton: async () => {},
    };

    // User does not exist in DB yet
    expect(getUserById(newUserId)).toBeNull();
    expect(isUserRegistered(newUserId)).toBe(false);

    await startHandler(mockCtx, { skipChannelCheck: true });

    // Should prompt for language selection
    expect(sentReplyText).toContain('Please select your preferred language');
    expect(sentReplyText).toContain('ቋንቋ ይምረጡ');
    expect(sentOptions?.reply_markup).toBeDefined();
    const buttons = sentOptions.reply_markup.inline_keyboard.flat();
    expect(buttons.some((b: any) => b.callback_data === 'onboard_lang_am')).toBe(true);
    expect(buttons.some((b: any) => b.callback_data === 'onboard_lang_en')).toBe(true);
  });

  it('user with language selected but no phone is prompted for phone registration on /start', async () => {
    const unverifiedUserId = 900002;
    upsertUser({
      id: unverifiedUserId,
      username: 'unverified_buyer',
      first_name: 'Unverified',
      language_code: 'am',
    });

    let sentReplyText = '';
    let sentOptions: any = null;

    const mockCtx: any = {
      from: { id: unverifiedUserId, username: 'unverified_buyer', first_name: 'Unverified' },
      reply: async (text: string, options: any) => {
        sentReplyText = text;
        sentOptions = options;
      },
      replyWithPhoto: async () => {},
      setChatMenuButton: async () => {},
    };

    expect(getUserById(unverifiedUserId)).toBeDefined();
    expect(isUserRegistered(unverifiedUserId)).toBe(false);

    await startHandler(mockCtx, { skipChannelCheck: true });

    // Should prompt for phone verification, NOT language selection
    expect(sentReplyText.includes('Phone Number Verification') || sentReplyText.includes('የስልክ ቁጥር ማረጋገጫ')).toBe(true);
    expect(sentReplyText).not.toContain('Please select your preferred language');
    expect(sentOptions?.reply_markup).toBeDefined();
    // Keyboard has phone share button
    const keyboardButtons = sentOptions.reply_markup.keyboard.flat();
    expect(keyboardButtons.some((b: any) => b.text.includes('Share Phone Number') || b.text.includes('ስልክ ቁጥር አጋራ'))).toBe(true);
  });

  it('registered user executing /start skips language and phone prompts and retains Amharic language', async () => {
    const registeredUserId = 900003;

    // 1. User registers phone and sets Amharic language
    upsertUser({
      id: registeredUserId,
      username: 'loyal_amharic_user',
      first_name: 'Binyam',
      language_code: 'am',
    });
    saveUserPhone(registeredUserId, '+251911223344');

    expect(isUserRegistered(registeredUserId)).toBe(true);
    expect(getUserById(registeredUserId)?.language_code).toBe('am');

    const sentReplies: Array<{ text?: string; caption?: string; options?: any }> = [];

    const mockCtx: any = {
      from: { id: registeredUserId, username: 'loyal_amharic_user', first_name: 'Binyam' },
      reply: async (text: string, options: any) => {
        sentReplies.push({ text, options });
      },
      replyWithPhoto: async (photo: any, options: any) => {
        sentReplies.push({ caption: options?.caption, options });
      },
      setChatMenuButton: async () => {},
    };

    // 2. Simulate bot restart and /start command
    await startHandler(mockCtx, { skipChannelCheck: true });

    // 3. Verify language and phone prompts were SKIPPED
    const allText = sentReplies.map((r) => r.text || r.caption || '').join(' ');
    expect(allText).not.toContain('Please select your preferred language');
    expect(allText).not.toContain('Phone Number Verification');

    // 4. Verify user directly received welcome storefront interface
    expect(allText).toContain('ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ');
    expect(allText).toContain('Gemini Pro');

    // 5. Verify Amharic preference was NOT reset to 'en'
    const persistedUser = getUserById(registeredUserId);
    expect(persistedUser?.language_code).toBe('am');
  });
});
