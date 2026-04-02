import { describe, it, expect } from "vitest";
import { AgentLifecycle } from "../../src/agents/AgentLifecycle.js";

describe("AgentLifecycle", () => {
  it("starts with status 'idle'", () => {
    const lc = new AgentLifecycle();
    expect(lc.current).toBe("idle");
  });

  it("transition('start') from 'idle' → 'running', returns true", () => {
    const lc = new AgentLifecycle();
    expect(lc.transition("start")).toBe(true);
    expect(lc.current).toBe("running");
  });

  it("transition('pause') from 'running' → 'paused', returns true", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    expect(lc.transition("pause")).toBe(true);
    expect(lc.current).toBe("paused");
  });

  it("transition('resume') from 'paused' → 'running', returns true", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    lc.transition("pause");
    expect(lc.transition("resume")).toBe(true);
    expect(lc.current).toBe("running");
  });

  it("transition('stop') from 'running' → 'stopped', returns true", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    expect(lc.transition("stop")).toBe(true);
    expect(lc.current).toBe("stopped");
  });

  it("transition('stop') from 'paused' → 'stopped', returns true", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    lc.transition("pause");
    expect(lc.transition("stop")).toBe(true);
    expect(lc.current).toBe("stopped");
  });

  it("transition('pause') from 'stopped' returns false (terminal)", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    lc.transition("stop");
    expect(lc.transition("pause")).toBe(false);
    expect(lc.current).toBe("stopped");
  });

  it("transition('resume') from 'stopped' returns false", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    lc.transition("stop");
    expect(lc.transition("resume")).toBe(false);
    expect(lc.current).toBe("stopped");
  });

  it("transition('start') from 'running' returns false (already running)", () => {
    const lc = new AgentLifecycle();
    lc.transition("start");
    expect(lc.transition("start")).toBe(false);
    expect(lc.current).toBe("running");
  });

  it("isActive is true only when status = 'running'", () => {
    const lc = new AgentLifecycle();
    expect(lc.isActive).toBe(false);
    lc.transition("start");
    expect(lc.isActive).toBe(true);
    lc.transition("pause");
    expect(lc.isActive).toBe(false);
    lc.transition("resume");
    expect(lc.isActive).toBe(true);
    lc.transition("stop");
    expect(lc.isActive).toBe(false);
  });

  it("isTerminated is true only when status = 'stopped'", () => {
    const lc = new AgentLifecycle();
    expect(lc.isTerminated).toBe(false);
    lc.transition("start");
    expect(lc.isTerminated).toBe(false);
    lc.transition("stop");
    expect(lc.isTerminated).toBe(true);
  });
});
