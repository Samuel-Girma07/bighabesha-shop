// Copies non-JS runtime assets from src/ into dist/ after `tsc`.
// TypeScript does not emit raw .json/.sql files, so without this step:
//   - the production bot boots with an empty translation dictionary
//   - a FRESH production deployment finds no schema files and crashes with
//     "no such table: ..." (migrator resolves dist/db/migrations at runtime)
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botRoot = path.resolve(__dirname, '..');

const copyJobs = [
  { from: path.join(botRoot, 'src', 'i18n'), to: path.join(botRoot, 'dist', 'i18n') },
  { from: path.join(botRoot, 'src', 'db', 'migrations'), to: path.join(botRoot, 'dist', 'db', 'migrations') },
];

for (const job of copyJobs) {
  if (!existsSync(job.from)) {
    console.warn(`[copy-assets] Source directory missing, skipping: ${job.from}`);
    continue;
  }
  const assetFiles = readdirSync(job.from).filter((f) => f.endsWith('.json') || f.endsWith('.sql'));
  if (assetFiles.length === 0) {
    console.warn(`[copy-assets] No .json/.sql assets found in ${job.from}`);
  }
  mkdirSync(job.to, { recursive: true });
  cpSync(job.from, job.to, { recursive: true });
  console.log(`[copy-assets] Copied ${assetFiles.length} file(s): ${job.from} -> ${job.to}`);
}
