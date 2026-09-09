# ==============================================================================
# Bighabesha Shop — Multi-Stage Production Dockerfile
# Ethiopian Bank Receipt Verification Engine & Bot Platform
# ==============================================================================

# ── 1. Builder Stage ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native compilation dependencies for better-sqlite3 and sharp / @resvg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

# Copy root workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json ./bot/
COPY webapp/package.json ./webapp/

# Install full dependencies (including devDependencies required for tsc & vite)
RUN pnpm install --frozen-lockfile

# Copy workspace source code
COPY bot/ ./bot/
COPY webapp/ ./webapp/

# Build both bot and webapp distributions
RUN pnpm -r build

# ── 2. Production Runtime Stage ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install runtime sqlite3 libraries, ca-certificates, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    libsqlite3-0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Litestream for continuous WAL replication to cloud S3 / Backblaze B2
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && \
    rm /tmp/litestream.tar.gz && \
    chmod +x /usr/local/bin/litestream

# Install pnpm for production package management
RUN npm install -g pnpm@9

ENV NODE_ENV=production
ENV PORT=3000

# Pre-create data directories with appropriate permissions for the non-root 'node' user
RUN mkdir -p /var/data /app/data /app/data/receipts /app/bot/assets/banners && \
    chown -R node:node /var/data /app && \
    chmod -R 775 /var/data /app/data

# Copy workspace manifests
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node bot/package.json ./bot/
COPY --chown=node:node webapp/package.json ./webapp/

# Install production dependencies only with frozen lockfile
RUN pnpm install --prod --frozen-lockfile

# Copy scripts and compiled artifacts from builder stage
COPY --chown=node:node scripts/ ./scripts/
COPY --from=builder --chown=node:node /app/bot/dist ./bot/dist
COPY --from=builder --chown=node:node /app/webapp/dist ./webapp/dist

# Switch to non-root user 'node'
USER node

# Container healthcheck testing /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

# Start via Litestream supervisor (replicates SQLite WAL if B2 configured, passes through to node bot/dist/index.js)
CMD ["node", "scripts/run-with-litestream.mjs", "node", "bot/dist/index.js"]
