import type { WorldEngineRuntime } from "./WorldEngineRuntime.js";

export class WorldLifecycle {
  constructor(private runtime: WorldEngineRuntime) {}

  async stop(): Promise<void> {
    this.runtime.status = "stopped";

    for (const agent of this.runtime.agentRegistry.list()) {
      if (agent.status !== "stopped") {
        agent.stop(this.runtime.clock.current());
      }
    }

    await this.runtime.pluginRegistry.runHook(
      "onWorldStop",
      this.runtime.context,
      this.runtime.eventLog,
    );

    this.runtime.agentRegistry.clear();
    this.runtime.messageBus.clear();
    this.runtime.controlAgents = [];
    this.runtime.personAgents = [];
  }

  pause(): void {
    this.runtime.status = "paused";
  }

  canResume(): boolean {
    return this.runtime.status === "paused";
  }

  markRunning(): void {
    this.runtime.status = "running";
  }
}
