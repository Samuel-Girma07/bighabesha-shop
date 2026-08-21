# Changelog

All notable changes to the **Bighabesha Shop** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - Phase 1 (2026-08-21)
### Added
- Catalog models (`products`, `variants`, `stock_items`) supporting stock and order fulfillment types.
- Seed data for Gemini Pro 18m, Telegram Premium (3/6/12m), and Telegram Stars packages & custom bounds.
- Interactive inline shop browser with category navigation, pricing displays, and stock badges.
- Variant pickers and custom stars validator with range checking ($10 - 100,000$).
- Stock management service supporting single link paste and CSV file/text upload.
- Low-stock alert service ($\le 5$ items & sold-out notifications) dispatching to all admins with one-tap action buttons.
- Admin in-chat control panel for editing variant prices, restocking links, updating exchange rates, and editing bank accounts.
- Comprehensive Phase 1 test suite covering seeding idempotency, stock decrement/sold-out, CSV parsing, and rate/setting editing.

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
