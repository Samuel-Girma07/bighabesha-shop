/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Main Facade & Dependency Injection Entrypoint
 */

import { ReceiptIngestionService } from './ingestion.service.js';
import { CbeBankAdapter } from './adapters/cbe.adapter.js';
import { TelebirrAdapter } from './adapters/telebirr.adapter.js';
import { BankAdapterRegistry } from './adapters/registry.js';
import { SecurityGateService } from './security_gate.service.js';
import { ReceiptOrchestrator } from './orchestrator.service.js';

export * from './types.js';
export * from './constants.js';
export * from './circuit_breaker.js';
export * from './ingestion.service.js';
export * from './adapters/base.adapter.js';
export * from './adapters/registry.js';
export * from './adapters/cbe.adapter.js';
export * from './adapters/telebirr.adapter.js';
export * from './security_gate.service.js';
export * from './orchestrator.service.js';

let defaultOrchestrator: ReceiptOrchestrator | undefined;

export function getReceiptOrchestrator(): ReceiptOrchestrator {
  if (!defaultOrchestrator) {
    const ingestion = new ReceiptIngestionService();
    const registry = new BankAdapterRegistry([new CbeBankAdapter(), new TelebirrAdapter()]);
    const gate = new SecurityGateService();
    defaultOrchestrator = new ReceiptOrchestrator(ingestion, registry, gate);
  }
  return defaultOrchestrator;
}

export function setReceiptOrchestratorForTest(orchestrator?: ReceiptOrchestrator): void {
  defaultOrchestrator = orchestrator;
}
