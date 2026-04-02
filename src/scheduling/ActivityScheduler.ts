import type { ActivitySchedule } from "../types/ScheduleTypes.js";

interface AgentScheduleState {
  lastActiveTick: number;
  actionCountThisHour: number;
  hourStartTick: number;
}

export class ActivityScheduler {
  private state: Map<string, AgentScheduleState> = new Map();

  /**
   * Determines whether an agent should be active on the given tick.
   * Uses deterministic hashing so the same agent+tick always produces the same result.
   */
  shouldActivate(
    agentId: string,
    currentTick: number,
    schedule: ActivitySchedule | undefined,
  ): boolean {
    if (!schedule) return true;

    // Sleep cycle check
    if (schedule.sleepCycle) {
      const { activeFrom, activeTo, period } = schedule.sleepCycle;
      const positionInCycle = currentTick % period;
      if (activeFrom <= activeTo) {
        if (positionInCycle < activeFrom || positionInCycle >= activeTo) {
          return false;
        }
      } else {
        // Wrapping cycle (e.g., activeFrom=20, activeTo=8, period=24)
        if (positionInCycle < activeFrom && positionInCycle >= activeTo) {
          return false;
        }
      }
    }

    // Active tick ratio check (deterministic hash)
    if (schedule.activeTickRatio != null && schedule.activeTickRatio < 1.0) {
      const hash = this.deterministicHash(agentId, currentTick);
      if (hash >= schedule.activeTickRatio) {
        return false;
      }
    }

    const agentState = this.state.get(agentId);

    // Cooldown check
    if (schedule.cooldownTicks != null && schedule.cooldownTicks > 0 && agentState) {
      const ticksSinceLast = currentTick - agentState.lastActiveTick;
      if (ticksSinceLast < schedule.cooldownTicks) {
        return false;
      }
    }

    // Actions per hour check
    if (schedule.actionsPerHour != null && agentState) {
      if (agentState.actionCountThisHour >= schedule.actionsPerHour) {
        return false;
      }
    }

    return true;
  }

  /**
   * Records that an agent has performed an action on the given tick.
   */
  recordAction(agentId: string, currentTick: number, hourPeriod: number = 60): void {
    const existing = this.state.get(agentId);

    if (!existing) {
      this.state.set(agentId, {
        lastActiveTick: currentTick,
        actionCountThisHour: 1,
        hourStartTick: currentTick,
      });
      return;
    }

    // Reset hour counter if enough ticks have passed
    if (currentTick - existing.hourStartTick >= hourPeriod) {
      existing.hourStartTick = currentTick;
      existing.actionCountThisHour = 0;
    }

    existing.lastActiveTick = currentTick;
    existing.actionCountThisHour += 1;
  }

  /**
   * Deterministic hash that maps (agentId, tick) to [0, 1).
   * Ensures the same agent on the same tick always gets the same result.
   */
  private deterministicHash(agentId: string, tick: number): number {
    let hash = 0;
    const str = `${agentId}:${tick}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash % 10000) / 10000;
  }

  clear(): void {
    this.state.clear();
  }
}
