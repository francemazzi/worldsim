import neo4j, { type Driver } from "neo4j-driver";
import type {
  GraphStore,
  Relationship,
  GraphQuery,
} from "../../../src/types/GraphTypes.js";

export class Neo4jGraphStore implements GraphStore {
  private driver: Driver;

  constructor(
    uri = "bolt://localhost:7687",
    user = "neo4j",
    password = "testpassword",
  ) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async addRelationship(rel: Relationship): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (a:Agent {id: $from})
        MERGE (b:Agent {id: $to})
        CREATE (a)-[r:RELATES {type: $type, strength: $strength, since: $since, lastInteraction: $lastInteraction, metadata: $metadata}]->(b)
        `,
        {
          from: rel.from,
          to: rel.to,
          type: rel.type,
          strength: rel.strength,
          since: neo4j.int(rel.since),
          lastInteraction: rel.lastInteraction != null
            ? neo4j.int(rel.lastInteraction)
            : null,
          metadata: JSON.stringify(rel.metadata ?? {}),
        },
      );
    } finally {
      await session.close();
    }
  }

  async updateRelationship(
    from: string,
    to: string,
    type: string,
    updates: Partial<Relationship>,
  ): Promise<void> {
    const session = this.driver.session();
    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { from, to, type };

      if (updates.strength != null) {
        setClauses.push("r.strength = $strength");
        params.strength = updates.strength;
      }
      if (updates.lastInteraction != null) {
        setClauses.push("r.lastInteraction = $lastInteraction");
        params.lastInteraction = neo4j.int(updates.lastInteraction);
      }
      if (updates.metadata) {
        setClauses.push("r.metadata = $metadata");
        params.metadata = JSON.stringify(updates.metadata);
      }

      if (setClauses.length === 0) return;

      await session.run(
        `
        MATCH (a:Agent {id: $from})-[r:RELATES {type: $type}]->(b:Agent {id: $to})
        SET ${setClauses.join(", ")}
        `,
        params,
      );
    } finally {
      await session.close();
    }
  }

  async getRelationships(query: GraphQuery): Promise<Relationship[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (a:Agent {id: $agentId})-[r:RELATES]->(b:Agent)
        RETURN r, a.id AS fromId, b.id AS toId
        UNION
        MATCH (a:Agent)-[r:RELATES]->(b:Agent {id: $agentId})
        RETURN r, a.id AS fromId, b.id AS toId
        `,
        { agentId: query.agentId },
      );

      let rels: Relationship[] = result.records.map((record) => {
        const r = record.get("r").properties;
        return {
          from: record.get("fromId") as string,
          to: record.get("toId") as string,
          type: r.type as string,
          strength: r.strength as number,
          since: typeof r.since === "object" && "toNumber" in r.since
            ? (r.since as { toNumber(): number }).toNumber()
            : (r.since as number),
          lastInteraction:
            r.lastInteraction != null
              ? typeof r.lastInteraction === "object" && "toNumber" in r.lastInteraction
                ? (r.lastInteraction as { toNumber(): number }).toNumber()
                : (r.lastInteraction as number)
              : undefined,
          metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
        };
      });

      if (query.relationshipTypes && query.relationshipTypes.length > 0) {
        rels = rels.filter((r) =>
          query.relationshipTypes!.includes(r.type),
        );
      }

      if (query.minStrength != null) {
        rels = rels.filter((r) => r.strength >= query.minStrength!);
      }

      if (query.limit != null) {
        rels = rels.slice(0, query.limit);
      }

      return rels;
    } finally {
      await session.close();
    }
  }

  async getRelationship(
    from: string,
    to: string,
    type: string,
  ): Promise<Relationship | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (a:Agent {id: $from})-[r:RELATES {type: $type}]->(b:Agent {id: $to})
        RETURN r, a.id AS fromId, b.id AS toId
        LIMIT 1
        `,
        { from, to, type },
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      const r = record.get("r").properties;
      return {
        from: record.get("fromId") as string,
        to: record.get("toId") as string,
        type: r.type as string,
        strength: r.strength as number,
        since: typeof r.since === "object" && "toNumber" in r.since
          ? (r.since as { toNumber(): number }).toNumber()
          : (r.since as number),
        lastInteraction:
          r.lastInteraction != null
            ? typeof r.lastInteraction === "object" && "toNumber" in r.lastInteraction
              ? (r.lastInteraction as { toNumber(): number }).toNumber()
              : (r.lastInteraction as number)
            : undefined,
        metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
      };
    } finally {
      await session.close();
    }
  }

  async removeRelationship(
    from: string,
    to: string,
    type: string,
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (a:Agent {id: $from})-[r:RELATES {type: $type}]->(b:Agent {id: $to})
        DELETE r
        `,
        { from, to, type },
      );
    } finally {
      await session.close();
    }
  }

  async getConnectedAgents(agentId: string): Promise<string[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (a:Agent {id: $agentId})-[:RELATES]-(b:Agent)
        RETURN DISTINCT b.id AS connectedId
        `,
        { agentId },
      );
      return result.records.map((r) => r.get("connectedId") as string);
    } finally {
      await session.close();
    }
  }

  async clearAll(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run("MATCH (n) DETACH DELETE n");
    } finally {
      await session.close();
    }
  }

  async disconnect(): Promise<void> {
    await this.driver.close();
  }
}
