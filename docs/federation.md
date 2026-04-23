# Multi-World Federation

WorldSim worlds run in isolation by default: each [`WorldEngine`](../src/engine/WorldEngine.ts)
owns its `MessageBus`, `ConversationManager`, `BrainMemory`, and stores. The
federation layer adds opt-in cross-world communication and agent migration on
top of that, without changing the behaviour of single-world setups.

## Status

| Phase | Topic                                | Status |
|-------|--------------------------------------|--------|
| 0     | Type vocabulary, schemas, ADR        | **In progress** (this branch) |
| 1     | Async cross-world messaging          | Planned |
| 2     | Global agent directory & discovery   | Planned |
| 3     | Synchronous cross-world calls        | Planned |
| 4     | Agent travel & live migration        | Planned |
| 5     | Studio observability for federation  | Planned |

See the implementation plan at
`~/.claude/plans/devi-pianificare-la-possibilit-bubbly-engelbart.md` for the
detailed roadmap.

## Core concepts

### World as an isolation boundary

A *world* is a confine of state — memory, rules, agent registry, local tick
clock. It does not necessarily map to geography. The same federation primitives
fit three usage patterns:

| Scenario                     | Example                               | Tuning |
|------------------------------|---------------------------------------|--------|
| Multi-city / geographic      | Firenze ↔ Roma ↔ Milano               | High `estimatedTicks`, real GPS coordinates, Redis transport |
| Multi-department / single building | HR ↔ Tech ↔ Admin               | `estimatedTicks: 0`, in-memory transport, calls instead of travel |
| Multi-tenant / SaaS-style    | Customer A ↔ Customer B               | No travel, selective messaging, directory with permission filtering |

When agents only differ by *logical grouping* and share memory, rules, and tick
rate, prefer in-world grouping via
[`InMemoryGroupStore`](../src/stores/InMemorySocialStores.ts) over federation.

### Federated agent identifiers

A `FederatedAgentId` is a string of the form `worldId:agentId` (for example
`firenze:maria`). The colon is reserved as a separator; world ids must not
contain it. Helpers in [`FederatedAgentId.ts`](../src/federation/FederatedAgentId.ts)
provide `format`, `parse`, `isFederatedAgentId`, `isExternal`, and
`stripLocalPrefix`.

### Asynchronous by default

Worlds tick at independent rates. A cross-world message is a "letter": it
leaves world A at tick *N* and is delivered at the *next* tick of world B —
whatever that happens to be. This is realistic and dramatically simpler than
synchronising tick clocks.

The exception is Phase 3 *calls*, which temporarily lock both participants
into a turn-taking sub-loop coordinated by `FederatedConversationManager`.

### Transport-agnostic

`FederationTransport` is the single integration seam. Phase 1 ships:

- `InMemoryFederationTransport` — single-process tests and demos.
- `RedisFederationTransport` — multi-process production deployments.

Adding a new transport (NATS JetStream, Kafka, …) means implementing the
interface; nothing else changes.

### Opt-in

A `WorldEngine` constructed without a `federation` field on its config keeps
the exact behaviour it has today. Federation is configured by passing a
`FederationConfig` that names the local `WorldNode`, picks a transport, and
optionally provides a directory and a travel map.

## Type surface (Phase 0)

The full type vocabulary lives under [`src/federation/`](../src/federation/)
and is re-exported in two places:

- `import type { FederatedAgentId, ... } from "worldsim";` — convenience.
- `import { ... } from "worldsim/federation";` — dedicated sub-export.

Zod schemas in [`src/federation/schemas.ts`](../src/federation/schemas.ts)
cover every payload that crosses a process boundary so each adapter can
validate inbound data before trusting it.

## Architectural decisions

See [`docs/adr/001-federation-model.md`](./adr/001-federation-model.md) for the
rationale behind the asynchronous model, the `worldId:agentId` namespace, and
the opt-in posture.
