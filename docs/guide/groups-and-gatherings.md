# Groups & Gatherings

Out of the box, each `PersonAgent` reasons in the first person. Calls, SMS, conversations at venues and bilateral relationships already let agents coordinate ad-hoc, but there was no structured concept of "a group of N agents with a stable identity" or "a scheduled multi-agent event". From `1.3.x` WorldSim ships two minimal, **unopinionated** core primitives to fill this gap:

- **`Group`** — an arbitrary, explicitly-declared formal collection of agents with a stable `id`. Different from `Household` (cohabitation + shared assets) and `NeighborhoodManager` (geographic clustering + relationship decay). The installer gives a Group its meaning via the free-form `kind` field: `"book-club"`, `"party-crew"`, `"protest-org"`, `"research-team"`…
- **`Gathering`** — a scheduled moment in time at an optional venue, with a participant list and RSVP state machine (`invited` → `accepted`/`declined` → `attended`/`no_show`). Lifecycle (`scheduled` → `in_progress` → `ended` / `cancelled`) is driven mechanically by `advanceLifecycle(tick)` — the core engine fires no opinionated events on its own.

## Wiring stores

The stores are plain interfaces with zero-dependency in-memory implementations. Wire them on `WorldConfig` just like `assetStore` or `graphStore`:

```typescript
import {
  WorldEngine,
  InMemoryGroupStore,
  InMemoryGatheringStore,
} from "worldsim";

const groupStore = new InMemoryGroupStore();
const gatheringStore = new InMemoryGatheringStore();

const world = new WorldEngine({
  worldId: "my-village",
  llm: { /* … */ },
  groupStore,
  gatheringStore,
});
```

## Custom plugin sketch

**By design, WorldSim ships no built-in tools on top of these stores.** No `organize_party`, no `invite_to_gathering`, no `rsvp` in the core. You compose your own plugin — the vocabulary, the tool names, the side-effects (phone notifications, movement to the venue, mood boosts on attendance, capacity checks) are *your* simulation's story to tell. Minimal sketch:

```typescript
import type { WorldSimPlugin, AgentTool } from "worldsim";

function partyPlugin(opts: { groupStore, gatheringStore }): WorldSimPlugin {
  const tools: AgentTool[] = [
    {
      name: "invite_friends_to_bar",
      description: "Organizza una serata al bar con amici",
      inputSchema: { /* friendIds, venueId, atTick */ },
      async execute(input, ctx) {
        const organizer = ctx.metadata?.currentAgentId as string;
        await opts.groupStore.addGroup({
          id: `grp_${crypto.randomUUID()}`,
          kind: "party-crew",
          members: [organizer, ...input.friendIds],
          owner: organizer,
          createdAtTick: ctx.tickCount,
        });
        await opts.gatheringStore.addGathering({
          id: `gth_${crypto.randomUUID()}`,
          kind: "party",
          scheduledTick: input.atTick,
          venueId: input.venueId,
          organizer,
          participants: [
            { agentId: organizer, rsvp: "accepted" },
            ...input.friendIds.map(id => ({ agentId: id, rsvp: "invited" })),
          ],
          status: "scheduled",
          createdAtTick: ctx.tickCount,
        });
        return { ok: true };
      },
    },
    // accept_invite, list_my_upcoming_gatherings, …
  ];

  return {
    name: "party-plugin",
    version: "0.1.0",
    tools,
    async onWorldTick(tick) {
      const changed = await opts.gatheringStore.advanceLifecycle(tick);
      for (const g of changed) {
        // When a gathering flips to "in_progress", make accepted participants
        // converge at the venue (delegate to MovementPlugin / PhonePlugin / …).
      }
    },
  };
}
```

This way worldsim stays neutral and the *package installer* decides what a "gathering" means in their simulation — a wedding, a town assembly, a protest, a book club night, a birthday.

## Available types

`Group`, `Gathering`, `GatheringParticipant`, `RsvpState`, `GatheringStatus`, `GatheringQuery`, `GroupStore`, `GatheringStore`.

See [Plugins](/plugins) for the full plugin authoring guide.
