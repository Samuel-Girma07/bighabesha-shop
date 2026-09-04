# ==============================================================================
# Bighabesha Shop — Hugging Face Spaces Multi-Stage Production Dockerfile
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native compilation dependencies for better-sqlite3 and @resvg/resvg-js
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

# Copy root workspace configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json ./bot/
COPY webapp/package.json ./webapp/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY bot/ ./bot/
COPY webapp/ ./webapp/

# Build both webapp (dist) and bot (dist)
RUN pnpm -r build

# ── Production Runtime Stage ──────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install runtime sqlite3 libraries & curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    libsqlite3-0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Litestream for continuous WAL replication to Backblaze B2
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz && chmod +x /usr/local/bin/litestream

# Install pnpm
RUN npm install -g pnpm@9

ENV NODE_ENV=production
ENV PORT=7860

# Pre-create data directories with write permissions for persistent disk mounts (Render / HF Spaces / Docker)
RUN useradd -m -u 1000 appuser && \
    mkdir -p /var/data /app/data /app/bot/assets/banners && \
    chown -R appuser:appuser /var/data /app && \
    chmod 777 /var/data /app/data

COPY --chown=appuser:appuser package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=appuser:appuser bot/package.json ./bot/
COPY --chown=appuser:appuser webapp/package.json ./webapp/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy scripts and built code from builder
COPY --chown=appuser:appuser scripts/ ./scripts/
COPY --from=builder --chown=appuser:appuser /app/bot/dist ./bot/dist
COPY --from=builder --chown=appuser:appuser /app/webapp/dist ./webapp/dist

USER appuser

EXPOSE 7860

CMD ["node", "scripts/run-with-litestream.mjs", "node", "bot/dist/index.js"]
