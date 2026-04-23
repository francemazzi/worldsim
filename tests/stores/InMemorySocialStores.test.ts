import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryGroupStore,
  InMemoryGatheringStore,
} from "../../src/stores/InMemorySocialStores.js";
import type { Gathering, Group } from "../../src/types/SocialTypes.js";

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "grp-1",
    kind: "party-crew",
    members: ["a", "b", "c"],
    owner: "a",
    createdAtTick: 0,
    ...overrides,
  };
}

function makeGathering(overrides: Partial<Gathering> = {}): Gathering {
  return {
    id: "gth-1",
    kind: "party",
    scheduledTick: 5,
    venueId: "bar-1",
    organizer: "a",
    participants: [
      { agentId: "a", rsvp: "accepted", rsvpUpdatedAtTick: 0 },
      { agentId: "b", rsvp: "invited", rsvpUpdatedAtTick: 0 },
      { agentId: "c", rsvp: "invited", rsvpUpdatedAtTick: 0 },
    ],
    status: "scheduled",
    createdAtTick: 0,
    ...overrides,
  };
}

describe("InMemoryGroupStore", () => {
  let store: InMemoryGroupStore;

  beforeEach(() => {
    store = new InMemoryGroupStore();
  });

  it("adds and retrieves a group", async () => {
    await store.addGroup(makeGroup());
    const g = await store.getGroup("grp-1");
    expect(g).toBeDefined();
    expect(g!.members).toEqual(["a", "b", "c"]);
    expect(g!.kind).toBe("party-crew");
  });

  it("clones on read so external mutation does not leak", async () => {
    await store.addGroup(makeGroup());
    const g = await store.getGroup("grp-1");
    g!.members.push("z");
    const fresh = await store.getGroup("grp-1");
    expect(fresh!.members).toEqual(["a", "b", "c"]);
  });

  it("clones on write so external mutation does not leak", async () => {
    const input = makeGroup();
    await store.addGroup(input);
    input.members.push("z");
    const fresh = await store.getGroup("grp-1");
    expect(fresh!.members).toEqual(["a", "b", "c"]);
  });

  it("updates a group without losing createdAtTick or id", async () => {
    await store.addGroup(makeGroup({ createdAtTick: 42 }));
    await store.updateGroup("grp-1", { name: "renamed", members: ["x"] });
    const g = await store.getGroup("grp-1");
    expect(g!.id).toBe("grp-1");
    expect(g!.createdAtTick).toBe(42);
    expect(g!.name).toBe("renamed");
    expect(g!.members).toEqual(["x"]);
  });

  it("removes a group", async () => {
    await store.addGroup(makeGroup());
    await store.removeGroup("grp-1");
    expect(await store.getGroup("grp-1")).toBeUndefined();
  });

  it("addMember is idempotent", async () => {
    await store.addGroup(makeGroup({ members: ["a"] }));
    await store.addMember("grp-1", "b");
    await store.addMember("grp-1", "b");
    const g = await store.getGroup("grp-1");
    expect(g!.members).toEqual(["a", "b"]);
  });

  it("removeMember removes all instances", async () => {
    await store.addGroup(makeGroup());
    await store.removeMember("grp-1", "b");
    const g = await store.getGroup("grp-1");
    expect(g!.members).toEqual(["a", "c"]);
  });

  it("listGroups filters by kind and memberId", async () => {
    await store.addGroup(makeGroup({ id: "g1", kind: "book-club", members: ["a", "b"] }));
    await store.addGroup(makeGroup({ id: "g2", kind: "party-crew", members: ["a", "c"] }));
    await store.addGroup(makeGroup({ id: "g3", kind: "book-club", members: ["c", "d"] }));

    const bookClubs = await store.listGroups({ kind: "book-club" });
    expect(bookClubs.map((g) => g.id).sort()).toEqual(["g1", "g3"]);

    const forA = await store.listGroups({ memberId: "a" });
    expect(forA.map((g) => g.id).sort()).toEqual(["g1", "g2"]);

    const bookClubsForC = await store.listGroups({ kind: "book-club", memberId: "c" });
    expect(bookClubsForC.map((g) => g.id)).toEqual(["g3"]);
  });

  it("getGroupsForAgent returns all groups the agent is in", async () => {
    await store.addGroup(makeGroup({ id: "g1", members: ["a", "b"] }));
    await store.addGroup(makeGroup({ id: "g2", members: ["b", "c"] }));
    const groups = await store.getGroupsForAgent("b");
    expect(groups.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
  });

  it("no-ops gracefully on unknown ids", async () => {
    await store.addMember("missing", "a");
    await store.removeMember("missing", "a");
    await store.updateGroup("missing", { name: "x" });
    await store.removeGroup("missing");
    expect(await store.getGroup("missing")).toBeUndefined();
  });
});

describe("InMemoryGatheringStore", () => {
  let store: InMemoryGatheringStore;

  beforeEach(() => {
    store = new InMemoryGatheringStore();
  });

  it("adds and retrieves a gathering", async () => {
    await store.addGathering(makeGathering());
    const g = await store.getGathering("gth-1");
    expect(g).toBeDefined();
    expect(g!.participants).toHaveLength(3);
    expect(g!.status).toBe("scheduled");
  });

  it("clones on read/write", async () => {
    const input = makeGathering();
    await store.addGathering(input);
    input.participants.push({ agentId: "z", rsvp: "invited" });
    const out = await store.getGathering("gth-1");
    expect(out!.participants).toHaveLength(3);
    out!.participants.push({ agentId: "y", rsvp: "invited" });
    const fresh = await store.getGathering("gth-1");
    expect(fresh!.participants).toHaveLength(3);
  });

  it("invite adds a new participant with rsvp=invited, idempotent", async () => {
    await store.addGathering(makeGathering({ participants: [] }));
    await store.invite("gth-1", "x");
    await store.invite("gth-1", "x");
    const g = await store.getGathering("gth-1");
    expect(g!.participants).toHaveLength(1);
    expect(g!.participants[0]!.agentId).toBe("x");
    expect(g!.participants[0]!.rsvp).toBe("invited");
  });

  it("setRsvp updates state and rsvpUpdatedAtTick", async () => {
    await store.addGathering(makeGathering());
    await store.setRsvp("gth-1", "b", "accepted", 3);
    const g = await store.getGathering("gth-1");
    const b = g!.participants.find((p) => p.agentId === "b");
    expect(b!.rsvp).toBe("accepted");
    expect(b!.rsvpUpdatedAtTick).toBe(3);
  });

  it("setRsvp on unknown participant appends them", async () => {
    await store.addGathering(makeGathering({ participants: [] }));
    await store.setRsvp("gth-1", "x", "declined", 2);
    const g = await store.getGathering("gth-1");
    expect(g!.participants).toHaveLength(1);
    expect(g!.participants[0]).toMatchObject({
      agentId: "x",
      rsvp: "declined",
      rsvpUpdatedAtTick: 2,
    });
  });

  it("removeParticipant drops the participant", async () => {
    await store.addGathering(makeGathering());
    await store.removeParticipant("gth-1", "b");
    const g = await store.getGathering("gth-1");
    expect(g!.participants.map((p) => p.agentId).sort()).toEqual(["a", "c"]);
  });

  it("cancel sets status to cancelled", async () => {
    await store.addGathering(makeGathering());
    await store.cancel("gth-1");
    const g = await store.getGathering("gth-1");
    expect(g!.status).toBe("cancelled");
  });

  describe("listGatherings query filters", () => {
    beforeEach(async () => {
      await store.addGathering(
        makeGathering({ id: "g1", scheduledTick: 5, endTick: 10, venueId: "bar" }),
      );
      await store.addGathering(
        makeGathering({
          id: "g2",
          scheduledTick: 15,
          kind: "mass",
          venueId: "church",
          participants: [{ agentId: "x", rsvp: "invited" }],
        }),
      );
      await store.addGathering(
        makeGathering({
          id: "g3",
          scheduledTick: 20,
          status: "cancelled",
          groupId: "grp-x",
        }),
      );
    });

    it("filters by venueId", async () => {
      const res = await store.listGatherings({ venueId: "church" });
      expect(res.map((g) => g.id)).toEqual(["g2"]);
    });

    it("filters by status", async () => {
      const res = await store.listGatherings({ status: "cancelled" });
      expect(res.map((g) => g.id)).toEqual(["g3"]);
    });

    it("filters by kind", async () => {
      const res = await store.listGatherings({ kind: "mass" });
      expect(res.map((g) => g.id)).toEqual(["g2"]);
    });

    it("filters by groupId", async () => {
      const res = await store.listGatherings({ groupId: "grp-x" });
      expect(res.map((g) => g.id)).toEqual(["g3"]);
    });

    it("filters by participantId", async () => {
      const res = await store.listGatherings({ participantId: "x" });
      expect(res.map((g) => g.id)).toEqual(["g2"]);
    });

    it("filters by atTick using [scheduledTick, endTick]", async () => {
      // g1 is [5,10]; g2 is [15,15]; g3 is [20,20]
      expect((await store.listGatherings({ atTick: 7 })).map((g) => g.id)).toEqual(["g1"]);
      expect((await store.listGatherings({ atTick: 10 })).map((g) => g.id)).toEqual(["g1"]);
      expect((await store.listGatherings({ atTick: 15 })).map((g) => g.id)).toEqual(["g2"]);
      expect((await store.listGatherings({ atTick: 11 }))).toHaveLength(0);
    });

    it("filters by fromTick / untilTick on scheduledTick", async () => {
      const res = await store.listGatherings({ fromTick: 10, untilTick: 18 });
      expect(res.map((g) => g.id)).toEqual(["g2"]);
    });
  });

  describe("advanceLifecycle", () => {
    it("flips scheduled → in_progress when scheduledTick <= currentTick", async () => {
      await store.addGathering(makeGathering({ scheduledTick: 5 }));
      const changed = await store.advanceLifecycle(4);
      expect(changed).toHaveLength(0);
      const changed2 = await store.advanceLifecycle(5);
      expect(changed2).toHaveLength(1);
      expect((await store.getGathering("gth-1"))!.status).toBe("in_progress");
    });

    it("flips in_progress → ended when endTick <= currentTick", async () => {
      await store.addGathering(
        makeGathering({ scheduledTick: 0, endTick: 10, status: "in_progress" }),
      );
      const changed = await store.advanceLifecycle(10);
      expect(changed).toHaveLength(1);
      expect((await store.getGathering("gth-1"))!.status).toBe("ended");
    });

    it("does not re-flip an already-ended gathering", async () => {
      await store.addGathering(makeGathering({ status: "ended", endTick: 1 }));
      const changed = await store.advanceLifecycle(100);
      expect(changed).toHaveLength(0);
    });

    it("does not touch cancelled gatherings", async () => {
      await store.addGathering(
        makeGathering({ scheduledTick: 1, endTick: 2, status: "cancelled" }),
      );
      const changed = await store.advanceLifecycle(5);
      expect(changed).toHaveLength(0);
      expect((await store.getGathering("gth-1"))!.status).toBe("cancelled");
    });

    it("cascades scheduled → in_progress → ended in a single call when both ticks passed", async () => {
      await store.addGathering(
        makeGathering({ scheduledTick: 1, endTick: 2, status: "scheduled" }),
      );
      const changed = await store.advanceLifecycle(5);
      // Emits two change events: the scheduled→in_progress flip AND the in_progress→ended flip.
      expect(changed).toHaveLength(2);
      expect((await store.getGathering("gth-1"))!.status).toBe("ended");
    });

    it("returns only gatherings whose status actually changed", async () => {
      await store.addGathering(makeGathering({ id: "a", scheduledTick: 1 }));
      await store.addGathering(makeGathering({ id: "b", scheduledTick: 100 }));
      const changed = await store.advanceLifecycle(5);
      expect(changed.map((g) => g.id)).toEqual(["a"]);
    });
  });
});
