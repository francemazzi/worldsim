/**
 * Neutral primitives for multi-agent group formation and scheduled gatherings.
 *
 * These types are intentionally free of social semantics. The core engine does
 * not attach behavior to them: the installer composes their own plugin (tools,
 * notifications, lifecycle reactions) on top of these stores.
 *
 * `Group` is distinct from:
 *   - `Household` (cohabitation + shared assets, see AssetTypes)
 *   - `NeighborhoodManager` (geographic clustering + relationship decay)
 *   - `Relationship.group` (a free-form tag on bilateral relationships)
 * A `Group` is an arbitrary, explicitly-declared formal collection with a
 * stable id. The installer gives it meaning via `kind` / `metadata`.
 *
 * `Gathering` is a scheduled moment in time, with an optional place and a
 * participant list with RSVP state. It is distinct from a `Venue` (a place)
 * and a `Conversation` (ad-hoc dialog with turn-taking).
 */

export interface Group {
  id: string;
  name?: string | undefined;
  /** Free-form classifier chosen by the installer: "book-club", "party-crew", "protest-org"… */
  kind?: string | undefined;
  members: string[];
  /** Descriptive only — does not grant permissions. */
  owner?: string | undefined;
  createdAtTick: number;
  metadata?: Record<string, unknown> | undefined;
}

export type RsvpState = "invited" | "accepted" | "declined" | "attended" | "no_show";

export interface GatheringParticipant {
  agentId: string;
  rsvp: RsvpState;
  rsvpUpdatedAtTick?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type GatheringStatus = "scheduled" | "in_progress" | "ended" | "cancelled";

export interface Gathering {
  id: string;
  name?: string | undefined;
  /** Free-form classifier: "dinner", "mass", "assembly"… installer's choice. */
  kind?: string | undefined;
  scheduledTick: number;
  endTick?: number | undefined;
  /** Reference to an AssetStore venue id. Not validated by this store. */
  venueId?: string | undefined;
  /** Reference to a GroupStore group id. Not validated by this store. */
  groupId?: string | undefined;
  organizer?: string | undefined;
  participants: GatheringParticipant[];
  status: GatheringStatus;
  createdAtTick: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface GroupStore {
  addGroup(group: Group): Promise<void>;
  getGroup(id: string): Promise<Group | undefined>;
  listGroups(filter?: { kind?: string; memberId?: string }): Promise<Group[]>;
  updateGroup(id: string, updates: Partial<Omit<Group, "id" | "createdAtTick">>): Promise<void>;
  removeGroup(id: string): Promise<void>;

  addMember(groupId: string, agentId: string): Promise<void>;
  removeMember(groupId: string, agentId: string): Promise<void>;
  getGroupsForAgent(agentId: string): Promise<Group[]>;
}

export interface GatheringQuery {
  /** Matches gatherings whose [scheduledTick, endTick ?? scheduledTick] contains `atTick`. */
  atTick?: number | undefined;
  fromTick?: number | undefined;
  untilTick?: number | undefined;
  venueId?: string | undefined;
  participantId?: string | undefined;
  groupId?: string | undefined;
  status?: GatheringStatus | undefined;
  kind?: string | undefined;
}

export interface GatheringStore {
  addGathering(gathering: Gathering): Promise<void>;
  getGathering(id: string): Promise<Gathering | undefined>;
  listGatherings(query?: GatheringQuery): Promise<Gathering[]>;
  updateGathering(
    id: string,
    updates: Partial<Omit<Gathering, "id" | "createdAtTick" | "participants">>,
  ): Promise<void>;
  removeGathering(id: string): Promise<void>;

  invite(gatheringId: string, agentId: string): Promise<void>;
  setRsvp(gatheringId: string, agentId: string, rsvp: RsvpState, tick: number): Promise<void>;
  removeParticipant(gatheringId: string, agentId: string): Promise<void>;

  /**
   * Mechanical status transitions based on the current tick:
   *   scheduled → in_progress when scheduledTick <= currentTick
   *   in_progress → ended      when endTick != null && endTick <= currentTick
   * Returns the gatherings whose status changed. The engine does NOT call this
   * automatically: the installer's plugin is expected to drive the lifecycle.
   */
  advanceLifecycle(currentTick: number): Promise<Gathering[]>;
  cancel(id: string): Promise<void>;
}
