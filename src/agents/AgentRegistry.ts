import type { BaseAgent } from "./BaseAgent.js";

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  add(agent: BaseAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`[AgentRegistry] Agent "${agent.id}" already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getOrThrow(id: string): BaseAgent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`[AgentRegistry] Agent "${id}" not found`);
    }
    return agent;
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }

  list(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }

  get size(): number {
    return this.agents.size;
  }
}
