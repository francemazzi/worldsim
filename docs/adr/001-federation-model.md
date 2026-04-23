# ADR 001 — Multi-World Federation Model

- **Status**: Accepted
- **Date**: 2026-04-23
- **Phase**: 0 (foundations)
- **Supersedes**: —

## Context

WorldSim worlds today are fully isolated [`WorldEngine`](../../src/engine/WorldEngine.ts)
instances. Each owns its `MessageBus`, `ConversationManager`, `BrainMemory`,
location index, and stores. The Studio dashboard already observes multiple
worlds through [`MultiWorldRegistry`](../../src/studio/MultiWorldRegistry.ts),
but there is no mechanism for agents in different worlds to *communicate* or
to *migrate* between them.

The product roadmap calls for federation: agents in Firenze should be able to
SMS, call, or travel to agents in Roma. The same primitives must serve
non-geographic use cases (departments inside a single building, multi-tenant
deployments, …) without forcing a single mental model.

## Decision

We adopt a federation layer governed by three principles, each with a
deliberate trade-off.

### 1. Asynchronous by default

Cross-world messages are *letters*. They are emitted at world A's current tick
and delivered at the first subsequent tick of world B. A `FederationBus`
maintains a per-world inbound queue; the `TickOrchestrator` drains it before
calling `MessageBus.newTick`.

**Why**: Synchronising tick clocks across worlds would require a global
scheduler, distributed barriers, and a way to handle worlds that pause or
crash. Asynchrony matches the real-world semantics of SMS/email and removes
an entire class of distributed-systems failures from the design.

**Cost**: Phase 3 calls — which *are* synchronous — need a dedicated turn-based
sub-loop (`FederatedConversationManager`), not just message passing. We accept
the extra component because most cross-world traffic is asynchronous.

### 2. `worldId:agentId` namespace

Every globally-addressable agent has an identifier of the form
`worldId:agentId`. The colon is reserved. The `MessageBus` recognises external
prefixes and delegates routing to the `FederationBus`; local prefixes are
stripped and dispatched normally.

**Why**: One opaque identifier travels through tools, message metadata, and
the directory. Agents can refer to remote contacts with the same vocabulary
they use locally. The format is human-readable, stable, and trivial to parse.

**Cost**: Existing local `agentId` values must not contain a colon. We document
the constraint and validate it at the boundaries.

### 3. Opt-in via configuration

`WorldConfig.federation` is optional. If absent, no federation code path runs
and there is zero overhead. If present, it carries the local `WorldNode`, a
chosen transport, and optional directory/travel-map components.

**Why**: Existing single-world deployments must remain bit-for-bit
backwards-compatible. Federation is a new capability, not a forced migration.

**Cost**: Every federation-aware module needs a defensive null-check, and we
maintain two operational modes. The cost is small compared to the support
burden of a hard cutover.

## Consequences

- **Determinism / replay**: The deterministic-replay feature on the existing
  roadmap is incompatible with asynchronous federation (event ordering depends
  on real wall-clock interleaving across processes). We document that replay
  is single-world-only when federation is configured.
- **Token budget**: [`TokenBudgetTracker`](../../src/scheduling/TokenBudgetTracker.ts)
  remains per-world. Phase 3 may introduce an optional federated tracker if
  long cross-world calls dominate cost.
- **Ordering guarantees**: Redis Pub/Sub does not preserve order across
  publishers. SMS-style traffic is unaffected; call turns may need a stronger
  transport (Redis Streams, NATS JetStream). We defer that decision to Phase 3
  pending real-world measurements.
- **Clock skew**: `sentAtTick` is not comparable across worlds. Every envelope
  carries `sentAtRealTime` (ISO 8601) for global ordering when needed.
- **Security**: The directory exposes a *whitelisted* `publicProfile`. The
  agent's system prompt, raw memories, and credentials are never replicated.
  `RedisFederationTransport` deployments must run on a trusted network or use
  TLS; we document this in the Phase 1 transport docs.

## Use cases supported by this model

The same primitives serve three deployment shapes; only configuration differs.

| Shape                              | Transport     | `estimatedTicks` | Directory filter |
|------------------------------------|---------------|------------------|------------------|
| Multi-city / geographic            | Redis         | High (hours/days)| None             |
| Multi-department / single building | InMemory      | 0–1 (adjacency)  | None             |
| Multi-tenant / SaaS                | Redis (per-tenant channel) | N/A (no travel) | Per-tenant ACL   |

When agents differ only by logical grouping and share memory/rules/tick rate,
prefer in-world grouping via
[`InMemoryGroupStore`](../../src/stores/InMemorySocialStores.ts) — federation
is overkill in that case.

## Alternatives considered

### Synchronous tick coordination
Rejected: introduces a global scheduler and tightly couples world lifetimes.
Complexity vs. value is poor for the messaging-dominated workload.

### Flat global agent ids (no `worldId` prefix)
Rejected: agents would need a separate lookup to discover their home world,
and the routing layer would need a directory call on every send. The colon
namespace keeps routing O(1) and human-readable.

### Federation always on
Rejected: existing tests, demos, and embedded users would face a behaviour
change with no opt-out. The cost of optionality is negligible.

## Status of follow-on ADRs

Future ADRs will cover, when the relevant phase begins:
- ADR 002 — Transport ordering guarantees (Phase 3, if measurements warrant).
- ADR 003 — `globalAgentId` migration scheme for long-term memory (Phase 4).
- ADR 004 — Directory permission model for multi-tenant deployments (Phase 2+).
