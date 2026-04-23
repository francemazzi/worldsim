/**
 * Public type surface for the multi-world federation.
 *
 * Phase 0 establishes the type vocabulary only. Concrete implementations
 * (transport, directory, travel map) are introduced in later phases.
 */

export type FederatedAgentId = `${string}:${string}`;

export type WorldCapability = "messaging" | "calls" | "travel";

export interface WorldNode {
  worldId: string;
  displayName: string;
  coordinates?: { lat: number; lng: number };
  capabilities: WorldCapability[];
  endpoint?: string;
}

export type CrossWorldChannel =
  | "sms"
  | "email"
  | "call_request"
  | "call_turn"
  | "system";

export interface CrossWorldEnvelope<T = unknown> {
  id: string;
  fromWorldId: string;
  toWorldId: string;
  fromAgentId: string;
  toAgentId: string | "*";
  channel: CrossWorldChannel;
  payload: T;
  sentAtTick: number;
  sentAtRealTime: string;
  correlationId?: string;
}

export type Unsubscribe = () => void | Promise<void>;

/**
 * Forward declarations of subsystems implemented in later phases.
 * Phase 1 implements `FederationTransport`; Phase 2 the directory;
 * Phase 4 the travel map. They are referenced here to lock the shape
 * of `FederationConfig`.
 */

export interface FederationTransport {
  publish(envelope: CrossWorldEnvelope): Promise<void>;
  subscribe(
    worldId: string,
    handler: (envelope: CrossWorldEnvelope) => Promise<void>,
  ): Promise<Unsubscribe>;
  registerNode(node: WorldNode): Promise<void>;
  unregisterNode(worldId: string): Promise<void>;
  listNodes(): Promise<WorldNode[]>;
}

export interface FederatedAgentDirectoryEntry {
  federatedId: FederatedAgentId;
  worldId: string;
  agentId: string;
  displayName: string;
  tags: string[];
  publicProfile: Record<string, unknown>;
  status: "active" | "traveling" | "stopped";
  lastSeenAt: string;
}

export interface FederatedAgentDirectoryQuery {
  worldId?: string;
  tags?: string[];
  nameQuery?: string;
  limit?: number;
}

export interface FederatedAgentDirectory {
  registerAgent(entry: FederatedAgentDirectoryEntry): Promise<void>;
  unregisterAgent(federatedId: FederatedAgentId): Promise<void>;
  unregisterAgentsByWorld(worldId: string): Promise<void>;
  lookup(
    query: FederatedAgentDirectoryQuery,
  ): Promise<FederatedAgentDirectoryEntry[]>;
  getAgent(
    federatedId: FederatedAgentId,
  ): Promise<FederatedAgentDirectoryEntry | null>;
}

export type TravelMode = "car" | "train" | "plane" | "walk";

export interface TravelOption {
  kind: TravelMode;
  estimatedTicks: number;
  energyCost: number;
}

export interface TravelEdge {
  fromWorldId: string;
  toWorldId: string;
  modes: TravelOption[];
}

export interface TravelMap {
  addEdge(edge: TravelEdge): void;
  getModes(fromWorldId: string, toWorldId: string): TravelOption[];
}

export interface FederationConfig {
  worldNode: WorldNode;
  transport: FederationTransport;
  directory?: FederatedAgentDirectory;
  travelMap?: TravelMap;
}
