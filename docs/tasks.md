# PROMPT SISTEMA — Sviluppo pacchetto NPM `@worldsim/core`

> **Ruolo**: Sei un senior TypeScript engineer che progetta e implementa un pacchetto NPM open-source.
> **Obiettivo**: Costruire `@worldsim/core`, un motore astratto di simulazione multi-agente ispirato a MiroFish ma completamente plug-in, stateless, e integrabile in qualsiasi backend Node.js/TypeScript.

---

## VISION DEL PACCHETTO

`@worldsim/core` è un **Virtual World Emulator**: un motore di simulazione ad agenti che gira dentro il progetto host. Chi lo installa ottiene un sistema in cui:

1. Al bootstrap, agenti di **controllo** leggono file di regole (JSON + PDF) e costruiscono il loro contesto cognitivo.
2. Gli agenti **persona** operano come loop agentic LangGraph, interagendo tra loro e con il mondo.
3. Il motore è **completamente stateless** (nessuna cache, nessun DB proprio) — tutto lo stato è efimero e vive in RAM durante l'esecuzione.
4. L'integrazione avviene tramite **plugin registrabili** (tool, channel, hook).
5. Il pacchetto **non opina** su quale LLM usare: accetta qualsiasi provider compatibile con lo standard OpenAI SDK.
6. Ogni agente ha un **ciclo di vita controllabile** (`idle → running → paused → stopped`): il progetto host può accendere/spegnere agenti via API diretta, e i ControlAgent possono farlo autonomamente tramite il tool built-in `control_agent` nel loro LangGraph.

---

## FASE 0 — Struttura del pacchetto

### Task 0.1 — Scaffolding

Crea la seguente struttura di progetto:

```
worldsim-core/
├── src/
│   ├── index.ts                    # Entry point, re-esporta tutto
│   ├── engine/
│   │   ├── WorldEngine.ts          # Orchestratore principale
│   │   ├── WorldClock.ts           # Gestione tick/round della simulazione
│   │   └── WorldContext.ts         # Contesto condiviso efimero tra agenti
│   ├── agents/
│   │   ├── BaseAgent.ts            # Classe astratta base + state machine lifecycle
│   │   ├── AgentLifecycle.ts       # State machine isolata (idle→running→paused→stopped)
│   │   ├── ControlAgent.ts         # Agente governance, legge regole + tool control_agent
│   │   ├── PersonAgent.ts          # Agente persona, for-loop agentic con guard mid-loop
│   │   └── AgentRegistry.ts        # Registro runtime degli agenti attivi
│   ├── rules/
│   │   ├── RulesLoader.ts          # Carica JSON + PDF al bootstrap
│   │   ├── JsonRulesParser.ts      # Parser regole JSON
│   │   ├── PdfRulesParser.ts       # Parser PDF → testo → regole
│   │   └── RulesSchema.ts          # Zod schema per validazione regole
│   ├── graph/
│   │   ├── AgentGraph.ts           # Wrapper LangGraph StateGraph per agenti
│   │   ├── ControlGraph.ts         # Grafo per ControlAgent
│   │   └── PersonGraph.ts          # Grafo per PersonAgent
│   ├── messaging/
│   │   ├── MessageBus.ts           # Bus messaggi in-memory inter-agente
│   │   ├── Message.ts              # Tipo messaggio
│   │   └── Channel.ts              # Canale tipizzato
│   ├── plugins/
│   │   ├── PluginRegistry.ts       # Sistema di registrazione plugin
│   │   ├── PluginInterface.ts      # Interfaccia che ogni plugin deve implementare
│   │   └── hooks/
│   │       ├── OnAgentAction.ts    # Hook pre/post azione agente
│   │       ├── OnWorldTick.ts      # Hook per ogni tick del mondo
│   │       └── OnRulesLoaded.ts    # Hook dopo caricamento regole
│   ├── llm/
│   │   ├── LLMAdapter.ts           # Interfaccia astratta LLM
│   │   └── OpenAICompatAdapter.ts  # Implementazione OpenAI-compatible
│   └── types/
│       ├── AgentTypes.ts
│       ├── WorldTypes.ts
│       ├── RulesTypes.ts
│       └── PluginTypes.ts
├── tests/
│   ├── engine/
│   ├── agents/
│   └── rules/
├── examples/
│   ├── basic-world/
│   └── with-pdf-rules/
├── package.json
├── tsconfig.json
├── tsup.config.ts                  # Build con tsup (ESM + CJS dual output)
└── README.md
```

### Task 0.2 — `package.json`

```json
{
  "name": "@worldsim/core",
  "version": "0.1.0",
  "description": "Abstract virtual world emulator with LangGraph agents",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm run test"
  },
  "dependencies": {
    "@langchain/langgraph": "^0.2.x",
    "@langchain/core": "^0.3.x",
    "openai": "^4.x",
    "pdf-parse": "^1.1.x",
    "zod": "^3.x",
    "mitt": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsup": "^8.x",
    "vitest": "^1.x",
    "@types/node": "^20.x"
  },
  "peerDependencies": {
    "openai": "^4.x"
  },
  "keywords": [
    "agents",
    "multi-agent",
    "langgraph",
    "simulation",
    "ai",
    "swarm"
  ],
  "license": "MIT"
}
```

### Task 0.3 — `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## FASE 1 — Types e contratti core

### Task 1.1 — `src/types/WorldTypes.ts`

Definisci i tipi fondamentali del mondo:

```typescript
// Il contesto condiviso efimero — vive solo durante la simulazione
export interface WorldContext {
  worldId: string;
  tickCount: number;
  startedAt: Date;
  metadata: Record<string, unknown>;
  // Nessuna persistenza: tutto vive in RAM
}

export interface WorldConfig {
  worldId?: string;
  maxTicks?: number; // undefined = infinito
  tickIntervalMs?: number; // default 0 = as fast as possible
  maxConcurrentAgents?: number; // default 10
  llm: LLMConfig;
  rulesPath?: {
    json?: string[]; // glob patterns o path assoluti
    pdf?: string[];
  };
}

export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export type WorldStatus =
  | "idle"
  | "bootstrapping"
  | "running"
  | "paused"
  | "stopped";

export interface WorldEvent {
  type: string;
  tick: number;
  agentId?: string;
  payload: unknown;
  timestamp: Date;
}
```

### Task 1.2 — `src/types/AgentTypes.ts`

```typescript
export type AgentRole = "control" | "person";

// ── Lifecycle state machine ──────────────────────────────────────────────────
// idle → running → paused → running  (resume)
// running → stopped
// paused  → stopped
// stopped è terminale: nessuna transizione possibile
export type AgentStatus = "idle" | "running" | "paused" | "stopped";

// Evento emesso sul MessageBus quando un agente cambia stato.
// Il WorldEngine ascolta i messaggi to: 'world-engine' e applica la transizione.
export interface AgentControlEvent {
  type: "agent:start" | "agent:pause" | "agent:resume" | "agent:stop";
  agentId: string;
  requestedBy: string; // agentId richiedente, 'world-engine', o 'host'
  tick: number;
  reason?: string; // motivazione leggibile (utile per log e debug)
}

export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  description?: string;
  // Per PersonAgent: quante iterazioni per tick
  iterationsPerTick?: number;
  // Personalità/istruzioni base
  systemPrompt: string;
  // Tools disponibili (dai plugin)
  toolNames?: string[];
}

export interface AgentState {
  agentId: string;
  status: AgentStatus;
  currentMessages: AgentMessage[];
  loopCount: number;
  lastActionAt?: Date;
  // Stato efimero — reset ad ogni tick o round
  ephemeralMemory: Record<string, unknown>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface AgentAction {
  agentId: string;
  actionType: "speak" | "observe" | "interact" | "tool_call" | "finish";
  payload: unknown;
  tick: number;
}
```

### Task 1.3 — `src/types/RulesTypes.ts`

```typescript
export interface RuleSet {
  version: string;
  name: string;
  description?: string;
  rules: Rule[];
  source: "json" | "pdf";
  loadedAt: Date;
}

export interface Rule {
  id: string;
  priority: number; // 0 = massima priorità
  scope: "world" | "control" | "person" | "all";
  condition?: string; // espressione testuale della condizione
  instruction: string; // istruzione per il ControlAgent
  enforcement: "hard" | "soft"; // hard = blocca azione, soft = suggerisce
}

export interface RulesContext {
  ruleSets: RuleSet[];
  // Metodo per recuperare regole filtrate per scope e priorità
  getRulesForScope(scope: Rule["scope"]): Rule[];
  getRuleById(id: string): Rule | undefined;
}
```

### Task 1.4 — `src/types/PluginTypes.ts`

```typescript
import type { WorldContext, WorldEvent } from "./WorldTypes.ts";
import type {
  AgentAction,
  AgentState,
  AgentStatus,
  AgentControlEvent,
} from "./AgentTypes.ts";
import type { RulesContext } from "./RulesTypes.ts";

export interface WorldSimPlugin {
  name: string;
  version: string;
  // Lifecycle hooks
  onBootstrap?(ctx: WorldContext, rules: RulesContext): Promise<void>;
  onWorldTick?(tick: number, ctx: WorldContext): Promise<void>;
  onAgentAction?(action: AgentAction, state: AgentState): Promise<AgentAction>; // può modificare l'azione
  onRulesLoaded?(rules: RulesContext): Promise<void>;
  onWorldStop?(ctx: WorldContext, events: WorldEvent[]): Promise<void>;
  // Hook chiamato ogni volta che un agente cambia stato (start/pause/resume/stop)
  onAgentStatusChange?(
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ): Promise<void>;
  // Tools iniettabili negli agenti
  tools?: AgentTool[];
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute(input: unknown, ctx: WorldContext): Promise<unknown>;
}
```

---

## FASE 2 — Rules Loader (bootstrap)

### Task 2.1 — `src/rules/RulesSchema.ts`

Usa Zod per validare il formato JSON delle regole:

```typescript
import { z } from "zod";

export const RuleSchema = z.object({
  id: z.string(),
  priority: z.number().int().min(0).default(100),
  scope: z.enum(["world", "control", "person", "all"]),
  condition: z.string().optional(),
  instruction: z.string().min(1),
  enforcement: z.enum(["hard", "soft"]).default("soft"),
});

export const RuleSetSchema = z.object({
  version: z.string().default("1.0.0"),
  name: z.string(),
  description: z.string().optional(),
  rules: z.array(RuleSchema),
});

export type RuleSetInput = z.input<typeof RuleSetSchema>;
```

### Task 2.2 — `src/rules/JsonRulesParser.ts`

```typescript
// Legge e valida un file JSON di regole
// Signature: parseJsonRules(filePath: string): Promise<RuleSet>
// - Usa fs.readFile
// - Valida con RuleSetSchema.parse()
// - Aggiunge source: 'json' e loadedAt: new Date()
// - Lancia errore descrittivo se la validazione fallisce
```

### Task 2.3 — `src/rules/PdfRulesParser.ts`

```typescript
// Estrae testo da PDF e lo converte in RuleSet tramite LLM
// Signature: parsePdfRules(filePath: string, llm: LLMAdapter): Promise<RuleSet>
//
// Pipeline:
// 1. Usa pdf-parse per estrarre il testo grezzo dal PDF
// 2. Chunka il testo in blocchi da ~2000 token
// 3. Per ogni chunk, chiede all'LLM di estrarre regole nel formato JSON
//    usando questo system prompt:
//    "Sei un estrattore di regole. Dato questo testo, estrai tutte le regole,
//     linee guida, vincoli o istruzioni presenti e restituiscile ESCLUSIVAMENTE
//     come JSON valido nel seguente schema: { rules: Array<{id, priority, scope,
//     instruction, enforcement}> }. Non aggiungere spiegazioni."
// 4. Parsa il JSON, valida con RuleSchema per ogni regola
// 5. Deduplicazione per id (tiene quella con priority più bassa = più importante)
// 6. Restituisce RuleSet con source: 'pdf'
```

### Task 2.4 — `src/rules/RulesLoader.ts`

```typescript
// Classe principale del loader — usata dal WorldEngine al bootstrap
//
// class RulesLoader {
//   constructor(private llm: LLMAdapter) {}
//
//   async load(config: WorldConfig['rulesPath']): Promise<RulesContext>
//   - Carica in parallelo tutti i file JSON con Promise.all
//   - Carica in parallelo tutti i PDF con Promise.all
//   - Aggrega tutti i RuleSet in un unico RulesContext
//   - Ordina le regole per priorità
//   - Emette evento 'rules:loaded' sul MessageBus
//
//   private buildRulesContext(ruleSets: RuleSet[]): RulesContext
//   - Implementa getRulesForScope() e getRuleById()
// }
```

---

## FASE 3 — Agent Base e LangGraph integration

### Task 3.0 — `src/agents/AgentLifecycle.ts`

Classe isolata che implementa la state machine del ciclo di vita. Separata da `BaseAgent` per essere testabile indipendentemente e riutilizzabile:

```typescript
// Transizioni valide:
//   idle     → running  (via start)
//   running  → paused   (via pause)
//   running  → stopped  (via stop)
//   paused   → running  (via resume)
//   paused   → stopped  (via stop)
//   stopped  → ∅        (stato terminale, nessuna transizione)
//
// class AgentLifecycle {
//   private _status: AgentStatus = 'idle';
//
//   get current(): AgentStatus
//   get isActive(): boolean   // true solo se 'running'
//   get isTerminated(): boolean  // true se 'stopped'
//
//   // Tenta la transizione. Restituisce true se applicata, false se non valida.
//   // NON lancia eccezioni per transizioni non valide (es. resume() su stopped).
//   transition(action: 'start' | 'pause' | 'resume' | 'stop'): boolean
//
//   // Mappa azione → coppia (statusAttuale → statusSuccessivo)
//   private static TRANSITIONS: Record<
//     string,
//     Partial<Record<AgentStatus, AgentStatus>>
//   > = {
//     start:  { idle: 'running', paused: 'running' },
//     pause:  { running: 'paused' },
//     resume: { paused: 'running' },
//     stop:   { running: 'stopped', paused: 'stopped', idle: 'stopped' },
//   };
// }
```

### Task 3.1 — `src/graph/AgentGraph.ts`

Crea un wrapper generico su LangGraph StateGraph:

```typescript
// AgentGraph è il building block che ogni agente usa internamente.
// NON espone LangGraph direttamente all'utente finale del pacchetto.
//
// Struttura del grafo:
//
//  [START]
//     │
//  ┌──▼──────────────┐
//  │  think          │  ← chiama LLM con context + messages
//  └──────┬──────────┘
//         │ decision
//    ┌────┴────┐
//    │         │
// tool_call  finish
//    │
//  ┌─▼───────────────┐
//  │  execute_tool   │  ← esegue il tool, aggiunge risultato a messages
//  └──────┬──────────┘
//         │
//        [loop back to think]
//
// Lo StateAnnotation include:
// - messages: AgentMessage[]
// - loopCount: number
// - shouldFinish: boolean
// - toolResults: unknown[]
// - worldContext: WorldContext (readonly, passato dall'esterno)
//
// Il nodo 'think' usa shouldContinue per decidere se andare a 'execute_tool'
// o a '__end__'
// Il loop si interrompe quando: shouldFinish=true OR loopCount >= maxIterations
```

### Task 3.2 — `src/agents/BaseAgent.ts`

```typescript
// Classe astratta — non istanziabile direttamente.
// Incorpora AgentLifecycle per gestire il proprio stato.
//
// abstract class BaseAgent {
//   protected graph: AgentGraph;
//   protected config: AgentConfig;
//   protected bus: MessageBus;
//   private lifecycle: AgentLifecycle;   // state machine interna
//
//   constructor(config: AgentConfig, llm: LLMAdapter, bus: MessageBus)
//   // Al costruttore lo status è 'idle'. Il WorldEngine chiama start()
//   // dopo il bootstrap, non il costruttore stesso.
//
//   // ── Stato ─────────────────────────────────────────────────────────
//
//   get status(): AgentStatus
//   get isActive(): boolean     // shortcut: status === 'running'
//
//   // ── Controllo lifecycle ───────────────────────────────────────────
//   // Questi metodi sono pubblici: chiamabili da WorldEngine, ControlAgent
//   // (tramite tool control_agent) e dal progetto host.
//
//   start(): void
//   // lifecycle.transition('start')
//   // Emette AgentControlEvent { type: 'agent:start', ... } sul bus
//
//   pause(): void
//   // lifecycle.transition('pause')
//   // Emette AgentControlEvent { type: 'agent:pause', ... } sul bus
//
//   resume(): void
//   // lifecycle.transition('resume')
//   // Emette AgentControlEvent { type: 'agent:resume', ... } sul bus
//
//   stop(): void
//   // lifecycle.transition('stop')
//   // Emette AgentControlEvent { type: 'agent:stop', ... } sul bus
//   // Dopo stop() l'agente non esegue più tick
//
//   // ── Guard (usato nelle sottoclassi all'inizio di ogni tick) ────────
//
//   protected shouldSkipTick(): boolean
//   // return !this.lifecycle.isActive
//   // Se true, il tick ritorna [] immediatamente senza chiamare l'LLM
//
//   // ── Metodo chiamato dal WorldEngine ad ogni tick ────────────────────
//   abstract tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]>
//
//   // ── Utilities protette ─────────────────────────────────────────────
//
//   protected buildSystemPrompt(rules: RulesContext): string
//   // Combina: config.systemPrompt + regole scope 'all' + regole scope specifico
//
//   protected emit(event: WorldEvent): void
//   protected onMessage(handler: (msg: Message) => void): void
//
//   // Helper privato: pubblica un AgentControlEvent sul bus verso 'world-engine'
//   private emitLifecycleEvent(
//     type: AgentControlEvent['type'],
//     requestedBy: string,
//     tick: number,
//     reason?: string
//   ): void
// }
```

### Task 3.3 — `src/agents/ControlAgent.ts`

```typescript
// Il ControlAgent ha tre responsabilità:
//
// 1. BOOTSTRAP: al WorldEngine.start(), riceve tutte le RulesContext e le
//    "digerisce" costruendo una rappresentazione cognitiva interna.
//    Usa il suo LangGraph per eseguire un ciclo di reasoning:
//    "Date queste regole, quali sono i pattern critici che devo monitorare
//     durante la simulazione?"
//    Il risultato viene salvato nel suo ephemeralMemory come 'watchPatterns'.
//
// 2. RUNTIME: ad ogni tick, il ControlAgent:
//    a. Osserva TUTTE le AgentAction del tick corrente (via MessageBus)
//    b. Esegue il suo grafo LangGraph con tool 'evaluate_actions':
//       - Input: azioni del tick + watchPatterns + regole hard
//       - Output: lista di violazioni o approvazioni
//    c. Se trova una violazione 'hard': emette evento 'control:block'
//       e può chiamare il tool 'control_agent' per fermare il violatore
//    d. Se trova una violazione 'soft': emette evento 'control:warn'
//       con suggestion da iniettare nel contesto del PersonAgent violante
//
// 3. TOOL BUILT-IN 'control_agent': iniettato automaticamente nel grafo
//    LangGraph del ControlAgent. Non richiede configurazione esterna.
//    Il ControlAgent può chiamarlo per pause/resume/stop di qualsiasi PersonAgent.
//
// IMPORTANTE: Il ControlAgent NON ha stato persistente tra run diverse.
// I suoi watchPatterns vengono ricostruiti ogni volta dalle regole.
// Il ControlAgent stesso NON può essere fermato da altri ControlAgent
// (i controlli del tool 'control_agent' verificano role !== 'control').
//
// class ControlAgent extends BaseAgent {
//   async bootstrap(rules: RulesContext): Promise<void>
//   async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]>
//   async evaluateActions(actions: AgentAction[]): Promise<EvaluationResult[]>
//
//   // Tool iniettato automaticamente — NON esposto all'esterno
//   private readonly controlAgentTool: AgentTool = {
//     name: 'control_agent',
//     description: `Controlla il ciclo di vita di un PersonAgent.
//       Usa questo tool quando un agente viola regole 'hard' e deve essere
//       fermato, oppure quando un agente sospeso deve essere riattivato.
//       Azioni: 'pause' (temporaneo), 'resume' (riattiva), 'stop' (definitivo).
//       NON usare 'stop' a meno che la violazione sia critica e irreversibile.
//       NON usare su agenti con role='control'.`,
//     inputSchema: {
//       type: 'object',
//       properties: {
//         targetAgentId: { type: 'string' },
//         action: { type: 'string', enum: ['pause', 'resume', 'stop'] },
//         reason: { type: 'string' }
//       },
//       required: ['targetAgentId', 'action', 'reason']
//     },
//     async execute(input, ctx): Promise<{ success: boolean; message: string }> {
//       const { targetAgentId, action, reason } = input as {
//         targetAgentId: string; action: 'pause'|'resume'|'stop'; reason: string;
//       };
//       // Pubblica su MessageBus verso 'world-engine' — il WorldEngine
//       // intercetta questi messaggi in applyControlMessages() e applica
//       // la transizione sull'agente target.
//       this.bus.publish({
//         from: this.config.id,
//         to: 'world-engine',
//         type: 'system',
//         content: JSON.stringify({
//           type: `agent:${action}`,
//           agentId: targetAgentId,
//           requestedBy: this.config.id,
//           tick: ctx.tickCount,
//           reason,
//         } satisfies AgentControlEvent),
//         tick: ctx.tickCount,
//       });
//       return { success: true, message: `${action} richiesto per ${targetAgentId}: ${reason}` };
//     }
//   };
// }
//
// interface EvaluationResult {
//   actionId: string;
//   verdict: 'approved' | 'blocked' | 'warned';
//   reason?: string;
//   suggestion?: string;  // iniettata nel PersonAgent se 'warned'
// }
```

### Task 3.4 — `src/agents/PersonAgent.ts`

```typescript
// Il PersonAgent è un FOR LOOP AGENTICO.
// Ad ogni tick esegue N iterazioni del suo LangGraph interno.
//
// LIFECYCLE GUARD: il for loop rispetta lo stato ad ogni iterazione.
// Se il ControlAgent chiama control_agent('pause') o control_agent('stop')
// su questo agente durante un tick, il WorldEngine applica la transizione
// via applyControlMessages() e il loop si interrompe al controllo mid-loop.
//
// Il ciclo per ogni iterazione:
//   1. 'observe': legge dal MessageBus i messaggi destinati a questo agente
//      (da altri PersonAgent o dal ControlAgent come warnings)
//   2. 'think': chiama LLM con: systemPrompt + messaggi osservati + memoria efimera
//   3. 'act': esegue l'azione decisa (speak, interact, tool_call, finish)
//   4. 'broadcast': pubblica l'azione sul MessageBus per gli altri agenti
//
// La memoria efimera (ephemeralMemory) viene RESETTATA ad ogni tick.
//
// class PersonAgent extends BaseAgent {
//   private iterationsPerTick: number;
//
//   async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]> {
//     // Guard iniziale: agente non running → nessuna azione, nessuna LLM call
//     if (this.shouldSkipTick()) return [];
//
//     const actions: AgentAction[] = [];
//
//     for (let i = 0; i < this.iterationsPerTick; i++) {
//       // ── Guard MID-LOOP ────────────────────────────────────────────
//       // Controlla lo stato ad ogni iterazione.
//       // Un ControlAgent può aver chiamato pause() o stop() su questo agente
//       // mentre il tick era in corso. Il WorldEngine applica la transizione
//       // con applyControlMessages() che gira prima della fase di controllo,
//       // quindi questo break viene raggiunto nella stessa esecuzione del tick.
//       if (!this.isActive) break;
//
//       const action = await this.singleIteration(ctx, incomingMessages, i);
//       actions.push(action);
//     }
//
//     return actions;
//   }
//
//   private async singleIteration(
//     ctx: WorldContext,
//     incomingMessages: Message[],
//     iterationIndex: number
//   ): Promise<AgentAction>
// }
```

---

## FASE 4 — MessageBus

### Task 4.1 — `src/messaging/MessageBus.ts`

```typescript
// Bus messaggi in-memory, usa mitt (EventEmitter leggero).
// NON persiste nulla. Tutti i messaggi vivono solo durante il tick corrente.
//
// class MessageBus {
//   private emitter: ReturnType<typeof mitt>;
//   private tickMessages: Map<number, Message[]>;  // per tick corrente
//   private currentTick: number = 0;
//
//   // Chiamato dal WorldEngine all'inizio di ogni tick
//   newTick(tick: number): void
//   // Svuota i messaggi del tick precedente
//
//   // Pubblica un messaggio
//   publish(message: Message): void
//
//   // Sottoscrivi a messaggi destinati a un agente specifico
//   subscribe(agentId: string, handler: (msg: Message) => void): () => void
//   // Restituisce una funzione unsubscribe
//
//   // Recupera tutti i messaggi per un agente nel tick corrente
//   getMessages(agentId: string, tick: number): Message[]
//
//   // Broadcast a tutti
//   broadcast(message: Omit<Message, 'to'>): void
// }
//
// interface Message {
//   id: string;
//   from: string;       // agentId sorgente
//   to: string | '*';   // agentId destinatario o '*' per broadcast
//   type: 'speak' | 'warn' | 'block' | 'observe' | 'system';
//   content: string;
//   tick: number;
//   metadata?: Record<string, unknown>;
// }
```

---

## FASE 5 — WorldEngine (core orchestratore)

### Task 5.1 — `src/engine/WorldEngine.ts`

Questa è la classe principale. Implementala seguendo questa logica precisa:

```typescript
// class WorldEngine {
//   private status: WorldStatus = 'idle';
//   private config: WorldConfig;
//   private context: WorldContext;
//   private agentRegistry: AgentRegistry;
//   private messagebus: MessageBus;
//   private rulesContext: RulesContext | null = null;
//   private pluginRegistry: PluginRegistry;
//   private llm: LLMAdapter;
//   private controlAgents: ControlAgent[] = [];
//   private personAgents: PersonAgent[] = [];
//   private eventLog: WorldEvent[] = [];
//
//   constructor(config: WorldConfig)
//
//   // ── SETUP ──────────────────────────────────────────────────────
//
//   use(plugin: WorldSimPlugin): this
//   addAgent(config: AgentConfig): this
//
//   // ── LIFECYCLE MONDO ────────────────────────────────────────────
//
//   async start(): Promise<void>
//   // 1. status = 'bootstrapping'
//   // 2. Chiama RulesLoader.load(config.rulesPath)
//   // 3. Chiama plugin.onBootstrap() per ogni plugin
//   // 4. Chiama plugin.onRulesLoaded() per ogni plugin
//   // 5. Istanzia tutti gli agenti (ControlAgent e PersonAgent)
//   // 6. Chiama ControlAgent.bootstrap(rulesContext) per ogni control agent
//   // 7. Chiama agent.start() su tutti gli agenti → status 'idle' → 'running'
//   // 8. status = 'running'
//   // 9. Avvia il loop principale: runLoop()
//
//   async stop(): Promise<void>
//   // 1. status = 'stopped'
//   // 2. Chiama agent.stop() su tutti gli agenti ancora attivi
//   // 3. Chiama plugin.onWorldStop() per ogni plugin
//   // 4. Pulisce tutto: agentRegistry, messageBus, eventLog
//   // 5. NON salva nulla su disco
//
//   async pause(): Promise<void>
//   async resume(): Promise<void>
//
//   // ── CONTROLLO AGENTI — API pubblica per il progetto host ───────
//   // Queste chiamate sono sincrone: la transizione avviene immediatamente.
//   // L'effetto sul tick loop si manifesta alla prossima iterazione del guard.
//
//   // Restituisce l'agente per ID — lancia Error se non trovato
//   agent(id: string): BaseAgent
//
//   pauseAgent(id: string, reason?: string): this
//   // agent(id).pause()
//   // Emette WorldEvent { type: 'agent:paused', agentId: id, ... }
//   // Chiama plugin.onAgentStatusChange(event, 'running', 'paused')
//
//   resumeAgent(id: string): this
//   // agent(id).resume()
//   // Emette WorldEvent { type: 'agent:resumed', agentId: id, ... }
//   // Chiama plugin.onAgentStatusChange(event, 'paused', 'running')
//
//   stopAgent(id: string, reason?: string): this
//   // agent(id).stop()
//   // agentRegistry.remove(id)   ← rimosso dal pool attivo
//   // Emette WorldEvent { type: 'agent:stopped', agentId: id, ... }
//   // Chiama plugin.onAgentStatusChange(event, oldStatus, 'stopped')
//
//   // Snapshot di tutti gli stati — utile per il progetto host
//   getAgentStatuses(): Record<string, AgentStatus>
//
//   // ── LOOP PRINCIPALE ────────────────────────────────────────────
//
//   private async runLoop(): Promise<void>
//   // while (status === 'running' && tickCount < maxTicks) {
//   //   await this.executeTick()
//   //   if (tickIntervalMs > 0) await sleep(tickIntervalMs)
//   // }
//
//   private async executeTick(): Promise<void>
//   // 1. clock.increment()
//   // 2. messageBus.newTick(tick)
//   // 3. Plugin hook: onWorldTick(tick, context)
//   //
//   // 4. FASE AZIONE — solo PersonAgent con status='running' (p-limit per concurrency)
//   //    const allActions = await Promise.all(
//   //      personAgents
//   //        .filter(a => a.isActive)
//   //        .map(agent => agent.tick(context, rulesContext))
//   //    )
//   //
//   // 5. FASE CONTROLLO MESSAGGI — intercetta messaggi to:'world-engine'
//   //    this.applyControlMessages()
//   //    ← DEVE girare PRIMA di evaluateActions per garantire che le
//   //      transizioni richieste dal ControlAgent nello stesso tick
//   //      siano già applicate quando il log viene scritto
//   //
//   // 6. FASE VALUTAZIONE — ControlAgent valuta TUTTE le azioni
//   //    const evaluations = await Promise.all(
//   //      controlAgents.map(ca => ca.evaluateActions(allActions.flat()))
//   //    )
//   //
//   // 7. FASE APPLICAZIONE — Applica risultati:
//   //    - 'blocked': non propagate, log 'action:blocked'
//   //    - 'warned': warning iniettato come messaggio nel bus per il tick successivo
//   //    - 'approved': log 'action:executed'
//   //
//   // 8. Plugin hook: onAgentAction() per ogni azione approvata
//   //
//   // 9. ControlAgent.tick() per aggiornare il suo stato interno
//   //
//   // 10. Aggiorna WorldContext.tickCount
//
//   // ── INTERCETTORE MESSAGGI DI CONTROLLO ─────────────────────────
//
//   private applyControlMessages(): void
//   // Legge dal MessageBus tutti i messaggi con to: 'world-engine' nel tick corrente.
//   // Per ogni AgentControlEvent trovato:
//   //   1. Recupera l'agente target da agentRegistry
//   //   2. Registra oldStatus = agent.status
//   //   3. Applica la transizione: agent.pause() | agent.resume() | agent.stop()
//   //   4. Se 'stop': rimuove l'agente da agentRegistry e da personAgents[]
//   //   5. Scrive WorldEvent nel eventLog
//   //   6. Chiama plugin.onAgentStatusChange(event, oldStatus, newStatus)
//   //
//   // Nota: i messaggi di controllo vengono emessi dal tool 'control_agent'
//   // del ControlAgent e da BaseAgent.pause/resume/stop chiamati dall'host.
//
//   // ── QUERY API ──────────────────────────────────────────────────
//
//   getStatus(): WorldStatus
//   getContext(): Readonly<WorldContext>
//   getEventLog(): Readonly<WorldEvent[]>
//   getAgent(id: string): BaseAgent | undefined
// }
```

### Task 5.2 — `src/engine/WorldClock.ts`

```typescript
// Classe semplice per la gestione del tempo della simulazione
//
// class WorldClock {
//   private tick: number = 0;
//   private startedAt: Date = new Date();
//
//   increment(): number  // incrementa e restituisce il tick corrente
//   current(): number
//   elapsed(): number   // ms dall'inizio
//   reset(): void
// }
```

---

## FASE 6 — Plugin System

### Task 6.1 — `src/plugins/PluginRegistry.ts`

```typescript
// Gestisce la registrazione e l'esecuzione ordinata dei plugin
//
// class PluginRegistry {
//   private plugins: WorldSimPlugin[] = [];
//
//   register(plugin: WorldSimPlugin): void
//   // Controlla duplicati per plugin.name
//
//   // Esegue un hook su tutti i plugin in sequenza
//   async runHook<K extends keyof WorldSimPlugin>(
//     hookName: K,
//     ...args: Parameters<NonNullable<WorldSimPlugin[K]>>
//   ): Promise<void>
//
//   // Restituisce tutti i tool da tutti i plugin
//   getAllTools(): AgentTool[]
//
//   // Restituisce tool filtrati per nome
//   getToolsByNames(names: string[]): AgentTool[]
// }
```

### Task 6.2 — Plugin di esempio built-in: `ConsoleLoggerPlugin`

```typescript
// Plugin incluso nel pacchetto come utility opzionale.
// Logga su console gli eventi principali della simulazione,
// inclusi i cambi di stato degli agenti.
//
// export const ConsoleLoggerPlugin: WorldSimPlugin = {
//   name: 'console-logger',
//   version: '1.0.0',
//   async onWorldTick(tick, ctx) {
//     console.log(`[WorldSim] Tick ${tick} — World: ${ctx.worldId}`)
//   },
//   async onAgentAction(action, state) {
//     console.log(`[WorldSim] Agent ${action.agentId} [${state.status}]: ${action.actionType}`)
//     return action; // pass-through
//   },
//   async onAgentStatusChange(event, oldStatus, newStatus) {
//     const icons = { 'agent:start': '▶', 'agent:pause': '⏸', 'agent:resume': '▶', 'agent:stop': '⏹' };
//     const icon = icons[event.type] ?? '?';
//     console.log(
//       `[WorldSim] ${icon} Agent ${event.agentId}: ${oldStatus} → ${newStatus}` +
//       (event.reason ? ` (${event.reason})` : '') +
//       ` [by: ${event.requestedBy}]`
//     )
//   },
//   async onWorldStop(ctx, events) {
//     const byType = events.reduce<Record<string, number>>((acc, e) => {
//       acc[e.type] = (acc[e.type] ?? 0) + 1;
//       return acc;
//     }, {});
//     console.log(`[WorldSim] World stopped after ${ctx.tickCount} ticks`)
//     console.log(`[WorldSim] Events summary:`, byType)
//   }
// }
```

---

## FASE 7 — LLM Adapter

### Task 7.1 — `src/llm/LLMAdapter.ts`

```typescript
// Interfaccia astratta — il pacchetto non è legato a nessun provider
//
// interface LLMAdapter {
//   chat(messages: AgentMessage[], options?: ChatOptions): Promise<LLMResponse>
//   chatWithTools(
//     messages: AgentMessage[],
//     tools: AgentTool[],
//     options?: ChatOptions
//   ): Promise<LLMResponse>
// }
//
// interface ChatOptions {
//   temperature?: number;
//   maxTokens?: number;
//   model?: string; // override per questa chiamata
// }
//
// interface LLMResponse {
//   content: string;
//   toolCalls?: ToolCall[];
//   usage?: { inputTokens: number; outputTokens: number };
// }
//
// interface ToolCall {
//   id: string;
//   name: string;
//   arguments: Record<string, unknown>;
// }
```

### Task 7.2 — `src/llm/OpenAICompatAdapter.ts`

```typescript
// Implementazione concreta con openai SDK (funziona con OpenAI, Anthropic via
// proxy, Ollama, Qwen, qualsiasi provider OpenAI-compatible)
//
// class OpenAICompatAdapter implements LLMAdapter {
//   private client: OpenAI;
//   private defaultModel: string;
//
//   constructor(config: LLMConfig) {
//     this.client = new OpenAI({
//       baseURL: config.baseURL,
//       apiKey: config.apiKey,
//     });
//     this.defaultModel = config.model;
//   }
//
//   async chat(messages, options): Promise<LLMResponse>
//   // Converte AgentMessage[] in ChatCompletionMessageParam[]
//   // Chiama this.client.chat.completions.create()
//   // Restituisce LLMResponse normalizzato
//
//   async chatWithTools(messages, tools, options): Promise<LLMResponse>
//   // Come chat() ma aggiunge tools nel formato OpenAI function calling
//   // Gestisce tool_calls nella risposta
// }
```

---

## FASE 8 — Entry point e API pubblica

### Task 8.1 — `src/index.ts`

Esporta SOLO ciò che serve al progetto host:

```typescript
// Re-esportazioni pubbliche:
export { WorldEngine } from "./engine/WorldEngine.js";
export { ConsoleLoggerPlugin } from "./plugins/built-in/ConsoleLoggerPlugin.js";
export { OpenAICompatAdapter } from "./llm/OpenAICompatAdapter.js";

// Types
export type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
} from "./types/WorldTypes.js";
export type {
  AgentConfig,
  AgentAction,
  AgentRole,
  AgentStatus, // ← nuovo: per il progetto host che ispeziona stati
  AgentControlEvent, // ← nuovo: per plugin onAgentStatusChange
} from "./types/AgentTypes.js";
export type { RuleSet, Rule, RulesContext } from "./types/RulesTypes.js";
export type { WorldSimPlugin, AgentTool } from "./types/PluginTypes.js";

// NON esportare: BaseAgent, ControlAgent, PersonAgent (sono interni)
// NON esportare: MessageBus, AgentRegistry (sono interni)
// NON esportare: RulesLoader, parsers (sono interni al bootstrap)
// NON esportare: AgentLifecycle (è un dettaglio implementativo interno)
```

---

## FASE 9 — Esempio di utilizzo (README + examples/)

### Task 9.1 — `examples/basic-world/index.ts`

Scrivi un esempio completo che un utente può copiare nel suo progetto:

```typescript
import { WorldEngine, ConsoleLoggerPlugin } from "@worldsim/core";
import type { AgentControlEvent, AgentStatus } from "@worldsim/core";
import path from "path";

const world = new WorldEngine({
  worldId: "my-first-world",
  maxTicks: 20,
  tickIntervalMs: 500,
  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  },
  rulesPath: {
    json: [path.join(__dirname, "rules/*.json")],
    pdf: [path.join(__dirname, "rules/*.pdf")],
  },
});

// Plugin
world.use(ConsoleLoggerPlugin);

// Plugin custom che reagisce ai cambi di stato degli agenti
world.use({
  name: "lifecycle-observer",
  version: "1.0.0",
  async onAgentStatusChange(
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ) {
    if (newStatus === "stopped") {
      console.log(
        `⚠️  Agente ${event.agentId} fermato da ${event.requestedBy}: ${event.reason}`,
      );
    }
  },
});

// Agente di controllo — monitora le regole e può fermare gli agenti
world.addAgent({
  id: "governance-1",
  role: "control",
  name: "Governance Agent",
  systemPrompt: `Sei un agente di governance. Monitora le regole e usa il tool
    'control_agent' per sospendere agenti che le violano. Usa 'pause' per
    violazioni temporanee, 'stop' solo per violazioni critiche irreversibili.`,
});

// Agenti persona
for (let i = 0; i < 5; i++) {
  world.addAgent({
    id: `person-${i}`,
    role: "person",
    name: `Persona ${i}`,
    iterationsPerTick: 3,
    systemPrompt: `Sei una persona con personalità ${["curiosa", "scettica", "entusiasta", "cauta", "innovativa"][i]}.`,
  });
}

await world.start();

// ── Controllo esterno dal progetto host ─────────────────────────────────────

// Pausa un agente specifico al tick 5 (es. per manutenzione o test)
world.on("tick", (tick: number) => {
  if (tick === 5) {
    world.pauseAgent("person-2", "Fase di test: sospeso temporaneamente");
    console.log("Statuses:", world.getAgentStatuses());
  }

  // Riattiva al tick 8
  if (tick === 8) {
    world.resumeAgent("person-2");
  }

  // Ferma definitivamente al tick 15
  if (tick === 15) {
    world.stopAgent("person-4", "Missione completata");
  }
});

process.on("SIGINT", async () => {
  await world.stop();
  console.log("World stopped.");
  process.exit(0);
});
```

### Task 9.2 — `examples/basic-world/rules/sample-rules.json`

```json
{
  "version": "1.0.0",
  "name": "Base World Rules",
  "rules": [
    {
      "id": "rule-001",
      "priority": 1,
      "scope": "all",
      "instruction": "Gli agenti devono sempre comunicare in modo rispettoso e costruttivo.",
      "enforcement": "hard"
    },
    {
      "id": "rule-002",
      "priority": 10,
      "scope": "person",
      "instruction": "Gli agenti persona devono contribuire almeno una idea originale ogni 5 tick.",
      "enforcement": "soft"
    },
    {
      "id": "rule-003",
      "priority": 5,
      "scope": "control",
      "instruction": "Segnala immediatamente qualsiasi comportamento che violi le regole di priority 1-5.",
      "enforcement": "hard"
    }
  ]
}
```

---

## FASE 10 — Testing

### Task 10.1 — Test unitari critici da implementare

```
tests/
├── rules/
│   ├── JsonRulesParser.test.ts
│   │   ✓ Parsa correttamente un JSON valido
│   │   ✓ Lancia errore su JSON malformato
│   │   ✓ Lancia errore su schema non valido (manca 'instruction')
│   │   ✓ Assegna priority default = 100 se non specificata
│   │
│   └── RulesContext.test.ts
│       ✓ getRulesForScope('person') restituisce solo regole 'person' + 'all'
│       ✓ Le regole sono ordinate per priority crescente
│       ✓ getRuleById restituisce undefined per id inesistente
│
├── agents/
│   ├── AgentLifecycle.test.ts
│   │   ✓ Status iniziale è 'idle'
│   │   ✓ transition('start') da 'idle' → 'running', restituisce true
│   │   ✓ transition('pause') da 'running' → 'paused', restituisce true
│   │   ✓ transition('resume') da 'paused' → 'running', restituisce true
│   │   ✓ transition('stop') da 'running' → 'stopped', restituisce true
│   │   ✓ transition('stop') da 'paused' → 'stopped', restituisce true
│   │   ✓ transition('pause') da 'stopped' restituisce false (stato terminale)
│   │   ✓ transition('resume') da 'stopped' restituisce false
│   │   ✓ transition('start') da 'running' restituisce false (già running)
│   │   ✓ isActive è true solo quando status = 'running'
│   │   ✓ isTerminated è true solo quando status = 'stopped'
│   │
│   └── PersonAgent.test.ts
│       ✓ tick() ritorna [] se status = 'paused' (shouldSkipTick guard)
│       ✓ tick() ritorna [] se status = 'stopped'
│       ✓ il for loop si interrompe mid-loop se status cambia a 'paused'
│          durante l'esecuzione (simula un pause() esterno tra iterazioni)
│
├── messaging/
│   └── MessageBus.test.ts
│       ✓ newTick() svuota i messaggi del tick precedente
│       ✓ publish() + getMessages() funzionano sul tick corrente
│       ✓ getMessages('world-engine', tick) restituisce messaggi di controllo
│       ✓ broadcast() viene ricevuto da tutti i subscriber
│       ✓ unsubscribe() smette di ricevere messaggi
│
├── engine/
│   └── WorldEngine.test.ts
│       ✓ status passa da 'idle' → 'bootstrapping' → 'running' su start()
│       ✓ stop() porta status a 'stopped' e chiama agent.stop() su tutti
│       ✓ maxTicks viene rispettato: il loop si ferma dopo N tick
│       ✓ Agente con role='control' viene istanziato come ControlAgent
│       ✓ Plugin.onWorldTick viene chiamato ad ogni tick
│       ✓ pauseAgent(id) cambia status agente a 'paused'
│       ✓ resumeAgent(id) riporta status agente a 'running'
│       ✓ stopAgent(id) rimuove agente da agentRegistry
│       ✓ getAgentStatuses() restituisce snapshot corretto di tutti gli stati
│       ✓ applyControlMessages() applica transizione da messaggio ControlAgent
│       ✓ plugin.onAgentStatusChange() viene chiamato dopo ogni transizione
│
└── plugins/
    └── PluginRegistry.test.ts
        ✓ Plugin duplicati (stesso name) vengono rifiutati
        ✓ getAllTools() aggrega i tool da tutti i plugin
        ✓ runHook('onAgentStatusChange', ...) non lancia se hook non implementato
        ✓ runHook() su hook non implementato dal plugin non lancia errore
```

---

## PRINCIPI ARCHITETTURALI DA RISPETTARE IN TUTTO IL CODICE

1. **Zero persistenza nel pacchetto**: Il pacchetto NON usa mai `fs.writeFile`, database, Redis o qualsiasi storage. Tutto è in RAM. La persistenza è responsabilità del progetto host tramite plugin.

2. **Nessun singleton globale**: Tutte le dipendenze vengono iniettate via constructor. Il pacchetto può avere più istanze di WorldEngine attive contemporaneamente.

3. **Plugin-first**: Ogni funzionalità "opinionata" (logging, persistenza, UI) è un plugin. Il core è neutro.

4. **TypeScript strict**: Niente `any`. Niente `as` casting tranne dove strettamente necessario. Ogni funzione ha return type esplicito.

5. **Error handling esplicito**: Ogni errore asincrono viene wrappato con contesto. Usa `Result<T, E>` pattern dove opportuno invece di throw diretto.

6. **Import con estensione `.js`**: Compatibilità ESM pura. Tutti gli import interni usano `./file.js` (anche se il file è `.ts`).

7. **Niente dipendenze nascoste**: Il pacchetto non assume `process.env.OPENAI_API_KEY` o altre variabili d'ambiente. Tutto arriva via config esplicita.

---

## NOTE FINALI PER IL DEVELOPER

- Usa **`tsup`** per il build con dual output CJS+ESM. Config:

  ```typescript
  // tsup.config.ts
  export default {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
  };
  ```

- La versione `0.1.0` pubblica solo il core engine. Le fasi future (0.2.x) aggiungeranno:
  - `@worldsim/persistence` — plugin Redis/SQLite
  - `@worldsim/visualizer` — plugin SSE per stream eventi al frontend
  - `@worldsim/express` — middleware Express/Fastify per esporre REST API del mondo

- **Naming del pacchetto**: se si vuole pubblicare su npm sotto un'organizzazione personale, usare `@frasma/worldsim` invece di `@worldsim/core`.
