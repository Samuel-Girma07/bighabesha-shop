import { getConfig } from './config/env.js';
import { logger } from './logger/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot } from './bot/bot.js';
import { startPeriodicCleanup, stopPeriodicCleanup } from './services/maintenance.service.js';
import { stopWalletPayReconciliation } from './services/payments/index.js';
import { startLifecycleJobs, stopLifecycleJobs } from './services/lifecycle.service.js';
import { syncAdminsFromEnv } from './auth/permissions.js';
import { prewarmAllBanners } from './services/banner_generator.service.js';

async function main() {
  // Process-level safety nets. Express 5 routes async-handler rejections into
  // its error chain and Grammy has bot.catch — these cover the residual class:
  // stray fire-and-forget promises and programmer errors outside any handler.
  // Without them Node >=15 crashes on the first unhandled rejection.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection — logged; process kept alive');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — terminating for PM2 restart');
    process.exit(1);
  });

  try {
    const config = getConfig();
    logger.info('Starting Bighabesha Shop Bot...');

    // Initialize database
    initDatabase(config.DATABASE_PATH);
    syncAdminsFromEnv();

    // Pre-rasterize standard product banners into disk cache
    void prewarmAllBanners();

    // Periodic hygiene: expired sessions/OTPs/drafts + old receipt uploads
    startPeriodicCleanup();

    // Create Grammy bot instance
    const bot = createBot(config.BOT_TOKEN);

    // Abandoned-checkout reminders + stale-order TTL sweeper
    startLifecycleJobs(bot);

    // Start Mini App REST API server
    const apiServer = (await import('./api/server.js')).startApiServer(bot, config.PORT);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      try {
        stopPeriodicCleanup();
        stopLifecycleJobs();
        stopWalletPayReconciliation();
        bot.stop();

        // Stop accepting new connections, kill idle keep-alive sockets
        // immediately, then allow a short drain window for in-flight
        // requests before force-closing survivors and exiting. PM2 gets a
        // fast, deterministic restart either way.
        apiServer.close();
        const httpServer = apiServer as unknown as {
          closeIdleConnections?: () => void;
          closeAllConnections?: () => void;
        };
        httpServer.closeIdleConnections?.();

        closeDatabase();
        logger.info('Cleanup complete. Draining briefly before exit.');
        await new Promise((resolve) => setTimeout(resolve, 500));
        httpServer.closeAllConnections?.();
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Update Telegram Chat Menu Button to point to active WEBAPP_URL
    if (config.WEBAPP_URL) {
      try {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🛍️ Open Shop',
            web_app: { url: config.WEBAPP_URL },
          },
        });
        logger.info({ webAppUrl: config.WEBAPP_URL }, 'Telegram Chat Menu Button automatically updated');
      } catch (err) {
        logger.warn({ err }, 'Failed to set Telegram Chat Menu Button');
      }
    }

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
