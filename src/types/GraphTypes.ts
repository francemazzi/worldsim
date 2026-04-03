export interface RelationshipTypeDefinition {
  /** Unique identifier, e.g. "father", "friend", "partner" */
  id: string;
  /** Human-readable title, e.g. "Padre", "Amico", "Partner" */
  title: string;
  /** Description of the relationship meaning */
  description: string;
  /** true when the type is predefined by the scenario */
  predefined: boolean;
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  strength: number;
  metadata?: Record<string, unknown>;
  since: number;
  lastInteraction?: number;
  decayRate?: number;
  group?: string;
}

export interface GraphQuery {
  agentId: string;
  relationshipTypes?: string[];
  minStrength?: number;
  limit?: number;
}

export interface RelationshipUpsert {
  from: string;
  to: string;
  type: string;
  strengthIncrement: number;
  tick: number;
}

export interface GraphStore {
  addRelationship(rel: Relationship): Promise<void>;
  updateRelationship(
    from: string,
    to: string,
    type: string,
    updates: Partial<Relationship>,
  ): Promise<void>;
  getRelationships(query: GraphQuery): Promise<Relationship[]>;
  getRelationship(
    from: string,
    to: string,
    type: string,
  ): Promise<Relationship | null>;
  removeRelationship(from: string, to: string, type: string): Promise<void>;
  getConnectedAgents(agentId: string): Promise<string[]>;

  /**
   * Optional batch upsert: for each entry, create the relationship if it doesn't exist
   * or increment strength and update lastInteraction if it does.
   * Implementations should handle this in a single DB round-trip where possible.
   */
  upsertRelationshipBatch?(upserts: RelationshipUpsert[]): Promise<void>;

  /**
   * Optional batch remove: remove multiple relationships in a single round-trip.
   */
  removeRelationshipBatch?(
    entries: Array<{ from: string; to: string; type: string }>,
  ): Promise<void>;
}
