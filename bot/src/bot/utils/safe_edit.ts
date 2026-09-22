import { Context, InlineKeyboard } from 'grammy';
import { logger } from '../../logger/index.js';

/**
 * Universal safe message editor: handles both photo caption edits and text edits,
 * falling back gracefully to reply if Telegram rejects message in-place modification.
 *
 * Telegram forbids editMessageText on media messages ("there is no text in the
 * message to edit"). Handlers reachable from photo banners (main menu, catalog,
 * product details) MUST route through this helper or their buttons silently
 * no-op when the originating message carries a photo.
 */
export async function safeEditMessage(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const parse_mode = 'HTML' as const;
  const reply_markup = keyboard;

  if (ctx.callbackQuery) {
    const msg = ctx.callbackQuery.message;
    if (msg && ('photo' in msg || 'video' in msg || 'document' in msg || 'audio' in msg)) {
      try {
        await ctx.editMessageCaption({ caption: text, parse_mode, reply_markup });
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, 'Failed to editMessageCaption, attempting reply');
      }
    } else {
      try {
        await ctx.editMessageText(text, { parse_mode, reply_markup });
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, 'Failed to editMessageText, attempting reply');
      }
    }
  }

  await ctx.reply(text, { parse_mode, reply_markup });
}
