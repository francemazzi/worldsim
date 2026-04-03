import Redis from "ioredis";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryQuery,
} from "../types/MemoryTypes.js";

const PREFIX = "worldsim:memory:";

export class RedisMemoryStore implements MemoryStore {
  private redis: Redis;

  constructor(redisUrl = "redis://localhost:6379") {
    this.redis = new Redis(redisUrl);
  }

  private agentKey(agentId: string): string {
    return `${PREFIX}${agentId}`;
  }

  async save(entry: MemoryEntry): Promise<void> {
    const serialized = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    });
    const score = entry.timestamp.getTime();
    await this.redis.zadd(this.agentKey(entry.agentId), score, serialized);
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const entry of entries) {
      const serialized = JSON.stringify({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      });
      const score = entry.timestamp.getTime();
      pipeline.zadd(this.agentKey(entry.agentId), score, serialized);
    }
    await pipeline.exec();
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const raw = await this.redis.zrevrange(
      this.agentKey(query.agentId),
      0,
      -1,
    );

    let entries: MemoryEntry[] = raw.map((s) => {
      const parsed = JSON.parse(s) as MemoryEntry & { timestamp: string };
      return { ...parsed, timestamp: new Date(parsed.timestamp) };
    });

    if (query.types && query.types.length > 0) {
      entries = entries.filter((e) => query.types!.includes(e.type));
    }

    if (query.since != null) {
      entries = entries.filter((e) => e.tick >= query.since!);
    }

    if (query.search) {
      const term = query.search.toLowerCase();
      entries = entries.filter((e) =>
        e.content.toLowerCase().includes(term),
      );
    }

    if (query.limit != null) {
      entries = entries.slice(0, query.limit);
    }

    return entries;
  }

  async getRecent(agentId: string, limit: number): Promise<MemoryEntry[]> {
    return this.query({ agentId, limit });
  }

  async clear(agentId: string): Promise<void> {
    await this.redis.del(this.agentKey(agentId));
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
