import { describe, it, expect } from "vitest";
import {
  buildProfilePrompt,
  buildStatePrompt,
  buildMemoryPrompt,
  buildRelationshipPrompt,
} from "../../src/agents/ProfilePromptBuilder.js";
import type { AgentProfile, AgentInternalState } from "../../src/types/AgentTypes.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";
import type { Relationship } from "../../src/types/GraphTypes.js";

describe("ProfilePromptBuilder", () => {
  describe("buildProfilePrompt", () => {
    it("renders all profile fields", () => {
      const profile: AgentProfile = {
        name: "Dr. Marco Rossi",
        age: 45,
        profession: "Medico",
        personality: ["empatico", "metodico"],
        goals: ["curare i pazienti"],
        backstory: "20 anni di esperienza",
        skills: ["diagnosi", "chirurgia"],
      };
      const result = buildProfilePrompt(profile);
      expect(result).toContain("--- IDENTITA ---");
      expect(result).toContain("Nome: Dr. Marco Rossi");
      expect(result).toContain("Eta: 45");
      expect(result).toContain("Professione: Medico");
      expect(result).toContain("empatico, metodico");
      expect(result).toContain("curare i pazienti");
      expect(result).toContain("20 anni di esperienza");
      expect(result).toContain("diagnosi, chirurgia");
    });

    it("omits optional fields when not provided", () => {
      const profile: AgentProfile = {
        name: "Alice",
        personality: ["curiosa"],
        goals: ["esplorare"],
      };
      const result = buildProfilePrompt(profile);
      expect(result).toContain("Nome: Alice");
      expect(result).not.toContain("Eta:");
      expect(result).not.toContain("Professione:");
      expect(result).not.toContain("Storia:");
      expect(result).not.toContain("Competenze:");
    });

    it("renders customFields", () => {
      const profile: AgentProfile = {
        name: "Test",
        personality: ["calma"],
        goals: ["testare"],
        customFields: { hobby: "lettura", livello: 5 },
      };
      const result = buildProfilePrompt(profile);
      expect(result).toContain("hobby: lettura");
      expect(result).toContain("livello: 5");
    });
  });

  describe("buildStatePrompt", () => {
    it("renders state fields", () => {
      const state: AgentInternalState = {
        mood: "felice",
        energy: 80,
        goals: ["completare il progetto"],
        beliefs: { mondo: "pacifico" },
        knowledge: { fatto1: "la terra è rotonda" },
        custom: {},
      };
      const result = buildStatePrompt(state);
      expect(result).toContain("--- STATO INTERNO ---");
      expect(result).toContain("Umore: felice");
      expect(result).toContain("Energia: 80/100");
      expect(result).toContain("completare il progetto");
      expect(result).toContain("mondo: pacifico");
      expect(result).toContain("fatto1: la terra è rotonda");
    });

    it("omits empty beliefs and knowledge", () => {
      const state: AgentInternalState = {
        mood: "neutro",
        energy: 50,
        goals: [],
        beliefs: {},
        knowledge: {},
        custom: {},
      };
      const result = buildStatePrompt(state);
      expect(result).not.toContain("Convinzioni:");
      expect(result).not.toContain("Conoscenze:");
    });
  });

  describe("buildMemoryPrompt", () => {
    it("returns empty string for no memories", () => {
      expect(buildMemoryPrompt([])).toBe("");
    });

    it("formats memories with tick and type", () => {
      const memories: MemoryEntry[] = [
        {
          id: "1",
          agentId: "a",
          tick: 3,
          type: "action",
          content: "spoke to Alice",
          timestamp: new Date(),
        },
        {
          id: "2",
          agentId: "a",
          tick: 5,
          type: "observation",
          content: "Bob left the room",
          timestamp: new Date(),
        },
      ];
      const result = buildMemoryPrompt(memories);
      expect(result).toContain("--- MEMORIA RECENTE ---");
      expect(result).toContain("[tick 3, action] spoke to Alice");
      expect(result).toContain("[tick 5, observation] Bob left the room");
    });
  });

  describe("buildRelationshipPrompt", () => {
    it("returns empty string for no relationships", () => {
      expect(buildRelationshipPrompt([])).toBe("");
    });

    it("formats relationships", () => {
      const rels: Relationship[] = [
        {
          from: "agent-1",
          to: "alice",
          type: "trusts",
          strength: 0.9,
          since: 1,
          lastInteraction: 10,
        },
        {
          from: "agent-1",
          to: "bob",
          type: "knows",
          strength: 0.3,
          since: 5,
        },
      ];
      const result = buildRelationshipPrompt(rels);
      expect(result).toContain("--- RELAZIONI ---");
      expect(result).toContain("alice: tipo=trusts, forza=0.9, dal tick 1, ultima interazione tick 10");
      expect(result).toContain("bob: tipo=knows, forza=0.3, dal tick 5");
      expect(result).not.toContain("bob: tipo=knows, forza=0.3, dal tick 5, ultima");
    });
  });
});
