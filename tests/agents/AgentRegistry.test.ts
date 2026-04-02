import { describe, it, expect, vi } from "vitest";
import { AgentRegistry } from "../../src/agents/AgentRegistry.js";
import type { BaseAgent } from "../../src/agents/BaseAgent.js";

function makeFakeAgent(id: string): BaseAgent {
  return { id, role: "person", status: "idle" } as unknown as BaseAgent;
}

describe("AgentRegistry", () => {
  it("add and get agent", () => {
    const reg = new AgentRegistry();
    const agent = makeFakeAgent("a1");
    reg.add(agent);
    expect(reg.get("a1")).toBe(agent);
  });

  it("throws on duplicate agent id", () => {
    const reg = new AgentRegistry();
    reg.add(makeFakeAgent("a1"));
    expect(() => reg.add(makeFakeAgent("a1"))).toThrow("already registered");
  });

  it("remove agent", () => {
    const reg = new AgentRegistry();
    reg.add(makeFakeAgent("a1"));
    expect(reg.remove("a1")).toBe(true);
    expect(reg.get("a1")).toBeUndefined();
  });

  it("list returns all agents", () => {
    const reg = new AgentRegistry();
    reg.add(makeFakeAgent("a1"));
    reg.add(makeFakeAgent("a2"));
    expect(reg.list()).toHaveLength(2);
  });

  it("getOrThrow throws for missing agent", () => {
    const reg = new AgentRegistry();
    expect(() => reg.getOrThrow("missing")).toThrow("not found");
  });

  it("clear removes all agents", () => {
    const reg = new AgentRegistry();
    reg.add(makeFakeAgent("a1"));
    reg.add(makeFakeAgent("a2"));
    reg.clear();
    expect(reg.size).toBe(0);
  });
});
