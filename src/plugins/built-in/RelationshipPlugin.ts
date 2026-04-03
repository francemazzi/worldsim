import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type {
  GraphStore,
  Relationship,
  RelationshipTypeDefinition,
} from "../../types/GraphTypes.js";

/* ------------------------------------------------------------------ */
/*  Relationship validation metadata                                   */
/* ------------------------------------------------------------------ */

export interface RelationshipMeta {
  status: "proposed" | "mutual" | "validated" | "broken";
  declaredBy: string[];
  socialWitnesses: string[];
  typeId: string;
  customDescription?: string | undefined;
  brokenBy?: string | undefined;
  brokenAt?: number | undefined;
  proposedAt: number;
  validatedAt?: number | undefined;
}

/* ------------------------------------------------------------------ */
/*  Default relationship types                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_TYPES: RelationshipTypeDefinition[] = [
  { id: "father", title: "Padre", description: "Relazione paterna: genitore maschio", predefined: true },
  { id: "mother", title: "Madre", description: "Relazione materna: genitore femmina", predefined: true },
  { id: "child", title: "Figlio/a", description: "Relazione filiale", predefined: true },
  { id: "sibling", title: "Fratello/Sorella", description: "Relazione fraterna", predefined: true },
  { id: "grandparent", title: "Nonno/a", description: "Relazione con un nipote", predefined: true },
  { id: "spouse", title: "Coniuge", description: "Relazione coniugale/matrimoniale", predefined: true },
  { id: "partner", title: "Partner", description: "Relazione sentimentale", predefined: true },
  { id: "friend", title: "Amico/a", description: "Relazione di amicizia", predefined: true },
  { id: "rival", title: "Rivale", description: "Relazione di rivalità o competizione", predefined: true },
  { id: "mentor", title: "Mentore", description: "Relazione di guida e insegnamento", predefined: true },
  { id: "ally", title: "Alleato/a", description: "Relazione di alleanza strategica", predefined: true },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getMeta(rel: Relationship): RelationshipMeta | undefined {
  if (!rel.metadata || !("status" in rel.metadata)) return undefined;
  return rel.metadata as unknown as RelationshipMeta;
}

function setMeta(rel: Partial<Relationship>, meta: RelationshipMeta): void {
  rel.metadata = meta as unknown as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Plugin options                                                     */
/* ------------------------------------------------------------------ */

export interface RelationshipPluginOptions {
  graphStore: GraphStore;
  customTypes?: RelationshipTypeDefinition[] | undefined;
}

/* ------------------------------------------------------------------ */
/*  RelationshipPlugin                                                 */
/* ------------------------------------------------------------------ */

export class RelationshipPlugin implements WorldSimPlugin {
  readonly name = "relationships";
  readonly version = "1.0.0";
  readonly parallel = false;
  readonly tools: AgentTool[];
  readonly typeRegistry: Map<string, RelationshipTypeDefinition>;

  constructor(options: RelationshipPluginOptions) {
    const { graphStore, customTypes } = options;

    // Build type registry: defaults + custom
    this.typeRegistry = new Map<string, RelationshipTypeDefinition>();
    for (const t of DEFAULT_TYPES) this.typeRegistry.set(t.id, t);
    if (customTypes) {
      for (const t of customTypes) this.typeRegistry.set(t.id, t);
    }

    const typeRegistry = this.typeRegistry;

    // ── Tool: declare_relationship ────────────────────────────────
    const declareRelationship: AgentTool = {
      name: "declare_relationship",
      description:
        "Dichiara una relazione con un altro agente. Puoi usare un tipo predefinito (friend, partner, father, mother, child, sibling, grandparent, spouse, rival, mentor, ally) o descriverne uno nuovo. La relazione diventa 'proposta' e deve essere confermata dall'altro agente per diventare reciproca.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Il tuo ID agente" },
          target: { type: "string", description: "ID dell'altro agente" },
          type: { type: "string", description: "Tipo di relazione (es. 'friend', 'father', 'partner')" },
          description: { type: "string", description: "Descrizione opzionale per tipi personalizzati" },
        },
        required: ["from", "target", "type"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { from, target, type, description } = input as {
          from: string;
          target: string;
          type: string;
          description?: string;
        };

        if (from === target) {
          return { errore: "Non puoi dichiarare una relazione con te stesso." };
        }

        // Register custom type if unknown
        if (!typeRegistry.has(type)) {
          typeRegistry.set(type, {
            id: type,
            title: type,
            description: description ?? `Relazione personalizzata: ${type}`,
            predefined: false,
          });
        }

        const typeDef = typeRegistry.get(type)!;

        // Check if A→B already exists
        const existing = await graphStore.getRelationship(from, target, type);
        if (existing) {
          const existingMeta = getMeta(existing);
          if (existingMeta?.status === "validated") {
            return {
              risultato: "relazione_gia_validata",
              messaggio: `La relazione '${typeDef.title}' con ${target} è già validata.`,
            };
          }
          if (existingMeta?.status === "mutual") {
            return {
              risultato: "relazione_gia_reciproca",
              messaggio: `La relazione '${typeDef.title}' con ${target} è già reciproca.`,
            };
          }
        }

        // Check if B→A exists (reverse direction)
        const reverse = await graphStore.getRelationship(target, from, type);
        const reverseMeta = reverse ? getMeta(reverse) : undefined;

        if (reverse && reverseMeta && (reverseMeta.status === "proposed" || !reverseMeta.status)) {
          // Mutual confirmation! Upgrade both directions
          const mutualMeta: RelationshipMeta = {
            status: "mutual",
            declaredBy: [...new Set([...reverseMeta.declaredBy, from])],
            socialWitnesses: reverseMeta.socialWitnesses ?? [],
            typeId: type,
            customDescription: description ?? reverseMeta.customDescription,
            proposedAt: reverseMeta.proposedAt,
          };

          // Update reverse B→A
          const reverseUpdate: Partial<Relationship> = { strength: 0.6, lastInteraction: ctx.tickCount };
          setMeta(reverseUpdate, mutualMeta);
          await graphStore.updateRelationship(target, from, type, reverseUpdate);

          // Create or update A→B
          if (existing) {
            const forwardUpdate: Partial<Relationship> = { strength: 0.6, lastInteraction: ctx.tickCount };
            setMeta(forwardUpdate, mutualMeta);
            await graphStore.updateRelationship(from, target, type, forwardUpdate);
          } else {
            const newRel: Relationship = {
              from,
              to: target,
              type,
              strength: 0.6,
              since: ctx.tickCount,
              lastInteraction: ctx.tickCount,
            };
            setMeta(newRel, mutualMeta);
            await graphStore.addRelationship(newRel);
          }

          return {
            risultato: "relazione_reciproca",
            messaggio: `${target} aveva già dichiarato questa relazione. Ora '${typeDef.title}' è reciproca!`,
            tipo: typeDef.title,
            stato: "mutual",
          };
        }

        // No reverse or reverse is already mutual/validated — just propose
        const proposedMeta: RelationshipMeta = {
          status: "proposed",
          declaredBy: [from],
          socialWitnesses: [],
          typeId: type,
          customDescription: description,
          proposedAt: ctx.tickCount,
        };

        if (existing) {
          const update: Partial<Relationship> = { strength: 0.3, lastInteraction: ctx.tickCount };
          setMeta(update, proposedMeta);
          await graphStore.updateRelationship(from, target, type, update);
        } else {
          const newRel: Relationship = {
            from,
            to: target,
            type,
            strength: 0.3,
            since: ctx.tickCount,
            lastInteraction: ctx.tickCount,
          };
          setMeta(newRel, proposedMeta);
          await graphStore.addRelationship(newRel);
        }

        return {
          risultato: "relazione_proposta",
          messaggio: `Hai dichiarato '${typeDef.title}' con ${target}. In attesa della conferma dall'altro agente.`,
          tipo: typeDef.title,
          stato: "proposed",
        };
      },
    };

    // ── Tool: witness_relationship ───────────────────────────────
    const witnessRelationship: AgentTool = {
      name: "witness_relationship",
      description:
        "Testimonia una relazione che osservi tra due agenti. Se la relazione è già reciproca, la tua testimonianza la rende 'validata' dalla comunità.",
      inputSchema: {
        type: "object",
        properties: {
          witness: { type: "string", description: "Il tuo ID agente (testimone)" },
          agent1: { type: "string", description: "ID del primo agente" },
          agent2: { type: "string", description: "ID del secondo agente" },
          type: { type: "string", description: "Tipo di relazione osservata" },
        },
        required: ["witness", "agent1", "agent2", "type"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { witness, agent1, agent2, type } = input as {
          witness: string;
          agent1: string;
          agent2: string;
          type: string;
        };

        const rel1 = await graphStore.getRelationship(agent1, agent2, type);
        const rel2 = await graphStore.getRelationship(agent2, agent1, type);
        const meta1 = rel1 ? getMeta(rel1) : undefined;
        const meta2 = rel2 ? getMeta(rel2) : undefined;

        if (!rel1 && !rel2) {
          return {
            risultato: "nessuna_relazione",
            messaggio: `Non esiste alcuna relazione '${type}' tra ${agent1} e ${agent2}.`,
          };
        }

        // Add witness to both directions if they exist
        const addWitness = async (
          from: string,
          to: string,
          rel: Relationship,
          meta: RelationshipMeta | undefined,
        ) => {
          if (!meta) return;
          const witnesses = new Set(meta.socialWitnesses ?? []);
          witnesses.add(witness);
          const isMutual = meta.status === "mutual";
          const bothMutual = meta1?.status === "mutual" && meta2?.status === "mutual";

          const updatedMeta: RelationshipMeta = {
            ...meta,
            socialWitnesses: [...witnesses],
            ...(bothMutual
              ? { status: "validated" as const, validatedAt: ctx.tickCount }
              : {}),
          };

          const update: Partial<Relationship> = {
            lastInteraction: ctx.tickCount,
            ...(bothMutual ? { strength: Math.max(rel.strength, 0.8) } : {}),
          };
          setMeta(update, updatedMeta);
          await graphStore.updateRelationship(from, to, type, update);
        };

        if (rel1 && meta1) await addWitness(agent1, agent2, rel1, meta1);
        if (rel2 && meta2) await addWitness(agent2, agent1, rel2, meta2);

        const bothMutual = meta1?.status === "mutual" && meta2?.status === "mutual";
        const typeDef = typeRegistry.get(type);

        return {
          risultato: bothMutual ? "relazione_validata" : "testimonianza_registrata",
          messaggio: bothMutual
            ? `La relazione '${typeDef?.title ?? type}' tra ${agent1} e ${agent2} è ora validata dalla comunità grazie alla tua testimonianza.`
            : `Hai testimoniato la relazione '${typeDef?.title ?? type}' tra ${agent1} e ${agent2}. La testimonianza è stata registrata.`,
          stato: bothMutual ? "validated" : (meta1?.status ?? meta2?.status ?? "proposed"),
        };
      },
    };

    // ── Tool: break_relationship ─────────────────────────────────
    const breakRelationship: AgentTool = {
      name: "break_relationship",
      description:
        "Rompi una relazione con un altro agente. Puoi rompere amicizie, alleanze, relazioni sentimentali o altre relazioni. L'altro agente non saprà immediatamente della rottura.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Il tuo ID agente" },
          target: { type: "string", description: "ID dell'altro agente" },
          type: { type: "string", description: "Tipo di relazione da rompere" },
          reason: { type: "string", description: "Motivo della rottura (opzionale)" },
        },
        required: ["from", "target", "type"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { from, target, type, reason } = input as {
          from: string;
          target: string;
          type: string;
          reason?: string;
        };

        const existing = await graphStore.getRelationship(from, target, type);
        if (!existing) {
          return {
            risultato: "nessuna_relazione",
            messaggio: `Non hai una relazione '${type}' con ${target} da rompere.`,
          };
        }

        const existingMeta = getMeta(existing);
        const brokenMeta: RelationshipMeta = {
          status: "broken",
          declaredBy: existingMeta?.declaredBy ?? [],
          socialWitnesses: existingMeta?.socialWitnesses ?? [],
          typeId: type,
          customDescription: existingMeta?.customDescription,
          proposedAt: existingMeta?.proposedAt ?? existing.since,
          brokenBy: from,
          brokenAt: ctx.tickCount,
        };

        const update: Partial<Relationship> = {
          strength: 0.1,
          lastInteraction: ctx.tickCount,
        };
        setMeta(update, brokenMeta);
        await graphStore.updateRelationship(from, target, type, update);

        const typeDef = typeRegistry.get(type);
        return {
          risultato: "relazione_interrotta",
          messaggio: `Hai interrotto la relazione '${typeDef?.title ?? type}' con ${target}.${reason ? ` Motivo: ${reason}` : ""}`,
          stato: "broken",
        };
      },
    };

    // ── Tool: check_relationship_status ──────────────────────────
    const checkRelationshipStatus: AgentTool = {
      name: "check_relationship_status",
      description:
        "Verifica lo stato di una relazione tra te e un altro agente, o tra due agenti qualsiasi. Mostra se la relazione è proposta, reciproca, validata o interrotta.",
      inputSchema: {
        type: "object",
        properties: {
          agent1: { type: "string", description: "ID del primo agente" },
          agent2: { type: "string", description: "ID del secondo agente" },
          type: { type: "string", description: "Tipo di relazione da verificare (opzionale, tutti se omesso)" },
        },
        required: ["agent1", "agent2"],
      },
      async execute(input: unknown, _ctx: WorldContext) {
        const { agent1, agent2, type } = input as {
          agent1: string;
          agent2: string;
          type?: string;
        };

        const results: Array<{
          direzione: string;
          tipo: string;
          titoloTipo: string;
          forza: number;
          stato: string;
          testimoni: string[];
        }> = [];

        const processRel = (rel: Relationship, dir: string) => {
          const meta = getMeta(rel);
          const typeDef = typeRegistry.get(rel.type);
          results.push({
            direzione: dir,
            tipo: rel.type,
            titoloTipo: typeDef?.title ?? rel.type,
            forza: rel.strength,
            stato: meta?.status ?? "automatica",
            testimoni: meta?.socialWitnesses ?? [],
          });
        };

        if (type) {
          const r1 = await graphStore.getRelationship(agent1, agent2, type);
          const r2 = await graphStore.getRelationship(agent2, agent1, type);
          if (r1) processRel(r1, `${agent1} → ${agent2}`);
          if (r2) processRel(r2, `${agent2} → ${agent1}`);
        } else {
          // Get all relationships between the two agents
          const rels1 = await graphStore.getRelationships({ agentId: agent1 });
          const rels2 = await graphStore.getRelationships({ agentId: agent2 });
          for (const r of rels1) {
            if (r.to === agent2) processRel(r, `${agent1} → ${agent2}`);
          }
          for (const r of rels2) {
            if (r.to === agent1) processRel(r, `${agent2} → ${agent1}`);
          }
        }

        if (results.length === 0) {
          return { risultato: "nessuna_relazione", messaggio: `Nessuna relazione trovata tra ${agent1} e ${agent2}.` };
        }

        return { relazioni: results };
      },
    };

    this.tools = [
      declareRelationship,
      witnessRelationship,
      breakRelationship,
      checkRelationshipStatus,
    ];
  }

  /**
   * Seeds initial relationships into the graph store.
   * Called by ScenarioLoader after bootstrap.
   */
  async seedRelationships(
    initialRelationships: Array<{ from: string; to: string; type: string }>,
    graphStore: GraphStore,
  ): Promise<void> {
    for (const { from, to, type } of initialRelationships) {
      const typeDef = this.typeRegistry.get(type);

      const meta: RelationshipMeta = {
        status: "validated",
        declaredBy: [from, to],
        socialWitnesses: [],
        typeId: type,
        proposedAt: 0,
        validatedAt: 0,
      };

      const rel: Relationship = {
        from,
        to,
        type,
        strength: 0.8,
        since: 0,
        lastInteraction: 0,
      };
      setMeta(rel, meta);
      await graphStore.addRelationship(rel);
    }
  }
}
