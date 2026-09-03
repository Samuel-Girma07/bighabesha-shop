---
type: "query"
date: "2026-08-28T16:51:17.566610+00:00"
question: "Trace handleManualRail execution path"
contributor: "graphify"
outcome: "useful"
source_nodes: ["handleManualRail()", "parseBankSms()", "submitReceipt()", "notifyAdminsNewReceipt()", "approveOrder()"]
---

# Q: Trace handleManualRail execution path

## Answer

Expanded from original query via vocab: [handle, manual, rail, payment, receipt, capture, admin, approval, sms, parser, proof, order]. handleManualRail orchestrates manual Ethiopian payment rails (Telebirr, CBE, Abyssinia) by displaying dynamic account credentials, managing user receipt upload sessions (photos, documents, or SMS forwards), parsing bank SMS receipts via parseBankSms and matchSmsToOrders, attaching receipt evidence in SQLite, notifying admins with inline approve/reject keyboards via notifyAdminsNewReceipt, and completing fulfillment via approveOrder and runFulfillmentHooks.

## Outcome

- Signal: useful

## Source Nodes

- handleManualRail()
- parseBankSms()
- submitReceipt()
- notifyAdminsNewReceipt()
- approveOrder()