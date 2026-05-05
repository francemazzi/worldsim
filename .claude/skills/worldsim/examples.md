# worldsim — Examples

Runnable snippets the agent can copy/paste and adapt.

## 1. Production-grade WorldEngine for thousands of agents

```typescript
import {
  WorldEngine,
  InMemoryMemoryStore,
  InMemoryGraphStore,
} from "worldsim";

const world = new WorldEngine({
  worldId: "city-shard-01",
  maxTicks: 500,
  tickIntervalMs: 500,

  maxConcurrentAgents: 10,
  defaultActiveTickRatio: 0.01,
  controlSamplingRate: 0.2,
  enableResponseCache: true,
  responseCacheTtl: 5,

  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
    maxTokens: 800,
    temperature: 0.7,
    maxRetries: 3,
    retryInitialDelayMs: 500,
    retryMaxDelayMs: 8000,
    retryBackoffFactor: 2,
  },
  lightLlm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
    maxTokens: 300,
    temperature: 0.6,
    maxRetries: 3,
  },

  memoryStore: new InMemoryMemoryStore(),
  graphStore: new InMemoryGraphStore(),
});
```

For 10k citizens + a few important agents:

```typescript
for (let i = 0; i < 10_000; i++) {
  world.addAgent({
    id: `citizen-${i}`,
    role: "person",
    name: `Citizen ${i}`,
    llmTier: "light",
    profile: {
      name: `Citizen ${i}`,
      personality: ["regular"],
      goals: ["work", "rest"],
    },
    tokenBudget: { perTick: 1500, perHour: 60_000, policy: "pause" },
  });
}

world.addAgent({
  id: "mayor",
  role: "person",
  name: "Mayor",
  llm: { model: "gpt-4.1", maxTokens: 1500, temperature: 0.4 },
});
```

## 2. Private 1:1 conversation between agents

```typescript
world.addAgent({ id: "alice", role: "person", name: "Alice" });
world.addAgent({ id: "bob",   role: "person", name: "Bob"   });

const conv = world.createConversation("alice", ["bob"], "Private discussion");

await world.start();

world.endConversation(conv.id);
```

While the conversation is active, every `speak` from Alice or Bob is routed only to the other participant — no broadcast, no neighborhood fan-out.

## 3. SMS and phone calls (PhonePlugin)

```typescript
import {
  PhonePlugin,
  InMemoryAssetStore,
  createPhoneAsset,
} from "worldsim";

const assetStore = new InMemoryAssetStore();

const world = new WorldEngine({
  /* ...llm, stores... */
  assetStore,
});

world.use(new PhonePlugin({
  assetStore,
  messageBus: world.getMessageBus(),
  conversationManager: world.getConversationManager(),
}));

await assetStore.addAssets([
  createPhoneAsset({
    agentId: "alice",
    phoneNumber: "+39-111",
    contacts: [{ name: "Bob", phoneNumber: "+39-222" }],
  }),
  createPhoneAsset({
    agentId: "bob",
    phoneNumber: "+39-222",
    contacts: [{ name: "Alice", phoneNumber: "+39-111" }],
  }),
]);

world.addAgent({
  id: "alice",
  role: "person",
  name: "Alice",
  systemPrompt: "If you need to reach someone privately, prefer SMS or calls over public speaking.",
  profile: {
    name: "Alice",
    personality: ["pragmatic"],
    goals: ["coordinate privately with Bob"],
  },
});
```

The agent now decides autonomously whether to use `send_sms`, `start_call`, `speak_in_call`, `hang_up`.

## 4. GDPR-style privacy with consent + audit

Requires a persistence store that implements `upsertConsent` / `getConsent` / `savePolicyAudit` (e.g. `PgPersistenceStore`).

```typescript
import { randomUUID } from "node:crypto";

const world = new WorldEngine({
  /* ...llm, stores... */
  persistenceStore,

  privacy: {
    regulatoryProfile: "gdpr",
    policyVersion: "v1",
    consentMode: "soft_gate",
    defaults: {
      required: true,
      redactionLevel: "partial",
      retentionDays: 30,
      allowExport: true,
    },
    categories: {
      memory:       { redactionLevel: "partial", retentionDays: 30 },
      social_graph: { redactionLevel: "strict",  retentionDays: 14 },
      telemetry:    { redactionLevel: "strict",  retentionDays: 7  },
      tool_inputs:  { required: true, redactionLevel: "strict", allowToolUse: false },
    },
  },
});

await persistenceStore.upsertConsent?.({
  id: randomUUID(),
  worldId: "demo",
  subjectId: "alice",
  category: "memory",
  regulatoryProfile: "gdpr",
  policyVersion: "v1",
  status: "accepted",
  source: "onboarding",
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

Without `accepted` consent for a `required` category, `privacyCompliancePlugin` redacts payloads or downgrades `tool_call` actions to `observe`. Audits land in `persistenceStore.savePolicyAudit`.

## 5. Per-agent token budget + idle agents

```typescript
world.addAgent({
  id: "watchman",
  role: "person",
  name: "Watchman",
  alwaysThink: false,
  tokenBudget: {
    perTick: 1500,
    perHour: 60_000,
    lifetime: 5_000_000,
    policy: "pause",
  },
});
```

Idle agents (no messages, no goals, low energy, not in conversation) automatically skip the LLM call and emit a `rest` observation. `tokenBudget.policy: "pause"` halts an agent that exceeds its budget; `"degrade"` downgrades it to a cheaper model or shorter context.

## 6. Custom MovementPolicy

```typescript
import {
  WorldEngine,
  MovementPlugin,
  LocationIndex,
  type MovementPolicy,
} from "worldsim";

const policy: MovementPolicy = (req) => {
  if (req.distanceMeters < 800) return { allowed: true, mode: "walking" };

  const hasCar = req.assets.some((a) => a.type === "vehicle" && a.owner === req.agentId);
  if (hasCar) return { allowed: true, mode: "driving" };

  if (req.distanceMeters < 5000) return { allowed: true, mode: "public_transit" };

  return { allowed: false, reason: "Too far without a car." };
};

const world = new WorldEngine({
  /* ... */
  assetStore,
  movementPolicy: policy,
});

world.use(new MovementPlugin(new LocationIndex()));
```

## 7. Federation across two cities

```typescript
import {
  WorldEngine,
  InMemoryFederationTransport,
} from "worldsim";

const transport = new InMemoryFederationTransport();

const cityA = new WorldEngine({
  worldId: "city-a",
  /* ... */
  federation: {
    worldNode: { worldId: "city-a", region: "north" },
    transport,
  },
});

const cityB = new WorldEngine({
  worldId: "city-b",
  /* ... */
  federation: {
    worldNode: { worldId: "city-b", region: "south" },
    transport,
  },
});
```

An agent in `city-a` can address `city-b:bob` and the message is routed via the transport. Local-prefix `city-a:alice` is automatically stripped.

## 8. Custom plugin with tools (party plugin sketch)

```typescript
import type { WorldSimPlugin, AgentTool } from "worldsim";
import { randomUUID } from "node:crypto";

export function partyPlugin(opts: {
  groupStore: GroupStore;
  gatheringStore: GatheringStore;
}): WorldSimPlugin {
  const tools: AgentTool[] = [
    {
      name: "invite_friends_to_bar",
      description: "Organize an evening at the bar with friends.",
      inputSchema: {
        type: "object",
        properties: {
          friendIds: { type: "array", items: { type: "string" } },
          venueId: { type: "string" },
          atTick: { type: "number" },
        },
        required: ["friendIds", "venueId", "atTick"],
      },
      async execute(input, ctx) {
        const { friendIds, venueId, atTick } = input as {
          friendIds: string[];
          venueId: string;
          atTick: number;
        };
        const organizer = (ctx.metadata?.currentAgentId as string) ?? "";

        await opts.groupStore.addGroup({
          id: `grp_${randomUUID()}`,
          kind: "party-crew",
          members: [organizer, ...friendIds],
          owner: organizer,
          createdAtTick: ctx.tickCount,
        });
        await opts.gatheringStore.addGathering({
          id: `gth_${randomUUID()}`,
          kind: "party",
          scheduledTick: atTick,
          venueId,
          organizer,
          participants: [
            { agentId: organizer, rsvp: "accepted" },
            ...friendIds.map((id) => ({ agentId: id, rsvp: "invited" as const })),
          ],
          status: "scheduled",
          createdAtTick: ctx.tickCount,
        });
        return { ok: true };
      },
    },
  ];

  return {
    name: "party-plugin",
    version: "0.1.0",
    tools,
    async onWorldTick(tick) {
      await opts.gatheringStore.advanceLifecycle(tick);
    },
  };
}
```

## 9. Studio dashboard + final report

```typescript
import { studioPlugin, reportGeneratorPlugin } from "worldsim";

const report = reportGeneratorPlugin({ engine: world });
world.use(report.plugin);
world.use(studioPlugin({ engine: world, port: 4400, open: true }));

world.on("tick", (tick) => {
  if (tick === 10) {
    report.recordPolicyTrigger(tick, "Mayor announces water rationing.");
  }
});

await world.start();
```

The dashboard at `http://localhost:4400` shows live agent state, timeline, relationship graph and the simulation report.
