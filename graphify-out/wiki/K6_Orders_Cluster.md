# K6 Orders Cluster

> 5 nodes · cohesion 0.40

## Key Concepts

- **k6-orders.js** (4 connections) — `deploy/loadtest/k6-orders.js`
- **adminPoll()** (1 connections) — `deploy/loadtest/k6-orders.js`
- **createOrder()** (1 connections) — `deploy/loadtest/k6-orders.js`
- **options** (1 connections) — `deploy/loadtest/k6-orders.js`
- **NOTE: order-create bursts intentionally exceed the 10/min/IP checkout** (1 connections) — `deploy/loadtest/k6-orders.js`

## Relationships

- No strong cross-community connections detected

## Source Files

- `deploy/loadtest/k6-orders.js`

## Audit Trail

- EXTRACTED: 4 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*