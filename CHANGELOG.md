# Changelog

All notable changes to the **Bighabesha Shop** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - Phase 0 (2026-08-21)
### Added
- Monorepo structure with `pnpm` workspaces (`bot/`, `webapp/`, `deploy/`, `docs/`).
- Verbatim `docs/SPEC.md` specification and architecture guidelines.
- Environment validation with `zod` and `.env.example`.
- `better-sqlite3` database initialization and migration runner.
- Initial database schema migration (`001_init.sql`).
- Fast and structured `pino` logger.
- i18n localization module with English dictionary (`en.json`).
- Grammy bot instance with `/start`, `/health`, and `/ping` commands.
- Comprehensive test suite covering env validation, database migrations, i18n, and bot command handlers.
