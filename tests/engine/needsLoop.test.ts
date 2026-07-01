import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import { NeedsSatisfierPlugin } from "../../src/plugins/built-in/NeedsSatisfierPlugin.js";
import {
  autoRegisterNeedsSatisfierIfNeeded,
  worldHasNeedsAgents,
  validateNeedsLoop,
} from "../../src/engine/internal/needsLoop.js";
import type { WorldConfig } from "../../src/types/WorldTypes.js";
import type { AgentConfig } from "../../src/types/AgentTypes.js";

describe("needsLoop auto-wiring", () => {
  const perceptionConfig: WorldConfig = {
    llm: { baseURL: "http://x", apiKey: "k", model: "m" },
    interaction: {
      mode: "perception",
      defaultNeedsTemplate: "humanBasic",
    },
  };

  const agents: AgentConfig[] = [
    { id: "a1", role: "person", name: "A" },
  ];

  it("detects worlds with needs agents", () => {
    expect(worldHasNeedsAgents(perceptionConfig.interaction, agents)).toBe(true);
    expect(
      worldHasNeedsAgents({ mode: "perception" }, [{ id: "x", role: "person", name: "X", needs: { needs: [] } }]),
    ).toBe(false);
  });

  it("auto-registers NeedsSatisfierPlugin when appropriate", () => {
    const registry = new PluginRegistry();
    autoRegisterNeedsSatisfierIfNeeded(perceptionConfig, agents, registry);
    expect(registry.getAll().some((p) => p.name === "needs-satisfier")).toBe(true);
  });

  it("skips auto-register when autoNeedsSatisfier is false", () => {
    const registry = new PluginRegistry();
    autoRegisterNeedsSatisfierIfNeeded(
      {
        ...perceptionConfig,
        interaction: { ...perceptionConfig.interaction!, autoNeedsSatisfier: false },
      },
      agents,
      registry,
    );
    expect(registry.getAll()).toHaveLength(0);
  });

  it("throws when requireNeedsLoop is true and satisfier missing", () => {
    const registry = new PluginRegistry();
    expect(() =>
      validateNeedsLoop(
        {
          ...perceptionConfig,
          interaction: {
            ...perceptionConfig.interaction!,
            autoNeedsSatisfier: false,
            requireNeedsLoop: true,
          },
        },
        agents,
        registry,
      ),
    ).toThrow(/requireNeedsLoop/);
  });

  it("does not duplicate an manually registered satisfier", () => {
    const registry = new PluginRegistry();
    registry.register(new NeedsSatisfierPlugin());
    autoRegisterNeedsSatisfierIfNeeded(perceptionConfig, agents, registry);
    expect(registry.getAll().filter((p) => p.name === "needs-satisfier")).toHaveLength(1);
  });
});
