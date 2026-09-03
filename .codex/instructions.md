# Workspace Instructions (Codex CLI & AI Agents)

<!-- GRAPHIFY_START -->
## Knowledge Graph & Architecture Index (Graphify)

This repository contains a pre-computed architectural knowledge graph and wiki in graphify-out/.

### Mandatory Navigation Workflow:
1. **Targeted Subgraph Queries**:
   - Before executing wide grep/find operations, run:
     `ash
     graphify query "<question>"
     `
   - For tracing end-to-end execution chains or multi-hop data flows:
     `ash
     graphify query "<question>" --dfs
     `
2. **Concept & Abstraction Deep-Dives**:
   - Shortest path between two modules:
     `ash
     graphify path "<ModuleA>" "<ModuleB>"
     `
   - Deep explanation of a specific symbol/node:
     `ash
     graphify explain "<SymbolOrNode>"
     `
3. **Domain Wiki Navigation**:
   - Read graphify-out/wiki/index.md and domain articles in graphify-out/wiki/ to understand component boundaries, invariants, and constraints.
4. **Architectural God Nodes**:
   - Consult graphify-out/GRAPH_REPORT.md for central system hubs (getDatabase(), createBot(), getConfig(), createExpressApp()).
5. **AST Synchronization After Edits**:
   - After modifying or creating files, execute:
     `ash
     graphify update .
     `
     to maintain graph parity with zero API token cost.
<!-- GRAPHIFY_END -->