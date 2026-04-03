import type {
  MemoryStore,
  MemoryEntry,
  MemoryQuery,
} from "../types/MemoryTypes.js";

/**
 * In-memory MemoryStore — no external dependencies.
 * Data lives only in the process. Use this when you don't need Redis/Postgres
 * but still want agents to remember across ticks.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private entries: MemoryEntry[] = [];

  async save(entry: MemoryEntry): Promise<void> {
    this.entries.push(entry);
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = this.entries.filter((e) => e.agentId === query.agentId);

    if (query.types && query.types.length > 0) {
      results = results.filter((e) => query.types!.includes(e.type));
    }

    if (query.since != null) {
      results = results.filter((e) => e.tick >= query.since!);
    }

    if (query.search) {
      const term = query.search.toLowerCase();
      results = results.filter((e) =>
        e.content.toLowerCase().includes(term),
      );
    }

    results.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    if (query.limit != null) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async getRecent(agentId: string, limit: number): Promise<MemoryEntry[]> {
    return this.query({ agentId, limit });
  }

  async clear(agentId: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.agentId !== agentId);
  }
}
