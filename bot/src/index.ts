import { getConfig } from './config/env.js';
import { logger } from './logger/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot } from './bot/bot.js';

async function main() {
  try {
    const config = getConfig();
    logger.info('Starting Bighabesha Shop Bot...');

    // Initialize database
    initDatabase(config.DATABASE_PATH);

    // Create Grammy bot instance
    const bot = createBot(config.BOT_TOKEN);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      try {
        bot.stop();
        closeDatabase();
        logger.info('Cleanup complete. Process exiting.');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start bot polling
    logger.info('Bot initialized. Starting long polling...');
    await bot.start({
      onStart: (botInfo) => {
        logger.info(
          {
            botId: botInfo.id,
            username: botInfo.username,
            nodeEnv: config.NODE_ENV,
          },
          'Bot successfully connected to Telegram API!'
        );
      },
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Bighabesha Shop Bot');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
