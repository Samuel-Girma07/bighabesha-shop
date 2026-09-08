import { IBankReceiptVerifier, ExtractedReceiptReference } from '../types.js';

export interface IBankAdapterRegistry {
  /**
   * Registers a bank receipt verification adapter.
   */
  register(adapter: IBankReceiptVerifier): void;

  /**
   * Resolves the appropriate adapter capable of verifying the given reference.
   */
  findAdapter(reference: ExtractedReceiptReference): IBankReceiptVerifier | undefined;

  /**
   * Returns a snapshot of all registered adapters.
   */
  getAll(): readonly IBankReceiptVerifier[];
}

/**
 * Registry maintaining extensible bank adapters conforming to the Open/Closed Principle.
 */
export class BankAdapterRegistry implements IBankAdapterRegistry {
  private readonly adapters: IBankReceiptVerifier[] = [];

  constructor(initialAdapters: IBankReceiptVerifier[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  public register(adapter: IBankReceiptVerifier): void {
    if (!adapter) return;
    // Prevent duplicate instances for same rail unless intended
    const existingIndex = this.adapters.findIndex((a) => a === adapter);
    if (existingIndex === -1) {
      this.adapters.push(adapter);
    }
  }

  public findAdapter(reference: ExtractedReceiptReference): IBankReceiptVerifier | undefined {
    return this.adapters.find((adapter) => adapter.canHandle(reference));
  }

  public getAll(): readonly IBankReceiptVerifier[] {
    return Object.freeze([...this.adapters]);
  }
}
