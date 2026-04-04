import { ControlAgent } from "../../agents/ControlAgent.js";
import { PersonAgent } from "../../agents/PersonAgent.js";
import type { AgentStoreOptions } from "../../agents/BaseAgent.js";
import type { NeighborhoodConfig } from "../../graph/NeighborhoodManager.js";
import { BrainMemory } from "../../memory/BrainMemory.js";
import { TrackingLLMAdapter } from "../../llm/TrackingLLMAdapter.js";
import { RulesLoader, buildRulesContext } from "../../rules/RulesLoader.js";
import type { WorldEngineRuntime } from "./WorldEngineRuntime.js";

export class WorldBootstrapper {
  constructor(private runtime: WorldEngineRuntime) {}

  async bootstrap(): Promise<void> {
    const rulesLoader = new RulesLoader(this.runtime.llmPool.getWorldAdapter());
    this.runtime.rulesContext = this.runtime.config.rulesPath
      ? await rulesLoader.load(this.runtime.config.rulesPath)
      : buildRulesContext([]);

    await this.runtime.pluginRegistry.runHook(
      "onBootstrap",
      this.runtime.context,
      this.runtime.rulesContext,
    );
    await this.runtime.pluginRegistry.runHook(
      "onRulesLoaded",
      this.runtime.rulesContext,
    );

    // Auto-compose BrainMemory if vector or persistence store is provided
    if (
      this.runtime.config.memoryStore
      && (this.runtime.config.vectorStore || this.runtime.config.persistenceStore)
    ) {
      this.runtime.brainMemory = new BrainMemory({
        memoryStore: this.runtime.config.memoryStore,
        vectorStore: this.runtime.config.vectorStore,
        persistenceStore: this.runtime.config.persistenceStore,
        embeddingAdapter: this.runtime.config.embeddingAdapter,
        graphStore: this.runtime.config.graphStore,
        llm: this.runtime.llmPool.getWorldAdapter(),
        consolidation: this.runtime.config.consolidation,
      });
    }

    for (const agentConfig of this.runtime.pendingAgentConfigs) {
      const rawLlm = this.runtime.llmPool.getAdapter(agentConfig);
      const agentLlm = new TrackingLLMAdapter(
        rawLlm,
        agentConfig.id,
        this.runtime.tokenBudgetTracker,
      );

      const storeOptions: AgentStoreOptions = {
        memoryStore: this.runtime.config.memoryStore,
        graphStore: this.runtime.config.graphStore,
        vectorStore: this.runtime.config.vectorStore,
        persistenceStore: this.runtime.config.persistenceStore,
        embeddingAdapter: this.runtime.config.embeddingAdapter,
        assetStore: this.runtime.config.assetStore,
        brainMemory: this.runtime.brainMemory,
        activityScheduler: this.runtime.activityScheduler,
        tokenBudgetTracker: this.runtime.tokenBudgetTracker,
        neighborhoodManager: this.runtime.neighborhoodManager,
        conversationManager: this.runtime.conversationManager,
        locationIndex: this.runtime.locationIndex,
        defaultBroadcastRadius: this.runtime.config.defaultBroadcastRadius,
      };

      if (agentConfig.role === "control") {
        const agent = new ControlAgent(
          agentConfig,
          agentLlm,
          this.runtime.messageBus,
          storeOptions,
        );
        this.runtime.controlAgents.push(agent);
        this.runtime.agentRegistry.add(agent);
      } else {
        const agent = new PersonAgent(
          agentConfig,
          agentLlm,
          this.runtime.messageBus,
          storeOptions,
        );
        const pluginTools = agentConfig.toolNames
          ? this.runtime.pluginRegistry.getToolsByNames(agentConfig.toolNames)
          : this.runtime.pluginRegistry.getAllTools();
        agent.setTools(pluginTools);
        this.runtime.personAgents.push(agent);
        this.runtime.agentRegistry.add(agent);

        // Configure neighborhood if specified
        if (agentConfig.neighborhood) {
          const nhConfig: Partial<NeighborhoodConfig> = {};
          if (agentConfig.neighborhood.maxContacts != null) {
            nhConfig.maxContacts = agentConfig.neighborhood.maxContacts;
          }
          if (agentConfig.neighborhood.groups != null) {
            nhConfig.groups = agentConfig.neighborhood.groups;
          }
          this.runtime.neighborhoodManager.configure(agent.id, nhConfig);
        }

        // Register location if specified
        if (agentConfig.profile?.location) {
          const loc = agentConfig.profile.location.current
            ?? agentConfig.profile.location.home;
          if (loc) {
            this.runtime.locationIndex.update(agent.id, loc);
          }
        }
      }
    }

    for (const ca of this.runtime.controlAgents) {
      ca.start(0);
      await ca.bootstrap(this.runtime.rulesContext);
    }

    for (const pa of this.runtime.personAgents) {
      pa.start(0);
    }
  }
}
