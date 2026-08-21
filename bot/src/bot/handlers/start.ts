import { CommandContext, Context, InlineKeyboard } from 'grammy';
import { getDatabase } from '../../db/index.js';
import { getConfig } from '../../config/env.js';
import { t } from '../../i18n/index.js';
import { logger } from '../../logger/index.js';

export function upsertUser(user: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string }): { language_code: string; is_admin: boolean } {
  try {
    const db = getDatabase();
    const config = getConfig();
    const isAdmin = config.ADMIN_IDS.includes(user.id) ? 1 : 0;

    const existing = db.prepare('SELECT language_code, is_admin FROM users WHERE id = ?').get(user.id) as { language_code: string; is_admin: number } | undefined;

    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, username, first_name, last_name, language_code, is_admin)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(user.id, user.username || null, user.first_name || '', user.last_name || '', user.language_code || 'en', isAdmin);

      return { language_code: user.language_code || 'en', is_admin: isAdmin === 1 };
    } else {
      db.prepare(`
        UPDATE users
        SET username = ?, first_name = ?, last_name = ?, is_admin = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(user.username || null, user.first_name || '', user.last_name || '', isAdmin, user.id);

      return { language_code: existing.language_code || 'en', is_admin: isAdmin === 1 };
    }
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to upsert user in database');
    return { language_code: 'en', is_admin: false };
  }
}

export async function startHandler(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const { language_code, is_admin } = upsertUser({
    id: from.id,
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
    language_code: from.language_code,
  });

  const config = getConfig();

  const keyboard = new InlineKeyboard()
    .text(t(language_code, 'menu.shop'), 'nav_shop')
    .row()
    .text(t(language_code, 'menu.orders'), 'nav_orders')
    .text(t(language_code, 'menu.language'), 'nav_language')
    .row()
    .url(t(language_code, 'menu.support'), `https://t.me/${config.SUPPORT_USERNAME}`);

  if (is_admin) {
    keyboard.row().text(t(language_code, 'menu.admin'), 'admin_menu');
  }

  const welcomeText = t(language_code, 'start.welcome');
  await ctx.reply(welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
