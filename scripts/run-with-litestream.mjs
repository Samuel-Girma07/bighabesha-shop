#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';

const LITESTREAM_VERSION = 'v0.3.13';

// Resolve database path
function getDbPath() {
  if (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim().length > 0) {
    return path.resolve(process.env.DATABASE_PATH.trim());
  }
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim().length > 0) {
    return path.resolve(process.env.DATA_DIR.trim(), 'shop.db');
  }
  return path.resolve(process.cwd(), 'data/shop.db');
}

// Check if a command is executable on PATH
function isCommandAvailable(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Download and extract binary for Linux amd64 if not already present
async function ensureLitestreamBinary() {
  if (isCommandAvailable('litestream')) {
    return 'litestream';
  }

  const localBin = path.resolve(process.cwd(), 'node_modules/.bin/litestream');
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  // Only auto-download on Linux x64 (standard for Render and Docker)
  if (process.platform === 'linux' && process.arch === 'x64') {
    console.log(`[litestream] Installing Litestream ${LITESTREAM_VERSION} for Linux x64...`);
    const tarUrl = `https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz`;
    const tmpTar = path.join(os.tmpdir(), 'litestream.tar.gz');

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmpTar);
      function get(url) {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            get(res.headers.location);
          } else if (res.statusCode === 200) {
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
          } else {
            reject(new Error(`Failed to download Litestream: HTTP ${res.statusCode}`));
          }
        }).on('error', reject);
      }
      get(tarUrl);
    });

    const targetDir = path.dirname(localBin);
    fs.mkdirSync(targetDir, { recursive: true });
    execSync(`tar -xzf "${tmpTar}" -C "${targetDir}"`, { stdio: 'inherit' });
    fs.chmodSync(localBin, 0o755);
    try { fs.unlinkSync(tmpTar); } catch {}
    console.log(`[litestream] Litestream binary installed at ${localBin}`);
    return localBin;
  }

  return 'litestream';
}

async function main() {
  const bucket = (process.env.B2_BUCKET || process.env.LITESTREAM_BUCKET)?.trim();
  const endpoint = (process.env.B2_ENDPOINT || process.env.LITESTREAM_ENDPOINT)?.trim();
  const keyId = (process.env.B2_KEY_ID || process.env.LITESTREAM_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)?.trim();
  const appKey = (process.env.B2_APPLICATION_KEY || process.env.LITESTREAM_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)?.trim();

  const targetCmd = process.argv.slice(2);
  const botCmd = targetCmd.length > 0 ? targetCmd : ['node', 'bot/dist/index.js'];

  // If Backblaze B2 credentials are NOT configured, pass through directly to Node
  if (!bucket || !endpoint || !keyId || !appKey) {
    console.log('[litestream] Backblaze B2 credentials not fully set. Starting bot with local SQLite storage.');
    const child = spawn(botCmd[0], botCmd.slice(1), { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  console.log(`[litestream] Backblaze B2 credentials detected. Preparing replication to bucket: ${bucket}`);
  const litestreamBin = await ensureLitestreamBinary();

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Clean endpoint for S3
  const cleanEndpoint = endpoint.replace(/^https?:\/\//, '');

  // Generate temporary Litestream configuration file
  const configPath = path.join(os.tmpdir(), 'litestream.yml');
  const yamlContent = `dbs:
  - path: "${dbPath.replace(/\\/g, '/')}"
    replicas:
      - type: s3
        endpoint: "${cleanEndpoint}"
        bucket: "${bucket}"
        path: db
        sync-interval: 1s
`;
  fs.writeFileSync(configPath, yamlContent, 'utf8');

  // Set environment variables for Litestream credentials
  process.env.LITESTREAM_ACCESS_KEY_ID = keyId;
  process.env.LITESTREAM_SECRET_ACCESS_KEY = appKey;

  // Restore database if file does not exist locally (e.g. fresh Render container)
  if (!fs.existsSync(dbPath)) {
    console.log(`[litestream] Local database does not exist at ${dbPath}. Checking Backblaze B2 for backup...`);
    try {
      execSync(`"${litestreamBin}" restore -if-replica-exists -config "${configPath}" "${dbPath}"`, {
        stdio: 'inherit',
        env: process.env,
      });
      console.log('[litestream] Database restore completed.');
    } catch (restoreErr) {
      console.warn('[litestream] Notice: No existing backup found or restore skipped; fresh database will be initialized.');
    }
  } else {
    console.log(`[litestream] Local database already found at ${dbPath}. Starting continuous replication.`);
  }

  // Replicate and wrap bot execution
  console.log(`[litestream] Launching Litestream replication wrapping: ${botCmd.join(' ')}`);
  const fullExec = botCmd.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ');
  const lsArgs = ['replicate', '-config', configPath, '-exec', fullExec];

  const child = spawn(litestreamBin, lsArgs, { stdio: 'inherit', env: process.env });

  // Forward signals for graceful shutdown & WAL flush
  const forwardSignal = (sig) => {
    try {
      child.kill(sig);
    } catch {}
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[litestream] Fatal error in Litestream runner:', err);
  process.exit(1);
});
