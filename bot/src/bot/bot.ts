import { Bot, BotError } from 'grammy';
import { logger } from '../logger/index.js';
import { startHandler } from './handlers/start.js';
import { healthHandler, pingHandler } from './handlers/health.js';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Global request logging middleware
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    const fromId = ctx.from?.id;
    const text = ctx.message?.text || ctx.callbackQuery?.data;

    logger.debug({ updateId, fromId, text }, 'Incoming Telegram update');
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.debug({ updateId, duration }, 'Update handled successfully');
  });

  // Register basic commands
  bot.command('start', startHandler);
  bot.command('health', healthHandler);
  bot.command('ping', pingHandler);

  // Global error boundary
  bot.catch((err: BotError) => {
    const ctx = err.ctx;
    logger.error(
      {
        err: err.error,
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
      },
      'Error occurred while handling update'
    );
  });

  return bot;
}
