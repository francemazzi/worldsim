import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { AssetStore, Venue } from "../../types/AssetTypes.js";

export interface AssetPluginOptions {
  assetStore: AssetStore;
}

function conditionLabel(c: number | undefined): string {
  if (c == null) return "";
  if (c > 0.8) return "ottima";
  if (c > 0.6) return "buona";
  if (c > 0.4) return "discreta";
  if (c > 0.2) return "scarsa";
  return "pessima";
}

function buildTools(store: AssetStore): AgentTool[] {
  return [
    {
      name: "check_my_assets",
      description:
        "Controlla le tue proprietà, risorse, veicoli e oggetti. Include anche i beni della tua famiglia e le risorse della comunità.",
      inputSchema: {
        type: "object",
        properties: {
          includeFamily: {
            type: "boolean",
            description: "Includere i beni della famiglia (default: true)",
          },
          includeCommunity: {
            type: "boolean",
            description: "Includere le risorse della comunità (default: false)",
          },
        },
        required: [],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { includeFamily, includeCommunity } = input as {
          includeFamily?: boolean;
          includeCommunity?: boolean;
        };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        const personal = await store.getAgentAssets(agentId);

        let familyAssets: { household: string; assets: typeof personal } | undefined;
        if (includeFamily !== false) {
          const household = await store.getAgentHousehold(agentId);
          if (household) {
            const hAssets = await store.getHouseholdAssets(household.id);
            familyAssets = { household: household.name, assets: hAssets };
          }
        }

        let community: typeof personal | undefined;
        if (includeCommunity) {
          community = await store.getCommunityAssets();
        }

        return {
          proprietàPersonali: personal.map((a) => ({
            nome: a.name,
            tipo: a.type,
            ...(a.quantity != null ? { quantità: a.quantity } : {}),
            ...(a.value != null ? { valore: `€${a.value.toLocaleString()}` } : {}),
            ...(a.condition != null ? { condizione: conditionLabel(a.condition) } : {}),
            ...(a.description ? { descrizione: a.description } : {}),
          })),
          ...(familyAssets ? {
            famiglia: {
              nome: familyAssets.household,
              beni: familyAssets.assets.map((a) => ({
                nome: a.name,
                tipo: a.type,
                ...(a.value != null ? { valore: `€${a.value.toLocaleString()}` } : {}),
              })),
            },
          } : {}),
          ...(community ? {
            comunitarie: community.map((a) => ({
              nome: a.name,
              tipo: a.type,
              ...(a.condition != null ? { condizione: conditionLabel(a.condition) } : {}),
            })),
          } : {}),
        };
      },
    },

    {
      name: "check_venues",
      description:
        "Vedi i luoghi disponibili nella zona: bar, negozi, uffici, parchi, chiese, palestre. Puoi filtrare per tipo.",
      inputSchema: {
        type: "object",
        properties: {
          venueType: {
            type: "string",
            enum: ["bar", "restaurant", "office", "shop", "gym", "park", "church", "school", "home", "event_space"],
            description: "Tipo di luogo (opzionale, senza filtro mostra tutti)",
          },
        },
        required: [],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { venueType } = input as { venueType?: string };
        const venues = await store.getVenues(
          venueType ? { venueType: venueType as Venue["venueType"] } : undefined,
        );

        return {
          luoghi: venues.map((v) => ({
            id: v.id,
            nome: v.name,
            tipo: v.venueType,
            proprietario: v.owner,
            ...(v.capacity ? { capienza: v.capacity } : {}),
            ...(v.openHours ? { orario: v.openHours } : {}),
            presenti: v.currentVisitors?.length ?? 0,
          })),
        };
      },
    },

    {
      name: "go_to_venue",
      description:
        "Vai in un luogo (bar, negozio, ufficio, parco, etc.). Vedrai chi è già presente e potrai interagire con loro.",
      inputSchema: {
        type: "object",
        properties: {
          venueId: { type: "string", description: "ID del luogo dove andare" },
        },
        required: ["venueId"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { venueId } = input as { venueId: string };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";

        const venue = await store.getAsset(venueId);
        if (!venue || venue.type !== "venue") {
          return { errore: `Luogo '${venueId}' non trovato.` };
        }
        const v = venue as Venue;

        // Check capacity
        const visitors = v.currentVisitors ?? [];
        if (v.capacity && visitors.length >= v.capacity) {
          return { errore: `${v.name} è pieno (capienza: ${v.capacity}).` };
        }

        // Leave current venue first
        await store.leaveAllVenues(agentId);
        // Enter new venue
        await store.enterVenue(venueId, agentId);

        const updatedVisitors = await store.getVenueVisitors(venueId);
        const others = updatedVisitors.filter((id) => id !== agentId);

        return {
          arrivatoA: v.name,
          tipo: v.venueType,
          personePresenti: others.length > 0 ? others : "nessuno",
          nota: others.length > 0
            ? `Sei arrivato a ${v.name}. Ci sono ${others.length} persone qui.`
            : `Sei arrivato a ${v.name}. Il posto è vuoto al momento.`,
        };
      },
    },

    {
      name: "leave_venue",
      description: "Esci dal luogo in cui ti trovi attualmente.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_input: unknown, ctx: WorldContext) {
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        const currentVenue = await store.getAgentCurrentVenue(agentId);

        if (!currentVenue) {
          return { nota: "Non sei in nessun luogo particolare." };
        }

        await store.leaveAllVenues(agentId);
        return { uscitoDa: currentVenue.name, nota: `Hai lasciato ${currentVenue.name}.` };
      },
    },

    {
      name: "who_is_here",
      description:
        "Guarda chi è presente nel luogo in cui ti trovi. Utile per sapere con chi puoi interagire.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_input: unknown, ctx: WorldContext) {
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        const currentVenue = await store.getAgentCurrentVenue(agentId);

        if (!currentVenue) {
          return { nota: "Non sei in nessun luogo particolare. Usa 'go_to_venue' per andare da qualche parte." };
        }

        const visitors = await store.getVenueVisitors(currentVenue.id);
        const others = visitors.filter((id) => id !== agentId);

        return {
          luogo: currentVenue.name,
          tipo: currentVenue.venueType,
          personePresenti: others.length > 0 ? others : "nessuno",
          totale: others.length,
        };
      },
    },

    {
      name: "use_resource",
      description:
        "Usa/consuma una risorsa che possiedi (es. acqua dal pozzo, soldi, carburante). Specifica la quantità.",
      inputSchema: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "ID della risorsa da usare" },
          amount: { type: "number", description: "Quantità da consumare" },
        },
        required: ["assetId", "amount"],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { assetId, amount } = input as { assetId: string; amount: number };

        const asset = await store.getAsset(assetId);
        if (!asset) return { errore: `Risorsa '${assetId}' non trovata.` };
        if (asset.quantity == null) return { errore: `'${asset.name}' non è una risorsa consumabile.` };

        if (asset.quantity < amount) {
          return {
            errore: `Non hai abbastanza ${asset.name}. Disponibile: ${asset.quantity}, richiesto: ${amount}.`,
          };
        }

        const result = await store.consumeResource(assetId, amount);
        return {
          risorsa: asset.name,
          consumato: amount,
          rimanente: result.remaining,
          nota: result.remaining < 20
            ? `Attenzione: ${asset.name} sta finendo! Rimane solo ${result.remaining}.`
            : `Hai usato ${amount} di ${asset.name}. Ne rimangono ${result.remaining}.`,
        };
      },
    },
  ];
}

export class AssetPlugin implements WorldSimPlugin {
  readonly name = "assets";
  readonly version = "1.0.0";
  readonly parallel = true;

  private _tools: AgentTool[];

  constructor(options: AssetPluginOptions) {
    this._tools = buildTools(options.assetStore);
  }

  get tools(): AgentTool[] {
    return this._tools;
  }
}
