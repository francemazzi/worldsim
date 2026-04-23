import type {
  Gathering,
  GatheringParticipant,
  GatheringQuery,
  GatheringStore,
  Group,
  GroupStore,
  RsvpState,
} from "../types/SocialTypes.js";

function cloneParticipant(p: GatheringParticipant): GatheringParticipant {
  return { ...p, ...(p.metadata ? { metadata: { ...p.metadata } } : {}) };
}

function cloneGroup(g: Group): Group {
  return {
    ...g,
    members: [...g.members],
    ...(g.metadata ? { metadata: { ...g.metadata } } : {}),
  };
}

function cloneGathering(g: Gathering): Gathering {
  return {
    ...g,
    participants: g.participants.map(cloneParticipant),
    ...(g.metadata ? { metadata: { ...g.metadata } } : {}),
  };
}

export class InMemoryGroupStore implements GroupStore {
  private groups = new Map<string, Group>();

  async addGroup(group: Group): Promise<void> {
    this.groups.set(group.id, cloneGroup(group));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const g = this.groups.get(id);
    return g ? cloneGroup(g) : undefined;
  }

  async listGroups(filter?: { kind?: string; memberId?: string }): Promise<Group[]> {
    const result: Group[] = [];
    for (const g of this.groups.values()) {
      if (filter?.kind && g.kind !== filter.kind) continue;
      if (filter?.memberId && !g.members.includes(filter.memberId)) continue;
      result.push(cloneGroup(g));
    }
    return result;
  }

  async updateGroup(
    id: string,
    updates: Partial<Omit<Group, "id" | "createdAtTick">>,
  ): Promise<void> {
    const existing = this.groups.get(id);
    if (!existing) return;
    const merged: Group = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAtTick: existing.createdAtTick,
    };
    if (updates.members) merged.members = [...updates.members];
    this.groups.set(id, merged);
  }

  async removeGroup(id: string): Promise<void> {
    this.groups.delete(id);
  }

  async addMember(groupId: string, agentId: string): Promise<void> {
    const g = this.groups.get(groupId);
    if (!g) return;
    if (!g.members.includes(agentId)) g.members.push(agentId);
  }

  async removeMember(groupId: string, agentId: string): Promise<void> {
    const g = this.groups.get(groupId);
    if (!g) return;
    g.members = g.members.filter((m) => m !== agentId);
  }

  async getGroupsForAgent(agentId: string): Promise<Group[]> {
    const result: Group[] = [];
    for (const g of this.groups.values()) {
      if (g.members.includes(agentId)) result.push(cloneGroup(g));
    }
    return result;
  }
}

export class InMemoryGatheringStore implements GatheringStore {
  private gatherings = new Map<string, Gathering>();

  async addGathering(gathering: Gathering): Promise<void> {
    this.gatherings.set(gathering.id, cloneGathering(gathering));
  }

  async getGathering(id: string): Promise<Gathering | undefined> {
    const g = this.gatherings.get(id);
    return g ? cloneGathering(g) : undefined;
  }

  async listGatherings(query?: GatheringQuery): Promise<Gathering[]> {
    const result: Gathering[] = [];
    for (const g of this.gatherings.values()) {
      if (!matchesQuery(g, query)) continue;
      result.push(cloneGathering(g));
    }
    return result;
  }

  async updateGathering(
    id: string,
    updates: Partial<Omit<Gathering, "id" | "createdAtTick" | "participants">>,
  ): Promise<void> {
    const existing = this.gatherings.get(id);
    if (!existing) return;
    const merged: Gathering = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAtTick: existing.createdAtTick,
      participants: existing.participants,
    };
    this.gatherings.set(id, merged);
  }

  async removeGathering(id: string): Promise<void> {
    this.gatherings.delete(id);
  }

  async invite(gatheringId: string, agentId: string): Promise<void> {
    const g = this.gatherings.get(gatheringId);
    if (!g) return;
    if (g.participants.some((p) => p.agentId === agentId)) return;
    g.participants.push({ agentId, rsvp: "invited" });
  }

  async setRsvp(
    gatheringId: string,
    agentId: string,
    rsvp: RsvpState,
    tick: number,
  ): Promise<void> {
    const g = this.gatherings.get(gatheringId);
    if (!g) return;
    const p = g.participants.find((pp) => pp.agentId === agentId);
    if (p) {
      p.rsvp = rsvp;
      p.rsvpUpdatedAtTick = tick;
    } else {
      g.participants.push({ agentId, rsvp, rsvpUpdatedAtTick: tick });
    }
  }

  async removeParticipant(gatheringId: string, agentId: string): Promise<void> {
    const g = this.gatherings.get(gatheringId);
    if (!g) return;
    g.participants = g.participants.filter((p) => p.agentId !== agentId);
  }

  async advanceLifecycle(currentTick: number): Promise<Gathering[]> {
    const changed: Gathering[] = [];
    for (const g of this.gatherings.values()) {
      if (g.status === "scheduled" && g.scheduledTick <= currentTick) {
        g.status = "in_progress";
        changed.push(cloneGathering(g));
        // Fall through: a scheduled gathering with an already-passed endTick
        // transitions straight to "ended" in the same call.
      }
      if (g.status === "in_progress" && g.endTick != null && g.endTick <= currentTick) {
        g.status = "ended";
        changed.push(cloneGathering(g));
      }
    }
    return changed;
  }

  async cancel(id: string): Promise<void> {
    const g = this.gatherings.get(id);
    if (!g) return;
    g.status = "cancelled";
  }
}

function matchesQuery(g: Gathering, q: GatheringQuery | undefined): boolean {
  if (!q) return true;
  if (q.status && g.status !== q.status) return false;
  if (q.kind && g.kind !== q.kind) return false;
  if (q.venueId && g.venueId !== q.venueId) return false;
  if (q.groupId && g.groupId !== q.groupId) return false;
  if (q.participantId && !g.participants.some((p) => p.agentId === q.participantId)) return false;
  if (q.atTick != null) {
    const end = g.endTick ?? g.scheduledTick;
    if (q.atTick < g.scheduledTick || q.atTick > end) return false;
  }
  if (q.fromTick != null && g.scheduledTick < q.fromTick) return false;
  if (q.untilTick != null && g.scheduledTick > q.untilTick) return false;
  return true;
}
