import { getConfig } from './config/env.js';
import { logger } from './logger/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { createBot } from './bot/bot.js';
import { startPeriodicCleanup, stopPeriodicCleanup } from './services/maintenance.service.js';
import { stopWalletPayReconciliation } from './services/payments/index.js';
import { startLifecycleJobs, stopLifecycleJobs } from './services/lifecycle.service.js';
import { syncAdminsFromEnv } from './auth/permissions.js';
import { prewarmAllBanners } from './services/banner_generator.service.js';
import { tryAcquireLease } from './db/lease.js';
import { startResellerRetrySweeper, stopResellerRetrySweeper } from './services/reseller.service.js';

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

    // Create Grammy bot instance
    const bot = createBot(config.BOT_TOKEN);

    // Leader election: only the active leader runs Telegram long-polling and background sweepers.
    // Followers serve HTTP traffic only and periodically attempt to acquire leadership.
    const LEADER_LEASE_TTL = 30_000;
    let isLeader = tryAcquireLease('process:leader', LEADER_LEASE_TTL);
    let leaderHeartbeatTimer: NodeJS.Timeout | null = null;

    if (isLeader) {
      logger.info('Node acquired leader lease: starting background sweepers and Telegram polling');
      startPeriodicCleanup();
      startLifecycleJobs(bot);
      startResellerRetrySweeper(bot.api);
    } else {
      logger.info('Node operating as follower: HTTP API active; sweepers and Telegram polling standby');
    }

    leaderHeartbeatTimer = setInterval(() => {
      const nowLeader = tryAcquireLease('process:leader', LEADER_LEASE_TTL);
      if (nowLeader && !isLeader) {
        isLeader = true;
        logger.info('Node promoted to leader: activating background sweepers and Telegram polling');
        startPeriodicCleanup();
        startLifecycleJobs(bot);
        startResellerRetrySweeper(bot.api);
        bot.start({
          onStart: (botInfo) => {
            logger.info({ botId: botInfo.id, username: botInfo.username }, 'Promoted bot started polling');
          },
        }).catch((err) => logger.error({ err }, 'Promoted bot polling failed'));
      }
    }, 15_000);
    if (leaderHeartbeatTimer.unref) leaderHeartbeatTimer.unref();

    // Start Mini App REST API server (active on all nodes)
    const { startApiServer } = await import('./api/server.js');
    const { drainReconciliation } = await import('./services/payments/index.js');
    const { releaseLease } = await import('./db/lease.js');
    const apiServer = startApiServer(bot, config.PORT);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      try {
        if (leaderHeartbeatTimer) clearInterval(leaderHeartbeatTimer);
        stopPeriodicCleanup();
        stopLifecycleJobs();
        stopWalletPayReconciliation();
        stopResellerRetrySweeper();

        if (isLeader) {
          try {
            bot.stop();
          } catch {}
        }

        // Drain background reconciliation sweeps
        await drainReconciliation(5_000);

        // Stop accepting new connections, kill idle keep-alive sockets
        // immediately, then allow a short drain window for in-flight
        // requests before force-closing survivors and exiting.
        apiServer.close();
        const httpServer = apiServer as unknown as {
          closeIdleConnections?: () => void;
          closeAllConnections?: () => void;
        };
        httpServer.closeIdleConnections?.();

        await new Promise((resolve) => setTimeout(resolve, 500));
        httpServer.closeAllConnections?.();

        if (isLeader) {
          releaseLease('process:leader');
        }

        closeDatabase();
        logger.info('Cleanup complete. Exiting.');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Update Telegram Chat Menu Button to point to active WEBAPP_URL
    if (config.WEBAPP_URL && isLeader) {
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

    // Start bot polling if leader
    if (isLeader) {
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
    }
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Bighabesha Shop Bot');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
