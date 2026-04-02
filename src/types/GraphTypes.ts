export interface Relationship {
  from: string;
  to: string;
  type: string;
  strength: number;
  metadata?: Record<string, unknown>;
  since: number;
  lastInteraction?: number;
}

export interface GraphQuery {
  agentId: string;
  relationshipTypes?: string[];
  minStrength?: number;
  limit?: number;
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
}
