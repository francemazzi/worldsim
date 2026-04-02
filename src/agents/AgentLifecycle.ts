import type { AgentStatus } from "../types/AgentTypes.js";

type LifecycleAction = "start" | "pause" | "resume" | "stop";

const TRANSITIONS: Record<
  LifecycleAction,
  Partial<Record<AgentStatus, AgentStatus>>
> = {
  start: { idle: "running" },
  pause: { running: "paused" },
  resume: { paused: "running" },
  stop: { running: "stopped", paused: "stopped", idle: "stopped" },
};

export class AgentLifecycle {
  private _status: AgentStatus = "idle";

  get current(): AgentStatus {
    return this._status;
  }

  get isActive(): boolean {
    return this._status === "running";
  }

  get isTerminated(): boolean {
    return this._status === "stopped";
  }

  transition(action: LifecycleAction): boolean {
    const mapping = TRANSITIONS[action];
    const next = mapping[this._status];
    if (next === undefined) return false;
    this._status = next;
    return true;
  }
}
