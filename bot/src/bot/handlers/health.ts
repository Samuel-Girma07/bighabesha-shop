import { CommandContext, Context } from 'grammy';
import { t } from '../../i18n/index.js';

export async function healthHandler(ctx: CommandContext<Context>): Promise<void> {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;
  const memoryUsageMB = Math.round(process.memoryUsage().rss / (1024 * 1024));

  const text = `${t('en', 'health.ok')}\n\n` +
    `⏱ <b>Uptime:</b> ${uptimeStr}\n` +
    `💾 <b>Memory RSS:</b> ${memoryUsageMB} MB\n` +
    `📡 <b>Environment:</b> ${process.env.NODE_ENV || 'development'}`;

  await ctx.reply(text, { parse_mode: 'HTML' });
}

export async function pingHandler(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply('pong 🏓');
}
