# worldsim — API Reference

Quick reference for the most important types. Source of truth: `src/types/`.

## WorldConfig

| Field | Type | Notes |
| --- | --- | --- |
| `worldId` | `string` | optional, defaults to a uuid |
| `maxTicks` | `number` | default `Infinity` |
| `tickIntervalMs` | `number` | wall-clock pacing only |
| `maxConcurrentAgents` | `number` | hard cap on parallel agent ticks |
| `defaultActiveTickRatio` | `number` | 0–1, fraction of agents reasoning per tick |
| `controlSamplingRate` | `number` | 0–1, fraction of actions evaluated by `ControlAgent` |
| `enableResponseCache` | `boolean` | cache identical chat completions |
| `responseCacheTtl` | `number` | TTL in ticks |
| `eventLogMaxSize` | `number` | circular buffer size |
| `defaultBroadcastRadius` | `number` | km, 0 = global broadcast fallback |
| `walkingRadiusMeters` | `number` | default for built-in `MovementPolicy` |
| `movementPolicy` | `MovementPolicy` | replaces the default |
| `llm` | `LLMConfig` | required |
| `lightLlm` | `LLMConfig` | optional cheap tier |
| `rulesPath` | `{ json?: string[]; pdf?: string[] }` | rule files |
| `memoryStore` | `MemoryStore` | in-memory if omitted |
| `graphStore` | `GraphStore` | optional |
| `vectorStore` | `VectorStore` | optional |
| `embeddingAdapter` | `EmbeddingAdapter` | required only when using a vector store |
| `persistenceStore` | `PersistenceStore` | required for consents/audits/snapshots |
| `assetStore` | `AssetStore` | required by `PhonePlugin` and `MovementPlugin` |
| `groupStore` / `gatheringStore` | optional | groups & scheduled events |
| `consolidation` | `Partial<ConsolidationConfig>` | memory consolidation tuning |
| `privacy` | `WorldPrivacyConfig` | enables `privacyCompliancePlugin` automatically |
| `observability` | `ObservabilityConfig` | pricing + alert thresholds |
| `federation` | `FederationConfig` | enables multi-world routing |

## LLMConfig

| Field | Type | Default |
| --- | --- | --- |
| `baseURL` | `string` | — |
| `apiKey` | `string` | — |
| `model` | `string` | — |
| `temperature` | `number` | provider default |
| `maxTokens` | `number` | provider default |
| `maxRetries` | `number` | `3` |
| `retryInitialDelayMs` | `number` | `500` |
| `retryMaxDelayMs` | `number` | `8000` |
| `retryBackoffFactor` | `number` | `2` |

The `OpenAICompatAdapter` retries on `408 / 409 / 429 / 500 / 502 / 503 / 504` with exponential backoff + jitter, and respects `Retry-After`.

## AgentConfig

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | unique within the world |
| `role` | `"person" \| "control"` | governance vs. simulated person |
| `name` | `string` | display name |
| `description` | `string` | optional |
| `iterationsPerTick` | `number` | inner LLM loops per tick (default 1) |
| `systemPrompt` | `string` | the most important quality lever |
| `profile` | `AgentProfile` | personality, goals, backstory, location |
| `tools` | `AgentTool[]` | extra per-agent tools |
| `toolNames` | `string[]` | restrict plugin tools to a whitelist |
| `initialState` | `Partial<AgentInternalState>` | mood/energy/goals/beliefs |
| `schedule` | `ActivitySchedule` | per-agent activation pattern |
| `tokenBudget` | `TokenBudget` | `perTick / perHour / lifetime` + `policy` |
| `llm` | `Partial<LLMConfig>` | per-agent override |
| `llmTier` | `"full" \| "light"` | picks `world.lightLlm` if `light` |
| `neighborhood` | `{ maxContacts?, groups? }` | enables neighborhood routing |
| `alwaysThink` | `boolean` | force LLM call even when idle |
| `mcp` | `McpServerConfig[]` | MCP servers exposed as tools |

## TokenBudget

```ts
{
  perTick?: number;
  perHour?: number;
  lifetime?: number;
  policy?: "pause" | "degrade" | "stop";
}
```

`pause` halts the agent, `degrade` switches to a cheaper path, `stop` removes it from the active set.

## Plugin hooks (`WorldSimPlugin`)

| Hook | When |
| --- | --- |
| `onBootstrap(ctx, rules)` | once, before the loop |
| `onWorldTick(tick, ctx)` | every tick, before agents reason |
| `onAgentAction(action, state)` | per action, can return a transformed action (privacy redaction lives here) |
| `onAgentActionsBatch(actions, ctx)` | end of tick, batch view |
| `onAgentStatusChange(event, oldStatus, newStatus)` | pause/resume/stop |
| `onWorldStop(ctx, eventLog)` | once, after the loop |
| `onCrossWorldMessage(envelope, direction)` | federation only |

`tools: AgentTool[]` exposes plugin tools to every agent (or to the whitelist set by `agent.toolNames`).

## Message types

```ts
type MessageType =
  | "speak"           // public speech via MessageRouter
  | "observe"         // emitted by emit() / observations
  | "sms"             // PhonePlugin
  | "call_transcript" // PhonePlugin
  | "system";

interface Message {
  id: string;
  from: string;          // agent id or "" for system
  to: string;            // agent id, "*" for broadcast, "worldId:agentId" for federation
  type: MessageType;
  content: string;
  tick: number;
  metadata?: Record<string, unknown> & Partial<PhoneMessageMetadata>;
}
```

`MessageBus.publish(msg)` is the low-level entry point. Prefer `messageBus.broadcast`, `messageBus.publishToGroup`, or — better — let `MessageRouter` handle the cascade by setting `neighborhood`, `LocationIndex` + `defaultBroadcastRadius`, or active conversations.

## Privacy types (`WorldPrivacyConfig`)

```ts
interface WorldPrivacyConfig {
  regulatoryProfile: string;       // "gdpr", "ccpa", "custom-..."
  policyVersion?: string;
  consentMode: "soft_gate";
  defaults?: PrivacyCategoryRule;
  categories?: Partial<Record<PrivacyDataCategory, PrivacyCategoryRule>>;
  worldOverrides?: Record<string, { defaults?; categories? }>;
}

type PrivacyDataCategory =
  | "identity"
  | "memory"
  | "social_graph"
  | "telemetry"
  | "tool_inputs";

interface PrivacyCategoryRule {
  required?: boolean;
  retentionDays?: number;
  redactionLevel?: "none" | "partial" | "strict";
  allowExport?: boolean;
  allowToolUse?: boolean;
}
```

## PersistenceStore — privacy/audit surface

Optional methods that `privacyCompliancePlugin` uses when present:

- `upsertConsent(record)`
- `getConsent(worldId, subjectId, category)`
- `listConsents(worldId, opts?)`
- `savePolicyAudit(record)`
- `listPolicyAudits(worldId, opts?)`
- `estimateAgentStorageUsage(agentId, worldId)`
- `deleteAgentData(agentId, worldId)` — DSAR / right to be forgotten

`PgPersistenceStore` (in `src/stores/PgPersistenceStore.ts`) implements all of them.

## WorldEngine — public API

| Method | Use |
| --- | --- |
| `use(plugin)` | register a plugin |
| `addAgent(config)` | queue an agent (created at bootstrap) |
| `start()` / `stop()` / `pause()` / `resume()` | lifecycle |
| `pauseAgent(id, reason?)` / `resumeAgent(id)` / `stopAgent(id, reason?)` | runtime control |
| `agent(id)` / `getAgent(id)` | resolve `BaseAgent` |
| `getAgentStatuses()` | snapshot `Record<id, AgentStatus>` |
| `updateAgentPosition(id, lat, lng, label?)` | push GPS for `MovementPlugin` |
| `getStatus()` / `getContext()` / `getConfig()` / `getEventLog()` | read state |
| `getRulesContext()` / `getBrainMemory()` | introspection |
| `consolidate()` | manual memory consolidation pass |
| `createConversation(initiatorId, participantIds, topic?)` | private 1:N routing |
| `endConversation(id)` | close it |
| `getLocationIndex()` / `getNeighborhoodManager()` / `getConversationManager()` / `getMessageBus()` | low-level handles |
| `getTokenUsage(id)` / `getAllTokenUsage()` | per-agent token stats |
| `getFederationBus()` | when `federation` is set |

## Action types

```ts
type AgentActionType = "speak" | "observe" | "interact" | "tool_call" | "finish";

interface AgentAction {
  agentId: string;
  actionType: AgentActionType;
  payload: unknown;
  tick: number;
}
```

`ControlAgent`s emit `allowed | warned | blocked` evaluations; the `TickOrchestrator` logs them as `action:executed | action:warned | action:blocked` events on the event log.

## Files of interest

- `src/engine/WorldEngine.ts` — public engine class
- `src/engine/internal/TickOrchestrator.ts` — the tick pipeline
- `src/engine/BatchExecutor.ts` — concurrency cap
- `src/llm/OpenAICompatAdapter.ts` — LLM adapter with retry/backoff
- `src/llm/LLMAdapterPool.ts` — per-agent adapter resolution
- `src/agents/PersonAgent.ts` / `BaseAgent.ts` / `ControlAgent.ts` — agent classes
- `src/agents/internal/MessageRouter.ts` — conversation/neighborhood/proximity/broadcast cascade
- `src/messaging/MessageBus.ts` — pub/sub with per-tick indexes
- `src/plugins/built-in/PhonePlugin.ts` — SMS/calls
- `src/plugins/built-in/MovementPlugin.ts` — movement tools + policy hook
- `src/plugins/built-in/PrivacyCompliancePlugin.ts` — consent + redaction
- `src/types/WorldTypes.ts` / `AgentTypes.ts` / `PrivacyTypes.ts` — config types
