import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";

/**
 * Read-only API for the realistic-simulation primitives. Surfaces topics,
 * stimuli and recent percepts so the Studio dashboard can show *what an
 * agent actually heard* — the most powerful debugging signal when running
 * in `interaction.mode = "perception"`.
 */
export function registerPerceptionApi(
  router: StudioRouter,
  getEngine: (worldId?: string) => WorldEngine | null,
): void {
  router.get("/api/perception/status", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const cfg = engine.getConfig().interaction ?? {};
    json(res, {
      enabled: cfg.mode === "perception",
      mode: cfg.mode ?? "legacy",
      defaultSenses: cfg.defaultSenses ?? null,
      topicWindowTicks: cfg.topicWindowTicks ?? 5,
      currentTick: engine.getContext().tickCount,
    });
  });

  router.get("/api/perception/stimuli", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const tick = query.tick ? Number(query.tick) : engine.getContext().tickCount;
    const stimuli = engine.getStimulusBus().getForTick(tick);
    json(res, {
      tick,
      stimuli: stimuli.map((s) => ({
        id: s.id,
        kind: s.kind,
        channel: s.channel,
        source: s.source,
        intensity: s.intensity,
        topicId: s.topicId ?? null,
        causedByStimulusId: s.causedByStimulusId ?? null,
        payload: s.payload,
      })),
    });
  });

  router.get("/api/perception/topics", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const tick = query.tick ? Number(query.tick) : engine.getContext().tickCount;
    const tracker = engine.getTopicTracker();
    const topics = tracker.openTopicsAt(tick).map((t) => ({
      id: t.id,
      label: t.label ?? null,
      rootStimulusId: t.rootStimulusId,
      startTick: t.startTick,
      lastTick: t.lastTick,
      participants: [...t.participants],
      stimulusCount: t.stimulusIds.length,
    }));
    json(res, { tick, topics });
  });

  router.get("/api/perception/percepts/:agentId", async (_req, res, params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const agentId = params.agentId;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const tick = query.tick ? Number(query.tick) : engine.getContext().tickCount;
    const percepts = engine
      .getPerceptionEngine()
      .perceiveFor(agentId, engine.getStimulusBus(), tick);
    json(res, {
      agentId,
      tick,
      percepts: percepts.map((p) => ({
        stimulusId: p.stimulus.id,
        kind: p.stimulus.kind,
        via: p.via,
        from: p.stimulus.source,
        distanceKm: p.distanceKm,
        perceivedIntensity: p.perceivedIntensity,
        intelligibility: p.intelligibility ?? null,
        topicId: p.stimulus.topicId ?? null,
        payload: p.stimulus.payload,
      })),
    });
  });

  router.get("/api/perception/needs/:agentId", async (_req, res, params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const agentId = params.agentId;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const ns = engine.getNeedsTracker().get(agentId);
    if (!ns) {
      json(res, { agentId, needs: [] });
      return;
    }
    json(res, {
      agentId,
      needs: ns.needs.map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        value: n.value,
        activationThreshold: n.activationThreshold ?? 0.5,
        criticalThreshold: n.criticalThreshold ?? 0.9,
        active: n.value >= (n.activationThreshold ?? 0.5),
      })),
    });
  });
}
