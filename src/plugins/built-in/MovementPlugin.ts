import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { GeoLocation } from "../../types/LocationTypes.js";
import type { MovementRecord, MovementPluginOptions } from "../../types/MovementTypes.js";
import type { LocationIndex } from "../../location/LocationIndex.js";

interface PendingExternalUpdate {
  agentId: string;
  location: GeoLocation;
  timestamp: Date;
}

function buildTools(
  locationIndex: LocationIndex,
  homeLocations: Map<string, GeoLocation>,
  recordMovement: (agentId: string, from: GeoLocation | undefined, to: GeoLocation, tick: number, source: MovementRecord["source"]) => void,
  defaultRadius: number,
): AgentTool[] {
  return [
    {
      name: "get_my_location",
      description:
        "Controlla la tua posizione attuale (coordinate GPS e nome del luogo).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_input: unknown, ctx: WorldContext) {
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        const loc = locationIndex.getLocation(agentId);
        if (!loc) {
          return { errore: "La tua posizione non è disponibile." };
        }
        return {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.label ? { luogo: loc.label } : {}),
        };
      },
    },

    {
      name: "move_to_coordinates",
      description:
        "Spostati in una posizione specifica indicando le coordinate GPS. Puoi anche dare un nome al luogo.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitudine della destinazione" },
          longitude: { type: "number", description: "Longitudine della destinazione" },
          label: { type: "string", description: "Nome del luogo (opzionale, es. 'bar di Marco', 'piazza del paese')" },
        },
        required: ["latitude", "longitude"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { latitude, longitude, label } = input as {
          latitude: number;
          longitude: number;
          label?: string;
        };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          return { errore: "Coordinate non valide." };
        }

        const oldLoc = locationIndex.getLocation(agentId);
        const newLoc: GeoLocation = { latitude, longitude, label };
        locationIndex.update(agentId, newLoc);
        recordMovement(agentId, oldLoc, newLoc, ctx.tickCount, "agent_tool");

        return {
          spostato: true,
          da: oldLoc
            ? { latitude: oldLoc.latitude, longitude: oldLoc.longitude, luogo: oldLoc.label }
            : null,
          a: { latitude, longitude, ...(label ? { luogo: label } : {}) },
        };
      },
    },

    {
      name: "move_toward_agent",
      description:
        "Avvicinati a un altro agente. Puoi specificare a che distanza fermarti (in km).",
      inputSchema: {
        type: "object",
        properties: {
          targetAgentId: { type: "string", description: "ID dell'agente verso cui muoverti" },
          stopDistanceKm: {
            type: "number",
            description: "Distanza a cui fermarti (km, default: 0 = stessa posizione)",
          },
        },
        required: ["targetAgentId"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { targetAgentId, stopDistanceKm } = input as {
          targetAgentId: string;
          stopDistanceKm?: number;
        };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        const targetLoc = locationIndex.getLocation(targetAgentId);
        if (!targetLoc) {
          return { errore: `Posizione dell'agente '${targetAgentId}' non disponibile.` };
        }

        const oldLoc = locationIndex.getLocation(agentId);
        let newLoc: GeoLocation;

        const stop = stopDistanceKm ?? 0;
        if (stop > 0 && oldLoc) {
          // Interpolate: move along the line but stop at `stop` km from target
          const totalDist = haversineKm(oldLoc, targetLoc);
          if (totalDist <= stop) {
            return {
              nota: `Sei già a ${totalDist.toFixed(2)} km da ${targetAgentId}, non serve muoversi.`,
            };
          }
          const ratio = (totalDist - stop) / totalDist;
          newLoc = {
            latitude: oldLoc.latitude + (targetLoc.latitude - oldLoc.latitude) * ratio,
            longitude: oldLoc.longitude + (targetLoc.longitude - oldLoc.longitude) * ratio,
          };
        } else {
          newLoc = { latitude: targetLoc.latitude, longitude: targetLoc.longitude };
        }

        locationIndex.update(agentId, newLoc);
        recordMovement(agentId, oldLoc, newLoc, ctx.tickCount, "agent_tool");

        return {
          spostato: true,
          verso: targetAgentId,
          nuovaPosizione: { latitude: newLoc.latitude, longitude: newLoc.longitude },
        };
      },
    },

    {
      name: "move_to_home",
      description: "Torna a casa tua.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_input: unknown, ctx: WorldContext) {
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        const home = homeLocations.get(agentId);
        if (!home) {
          return { errore: "Non hai una posizione 'casa' registrata." };
        }

        const oldLoc = locationIndex.getLocation(agentId);
        const newLoc: GeoLocation = { ...home, label: home.label ?? "casa" };
        locationIndex.update(agentId, newLoc);
        recordMovement(agentId, oldLoc, newLoc, ctx.tickCount, "agent_tool");

        return {
          spostato: true,
          a: { latitude: home.latitude, longitude: home.longitude, luogo: newLoc.label },
        };
      },
    },

    {
      name: "find_nearby_agents",
      description:
        "Trova gli agenti vicini a te entro un certo raggio (in km). Utile per sapere chi c'è nelle vicinanze.",
      inputSchema: {
        type: "object",
        properties: {
          radiusKm: {
            type: "number",
            description: `Raggio di ricerca in km (default: ${defaultRadius})`,
          },
        },
        required: [],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { radiusKm } = input as { radiusKm?: number };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        const radius = radiusKm ?? defaultRadius;
        const nearby = locationIndex.findNearby(agentId, radius);

        if (nearby.length === 0) {
          return { nota: `Nessun agente trovato nel raggio di ${radius} km.`, agenti: [] };
        }

        return {
          raggio: radius,
          agenti: nearby.map((n) => ({
            agentId: n.agentId,
            distanzaKm: Math.round(n.distance * 100) / 100,
          })),
        };
      },
    },
  ];
}

/** Haversine distance in km between two GeoLocations. */
function haversineKm(a: GeoLocation, b: GeoLocation): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export class MovementPlugin implements WorldSimPlugin {
  readonly name = "movement";
  readonly version = "1.0.0";
  readonly parallel = true;

  private _tools: AgentTool[];
  private locationIndex: LocationIndex;
  private history: Map<string, MovementRecord[]> = new Map();
  private maxHistory: number;
  private homeLocations: Map<string, GeoLocation> = new Map();
  private pendingExternalUpdates: PendingExternalUpdate[] = [];

  constructor(locationIndex: LocationIndex, options?: MovementPluginOptions) {
    this.locationIndex = locationIndex;
    this.maxHistory = options?.maxHistoryPerAgent ?? 50;
    const defaultRadius = options?.defaultNearbyRadiusKm ?? 5;

    this._tools = buildTools(
      this.locationIndex,
      this.homeLocations,
      this.recordMovement.bind(this),
      defaultRadius,
    );
  }

  get tools(): AgentTool[] {
    return this._tools;
  }

  // ── External API ───────────────────────────────────────────────────

  /**
   * Push a real GPS position for an agent (e.g. from a mobile device).
   * Updates the LocationIndex immediately and queues an event for the next tick.
   */
  updateRealPosition(agentId: string, latitude: number, longitude: number, label?: string): void {
    const location: GeoLocation = { latitude, longitude, label };
    const oldLoc = this.locationIndex.getLocation(agentId);
    this.locationIndex.update(agentId, location);
    this.recordMovement(agentId, oldLoc, location, -1, "external_gps");
    this.pendingExternalUpdates.push({ agentId, location, timestamp: new Date() });
  }

  /**
   * Register a home location for an agent.
   * Call this during setup or bootstrap so `move_to_home` knows where to go.
   */
  registerHome(agentId: string, home: GeoLocation): void {
    this.homeLocations.set(agentId, home);
  }

  /** Read-only access to an agent's movement history. */
  getMovementHistory(agentId: string): readonly MovementRecord[] {
    return this.history.get(agentId) ?? [];
  }

  /** Get all pending GPS updates that haven't been processed in a tick yet. */
  getPendingExternalUpdates(): readonly PendingExternalUpdate[] {
    return this.pendingExternalUpdates;
  }

  // ── Hooks ──────────────────────────────────────────────────────────

  async onWorldTick(tick: number, _ctx: WorldContext): Promise<void> {
    // Patch tick number on external GPS records that were queued between ticks
    for (const update of this.pendingExternalUpdates) {
      const agentHistory = this.history.get(update.agentId);
      if (agentHistory) {
        const last = agentHistory[agentHistory.length - 1];
        if (last && last.tick === -1) last.tick = tick;
      }
    }
    this.pendingExternalUpdates = [];
  }

  // ── Internal ───────────────────────────────────────────────────────

  private recordMovement(
    agentId: string,
    from: GeoLocation | undefined,
    to: GeoLocation,
    tick: number,
    source: MovementRecord["source"],
  ): void {
    let records = this.history.get(agentId);
    if (!records) {
      records = [];
      this.history.set(agentId, records);
    }
    records.push({ agentId, from, to, tick, source, timestamp: new Date() });
    // Ring buffer: drop oldest if over limit
    if (records.length > this.maxHistory) {
      records.splice(0, records.length - this.maxHistory);
    }
  }
}
