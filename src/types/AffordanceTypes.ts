/**
 * An affordance is "what an agent can do with this entity right now". It's
 * the bridge between perceived entities and the LLM tool surface: only
 * affordances of currently-perceived entities are exposed as tools.
 *
 * Affordances are intentionally simple and declarative. Complex side-effects
 * belong to plugins; this type only describes the *possibility* of an
 * action.
 */
export interface Affordance {
  /**
   * Verb-like identifier of the action: `"eat"`, `"sit"`, `"ride"`,
   * `"talk_to"`, `"open"`, `"hide_behind"`. Free-form, but plugins should
   * pick stable verbs so multiple entities can share an affordance vocab.
   */
  verb: string;
  /**
   * Optional human-readable description, surfaced to the LLM in the tool
   * description.
   */
  description?: string | undefined;
  /**
   * Required state on the actor (e.g. `["hands_free"]`) and on the target
   * (e.g. `["edible", "ripe"]`). The engine does not enforce these — they
   * are documentation hints. Plugins may inspect them to filter tools.
   */
  requires?:
    | {
        actor?: string[] | undefined;
        target?: string[] | undefined;
      }
    | undefined;
  /**
   * What the affordance produces, as a free-form list of effect labels. Used
   * by needs satisfiers and by the report layer to summarize behavior.
   */
  produces?: string[] | undefined;
  /**
   * Cost (energy, time, tokens) hint. Engine-agnostic; integrators can
   * encode their own cost model here.
   */
  cost?:
    | {
        energy?: number | undefined;
        ticks?: number | undefined;
      }
    | undefined;
  /**
   * Free metadata.
   */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * The set of affordances exposed by an entity. A simple array keyed by
 * `verb` for fast lookups.
 */
export type AffordanceMap = Affordance[];
