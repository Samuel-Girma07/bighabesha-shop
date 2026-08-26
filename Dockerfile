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

# Install runtime sqlite3 libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    libsqlite3-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

ENV NODE_ENV=production
ENV PORT=7860

# Hugging Face Spaces runs as user 1000 by default
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/data /app/bot/assets/banners && \
    chown -R appuser:appuser /app

COPY --chown=appuser:appuser package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=appuser:appuser bot/package.json ./bot/
COPY --chown=appuser:appuser webapp/package.json ./webapp/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built code from builder
COPY --from=builder --chown=appuser:appuser /app/bot/dist ./bot/dist
COPY --from=builder --chown=appuser:appuser /app/webapp/dist ./webapp/dist

USER appuser

EXPOSE 7860

CMD ["node", "bot/dist/index.js"]
