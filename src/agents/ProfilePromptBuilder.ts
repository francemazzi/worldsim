import type { AgentProfile, AgentInternalState } from "../types/AgentTypes.js";
import type { MemoryEntry } from "../types/MemoryTypes.js";
import type { Relationship } from "../types/GraphTypes.js";

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

export function buildRelationshipPrompt(relationships: Relationship[]): string {
  if (relationships.length === 0) return "";
  const lines = relationships.map(
    (r) =>
      `${r.to}: tipo=${r.type}, forza=${r.strength.toFixed(1)}, dal tick ${r.since}${r.lastInteraction != null ? `, ultima interazione tick ${r.lastInteraction}` : ""}`,
  );
  return `--- RELAZIONI ---\n${lines.join("\n")}`;
}
