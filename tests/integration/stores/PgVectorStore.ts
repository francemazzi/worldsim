import pg from "pg";
import type {
  VectorStore,
  VectorEntry,
  VectorQuery,
  VectorSearchResult,
  EmbeddingAdapter,
} from "../../../src/types/VectorTypes.js";

/**
 * PostgreSQL + pgvector implementation of VectorStore.
 * Requires the `vector` extension to be enabled in the database.
 *
 * Uses a dedicated `vector_entries` table with a `embedding vector(N)` column
 * and the `<=>` cosine distance operator for similarity search.
 */
export class PgVectorStore implements VectorStore {
  private pool: pg.Pool;
  private dimensions: number;
  private embeddingAdapter?: EmbeddingAdapter | undefined;

  constructor(options: {
    connectionString?: string;
    dimensions?: number;
    embeddingAdapter?: EmbeddingAdapter;
  } = {}) {
    this.pool = new pg.Pool({
      connectionString:
        options.connectionString ??
        "postgresql://postgres:testpassword@localhost:5432/worldsim_test",
    });
    this.dimensions = options.dimensions ?? 1536;
    this.embeddingAdapter = options.embeddingAdapter;
  }

  async createTable(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS vector_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(${this.dimensions}) NOT NULL,
        metadata JSONB,
        timestamp TIMESTAMPTZ NOT NULL,
        memory_entry_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_vector_agent
        ON vector_entries (agent_id);
    `);
  }

  async upsert(entry: VectorEntry): Promise<void> {
    const embStr = `[${entry.embedding.join(",")}]`;
    await this.pool.query(
      `INSERT INTO vector_entries (id, agent_id, content, embedding, metadata, timestamp, memory_entry_id)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata,
         timestamp = EXCLUDED.timestamp`,
      [
        entry.id,
        entry.agentId,
        entry.content,
        embStr,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.timestamp,
        entry.memoryEntryId ?? null,
      ],
    );
  }

  async upsertBatch(entries: VectorEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of entries) {
        const embStr = `[${entry.embedding.join(",")}]`;
        await client.query(
          `INSERT INTO vector_entries (id, agent_id, content, embedding, metadata, timestamp, memory_entry_id)
           VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata,
             timestamp = EXCLUDED.timestamp`,
          [
            entry.id,
            entry.agentId,
            entry.content,
            embStr,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.timestamp,
            entry.memoryEntryId ?? null,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async search(query: VectorQuery): Promise<VectorSearchResult[]> {
    let embedding = query.embedding;

    if (!embedding && query.text && this.embeddingAdapter) {
      embedding = await this.embeddingAdapter.embed(query.text);
    }

    if (!embedding) return [];

    const topK = query.topK ?? 10;
    const minScore = query.minScore ?? 0;
    const embStr = `[${embedding.join(",")}]`;

    const result = await this.pool.query(
      `SELECT id, agent_id, content, metadata, timestamp, memory_entry_id,
              1 - (embedding <=> $1::vector) AS score
       FROM vector_entries
       WHERE agent_id = $2
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [embStr, query.agentId, minScore, topK],
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      entry: {
        id: row["id"] as string,
        agentId: row["agent_id"] as string,
        content: row["content"] as string,
        embedding: [], // don't return full embedding from search
        metadata: (row["metadata"] as Record<string, unknown>) ?? undefined,
        timestamp: new Date(row["timestamp"] as string),
        memoryEntryId: (row["memory_entry_id"] as string) ?? undefined,
      },
      score: parseFloat(row["score"] as string),
    }));
  }

  async delete(agentId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
    await this.pool.query(
      `DELETE FROM vector_entries WHERE agent_id = $1 AND id IN (${placeholders})`,
      [agentId, ...ids],
    );
  }

  async clear(agentId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM vector_entries WHERE agent_id = $1",
      [agentId],
    );
  }

  async dropTable(): Promise<void> {
    await this.pool.query("DROP TABLE IF EXISTS vector_entries CASCADE");
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
