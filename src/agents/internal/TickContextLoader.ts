import type { TickContext } from "../BaseAgent.js";
import type { AgentInternalState } from "../../types/AgentTypes.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import type { MemoryStore } from "../../types/MemoryTypes.js";
import type { GraphStore } from "../../types/GraphTypes.js";
import type { AssetStore } from "../../types/AssetTypes.js";
import type { BrainMemory } from "../../memory/BrainMemory.js";
import type { ConversationManager } from "../../messaging/ConversationManager.js";

export interface TickContextLoaderDeps {
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
  assetStore?: AssetStore | undefined;
  brainMemory?: BrainMemory | undefined;
  conversationManager?: ConversationManager | undefined;
}

/**
 * Loads the per-tick context an agent needs to produce its next action
 * (recent memories, relevant semantic memories, consolidated knowledge,
 * relationships, household/venue/assets) and exposes lightweight idle
 * detection. Extracted from PersonAgent to honour SRP.
 */
export class TickContextLoader {
  constructor(
    private readonly agentId: string,
    private readonly bus: MessageBus,
    private readonly deps: TickContextLoaderDeps,
  ) {}

  /**
   * Returns a fully populated {@link TickContext} for the current agent.
   *
   * @param degraded When true, reduces memory/relationship window sizes
   *   and skips semantic recall + knowledge (used during token-budget
   *   degradation or for `llmTier === "light"` agents).
   */
  async load(degraded: boolean, currentSituation: string): Promise<TickContext> {
    const memoryLimit = degraded ? 5 : 20;
    const relLimit = degraded ? 3 : 10;

    if (this.deps.brainMemory) {
      const [recallResult, relationships] = await Promise.all([
        this.deps.brainMemory.recall({
          agentId: this.agentId,
          recentLimit: memoryLimit,
          semanticQuery: currentSituation,
          semanticTopK: degraded ? 0 : 5,
          includeKnowledge: !degraded,
        }),
        this.deps.graphStore
          ? this.deps.graphStore.getRelationships({
              agentId: this.agentId,
              limit: relLimit,
            })
          : Promise.resolve([]),
      ]);

      const tickCtx: TickContext = {
        memories: recallResult.memories,
        relationships,
        knowledge: degraded ? undefined : recallResult.knowledge,
      };

      await this.enrichWithAssets(tickCtx);
      return tickCtx;
    }

    const [memories, relationships] = await Promise.all([
      this.deps.memoryStore
        ? this.deps.memoryStore.getRecent(this.agentId, memoryLimit)
        : Promise.resolve([]),
      this.deps.graphStore
        ? this.deps.graphStore.getRelationships({
            agentId: this.agentId,
            limit: relLimit,
          })
        : Promise.resolve([]),
    ]);

    const tickCtx: TickContext = { memories, relationships };
    await this.enrichWithAssets(tickCtx);
    return tickCtx;
  }

  /**
   * Lightweight heuristic: does the agent have anything worth an LLM call
   * this tick? Returns true when the agent can safely rest (no incoming
   * messages, no goals, low energy, and not in an active conversation).
   */
  isIdle(tick: number, state: AgentInternalState): boolean {
    if (this.bus.getMessageCount(this.agentId, tick) > 0) return false;
    if (state.goals.length > 0) return false;
    if (state.energy > 30) return false;

    if (this.deps.conversationManager) {
      const conv = this.deps.conversationManager.getConversationForAgent(this.agentId);
      if (conv) return false;
    }

    return true;
  }

  private async enrichWithAssets(tickCtx: TickContext): Promise<void> {
    const store = this.deps.assetStore;
    if (!store) return;

    const [agentAssets, household, currentVenue, householdAssets, communityAssets] =
      await Promise.all([
        store.getAgentAssets(this.agentId),
        store.getAgentHousehold(this.agentId),
        store.getAgentCurrentVenue(this.agentId),
        store.getAgentHousehold(this.agentId).then((h) =>
          h ? store.getHouseholdAssets(h.id) : [],
        ),
        store.getCommunityAssets(),
      ]);

    tickCtx.assets = [...agentAssets, ...householdAssets, ...communityAssets];
    tickCtx.household = household ?? undefined;
    tickCtx.currentVenue = currentVenue ?? undefined;
  }
}
