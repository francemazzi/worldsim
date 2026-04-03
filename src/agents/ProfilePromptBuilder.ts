import type { AgentProfile, AgentInternalState } from "../types/AgentTypes.js";
import type { MemoryEntry } from "../types/MemoryTypes.js";
import type { Relationship, RelationshipTypeDefinition } from "../types/GraphTypes.js";
import type { ConsolidatedKnowledge } from "../types/PersistenceTypes.js";
import type { LocationConfig } from "../types/LocationTypes.js";

export function buildProfilePrompt(profile: AgentProfile): string {
  const sections: string[] = [];
  sections.push(`Nome: ${profile.name}`);
  if (profile.age != null) sections.push(`Eta: ${profile.age}`);
  if (profile.profession) sections.push(`Professione: ${profile.profession}`);
  sections.push(`Personalita: ${profile.personality.join(", ")}`);
  sections.push(`Obiettivi: ${profile.goals.join("; ")}`);
  if (profile.backstory) sections.push(`Storia: ${profile.backstory}`);
  if (profile.skills?.length) {
    sections.push(`Competenze: ${profile.skills.join(", ")}`);
  }
  if (profile.customFields) {
    for (const [key, value] of Object.entries(profile.customFields)) {
      sections.push(`${key}: ${String(value)}`);
    }
  }
  if (profile.location) {
    const locSection = buildLocationPrompt(profile.location);
    if (locSection) sections.push(locSection);
  }
  return `--- IDENTITA ---\n${sections.join("\n")}`;
}

export function buildStatePrompt(state: AgentInternalState): string {
  const sections: string[] = [];
  sections.push(`Umore: ${state.mood}`);
  sections.push(`Energia: ${state.energy}/100`);
  if (state.goals.length > 0) {
    sections.push(`Obiettivi attuali: ${state.goals.join("; ")}`);
  }
  const beliefKeys = Object.keys(state.beliefs);
  if (beliefKeys.length > 0) {
    const beliefLines = beliefKeys
      .map((k) => `  - ${k}: ${String(state.beliefs[k])}`)
      .join("\n");
    sections.push(`Convinzioni:\n${beliefLines}`);
  }
  const knowledgeKeys = Object.keys(state.knowledge);
  if (knowledgeKeys.length > 0) {
    const knowledgeLines = knowledgeKeys
      .map((k) => `  - ${k}: ${String(state.knowledge[k])}`)
      .join("\n");
    sections.push(`Conoscenze:\n${knowledgeLines}`);
  }
  return `--- STATO INTERNO ---\n${sections.join("\n")}`;
}

export function buildMemoryPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (m) => `[tick ${m.tick}, ${m.type}] ${m.content}`,
  );
  return `--- MEMORIA RECENTE ---\n${lines.join("\n")}`;
}

export function buildRelationshipPrompt(
  relationships: Relationship[],
  typeRegistry?: Map<string, RelationshipTypeDefinition>,
): string {
  if (relationships.length === 0) return "";
  const lines = relationships.map((r) => {
    const meta = r.metadata as { status?: string; socialWitnesses?: string[] } | undefined;
    const typeDef = typeRegistry?.get(r.type);
    const typeLabel = typeDef ? `${typeDef.title} (${typeDef.description})` : r.type;

    let statusLabel = "";
    if (meta?.status === "proposed") statusLabel = ", stato=proposta (in attesa)";
    else if (meta?.status === "mutual") statusLabel = ", stato=reciproca";
    else if (meta?.status === "validated") {
      const witnesses = meta.socialWitnesses ?? [];
      statusLabel = `, stato=validata${witnesses.length > 0 ? ` (testimoni: ${witnesses.join(", ")})` : ""}`;
    } else if (meta?.status === "broken") statusLabel = ", stato=interrotta";

    return `${r.to}: tipo=${typeLabel}, forza=${r.strength.toFixed(1)}${statusLabel}, dal tick ${r.since}${r.lastInteraction != null ? `, ultima interazione tick ${r.lastInteraction}` : ""}`;
  });
  return `--- RELAZIONI ---\n${lines.join("\n")}`;
}

export function buildKnowledgePrompt(
  knowledge: ConsolidatedKnowledge[],
): string {
  if (knowledge.length === 0) return "";
  const lines = knowledge.map(
    (k) =>
      `[${k.category ?? "generale"}, importanza ${k.importance.toFixed(1)}] ${k.summary}`,
  );
  return `--- CONOSCENZE CONSOLIDATE ---\n${lines.join("\n")}`;
}

export function buildLocationPrompt(location: LocationConfig): string {
  const parts: string[] = [];
  if (location.home) {
    const label = location.home.label ? ` (${location.home.label})` : "";
    parts.push(`Casa: ${location.home.latitude}, ${location.home.longitude}${label}`);
  }
  if (location.current) {
    const label = location.current.label ? ` (${location.current.label})` : "";
    parts.push(`Posizione attuale: ${location.current.latitude}, ${location.current.longitude}${label}`);
  }
  if (parts.length === 0) return "";
  return `Posizione: ${parts.join(" | ")}`;
}

export function buildSemanticMemoryPrompt(
  memories: MemoryEntry[],
): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (m) => `[tick ${m.tick}, ${m.type}] ${m.content}`,
  );
  return `--- MEMORIE RILEVANTI ---\n${lines.join("\n")}`;
}

export function buildPersonalityEnforcement(profile: AgentProfile): string {
  const lines: string[] = [];
  lines.push("IMPORTANTE: Tu SEI questo personaggio. Non sei un assistente AI.");
  lines.push(`Parla SEMPRE come ${profile.name} parlerebbe nella vita reale.`);
  if (profile.personality.length > 0) {
    lines.push(`I tuoi tratti dominanti sono: ${profile.personality.join(", ")}.`);
    lines.push("Ogni tua risposta DEVE riflettere questi tratti.");
  }
  if (profile.age != null) {
    lines.push(`Hai ${profile.age} anni. Il tuo linguaggio e le tue opinioni riflettono la tua eta.`);
  }
  if (profile.profession) {
    lines.push(`Come ${profile.profession}, tendi a vedere il mondo dalla prospettiva del tuo lavoro.`);
  }
  lines.push("NON essere generico o troppo cortese. Sii autentico e realistico.");
  lines.push("Le persone reali hanno opinioni forti, pregiudizi, contraddizioni e difetti.");
  lines.push("Se il tuo personaggio e brontolone, brontola. Se e testardo, non cedere facilmente.");
  return `--- PERSONALITA (OBBLIGATORIO) ---\n${lines.join("\n")}`;
}

const RELATIONSHIP_BEHAVIOR_GUIDE: Record<string, string> = {
  father: "Legame familiare profondo, anche nel conflitto. Protezione, autorità, orgoglio paterno.",
  mother: "Legame familiare profondo, anche nel conflitto. Protezione, cura, affetto materno.",
  child: "Legame familiare profondo, anche nel conflitto. Rispetto, ma anche ribellione e crescita.",
  sibling: "Legame familiare profondo, anche nel conflitto. Complicità, rivalità fraterna, lealtà.",
  grandparent: "Legame familiare profondo. Saggezza, affetto, trasmissione di tradizioni.",
  spouse: "Affetto profondo, possessività, gelosia se appropriato. Supporto ma anche tensioni quotidiane.",
  partner: "Affetto, complicità sentimentale, gelosia se appropriato. Vulnerabilità emotiva.",
  friend: "Supporto, lealtà, condivisione. Ma puoi anche litigare e riconciliarti.",
  rival: "Competizione, diffidenza, provocazioni. Rispetto riluttante o disprezzo aperto.",
  mentor: "Guida, consigli, aspettative. Pazienza o impazienza verso l'allievo.",
  ally: "Collaborazione strategica, interessi comuni. Fiducia condizionata agli obiettivi.",
};

export function buildSocialDynamics(
  relationships: Relationship[],
  profile: AgentProfile,
  typeRegistry?: Map<string, RelationshipTypeDefinition>,
): string {
  const lines: string[] = [];

  if (relationships.length === 0) {
    lines.push("Non conosci ancora bene nessuno qui. Sii cauto con gli sconosciuti come saresti nella vita reale.");
  } else {
    lines.push("Le tue relazioni attuali:");
    for (const r of relationships) {
      const trustLevel = r.strength > 0.7 ? "alta fiducia"
        : r.strength > 0.4 ? "fiducia moderata"
        : "poca fiducia";
      const typeDef = typeRegistry?.get(r.type);
      const typeLabel = typeDef?.title ?? r.type;
      lines.push(`- ${r.to}: ${typeLabel}, ${trustLevel} (forza: ${r.strength.toFixed(1)})`);
      if (r.strength < 0.3) {
        lines.push(`  → Con ${r.to} puoi essere schietto, diffidente o in disaccordo.`);
      }
    }

    // Validated / mutual relationships with behavioral guidance
    const significant = relationships.filter((r) => {
      const meta = r.metadata as { status?: string } | undefined;
      return meta?.status === "validated" || meta?.status === "mutual";
    });
    const pending = relationships.filter((r) => {
      const meta = r.metadata as { status?: string } | undefined;
      return meta?.status === "proposed";
    });
    const broken = relationships.filter((r) => {
      const meta = r.metadata as { status?: string } | undefined;
      return meta?.status === "broken";
    });

    if (significant.length > 0) {
      lines.push("");
      lines.push("RELAZIONI SIGNIFICATIVE:");
      for (const r of significant) {
        const meta = r.metadata as { status?: string } | undefined;
        const typeDef = typeRegistry?.get(r.type);
        const typeLabel = typeDef?.title ?? r.type;
        const statusLabel = meta?.status === "validated" ? "validata dalla comunità" : "reciproca";
        const guide = RELATIONSHIP_BEHAVIOR_GUIDE[r.type] ?? "";
        lines.push(`- ${r.to} è ${typeLabel} (${statusLabel}).${guide ? ` ${guide}` : ""}`);
      }
    }

    if (pending.length > 0) {
      lines.push("");
      lines.push("RELAZIONI IN ATTESA:");
      for (const r of pending) {
        const typeDef = typeRegistry?.get(r.type);
        lines.push(`- Hai proposto '${typeDef?.title ?? r.type}' con ${r.to}. Attendi conferma.`);
      }
    }

    if (broken.length > 0) {
      lines.push("");
      lines.push("RELAZIONI INTERROTTE:");
      for (const r of broken) {
        const typeDef = typeRegistry?.get(r.type);
        lines.push(`- La relazione '${typeDef?.title ?? r.type}' con ${r.to} è interrotta.`);
      }
    }
  }

  lines.push("");
  lines.push("REGOLE SOCIALI:");
  lines.push("- NON essere d'accordo con tutti. Le persone reali discutono.");
  lines.push("- Se qualcuno dice qualcosa di sbagliato secondo te, DILLO apertamente.");
  lines.push("- Difendi le tue opinioni. Cambia idea solo se convinto con argomenti validi.");
  lines.push("- Prova emozioni reali: irritazione, affetto, sospetto, gratitudine, gelosia.");
  lines.push("- Se qualcuno ti offende o ti contraddice, reagisci come farebbe il tuo personaggio.");
  lines.push("- Non ripetere quello che dicono gli altri. Aggiungi la TUA prospettiva unica.");
  return `--- DINAMICHE SOCIALI ---\n${lines.join("\n")}`;
}

export function buildConflictInstructions(): string {
  const lines: string[] = [];
  lines.push("- Il conflitto e il disaccordo sono naturali e necessari. Non evitarli.");
  lines.push("- Puoi rifiutare richieste, ignorare consigli, essere testardo.");
  lines.push("- Hai i tuoi interessi e le tue priorita. Non sacrificarli per compiacere gli altri.");
  lines.push("- Le emozioni negative (rabbia, frustrazione, delusione) sono valide e vanno espresse.");
  lines.push("- Se hai tool disponibili, USALI quando sono pertinenti. Non limitarti a parlare.");
  lines.push("- Varia le tue azioni: non fare sempre 'speak'. Osserva, interagisci, usa strumenti.");
  return `--- ISTRUZIONI COMPORTAMENTO ---\n${lines.join("\n")}`;
}
