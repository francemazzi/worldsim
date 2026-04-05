import type { StudioRouter } from "../StudioRouter.js";
import { json, readBody } from "../StudioRouter.js";
import type { PersistenceStore } from "../../types/PersistenceTypes.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";
import type { PrivacyConsentStatus, PrivacyDataCategory } from "../../types/PrivacyTypes.js";

export function registerPersistenceApi(
  router: StudioRouter,
  getPersistenceStore: () => PersistenceStore | undefined,
  getEngine: (worldId?: string) => WorldEngine | null,
): void {
  router.get("/api/conversations", async (_req, res, _params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store) {
      json(res, { error: "PersistenceStore not connected" }, 503);
      return;
    }

    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
    const agentId = query.agent;

    const opts: { limit?: number; agentId?: string } = { limit };
    if (agentId) opts.agentId = agentId;

    const conversations = await store.getConversations(worldId, opts);

    json(res, { conversations });
  });

  router.get("/api/agents/:id/snapshots", async (_req, res, params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store) {
      json(res, { error: "PersistenceStore not connected" }, 503);
      return;
    }

    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "20", 10), 100);

    const snapshots = await store.getStateHistory(agentId, worldId, limit);

    json(res, { snapshots });
  });

  router.get("/api/privacy/consents", async (_req, res, _params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store || typeof store.listConsents !== "function") {
      json(res, { error: "Consent persistence not supported" }, 503);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "100", 10), 500);
    const listOpts: {
      subjectId?: string;
      category?: PrivacyDataCategory;
      status?: PrivacyConsentStatus;
      limit?: number;
    } = { limit };
    if (query.subjectId) listOpts.subjectId = query.subjectId;
    if (query.category) listOpts.category = query.category as PrivacyDataCategory;
    if (query.status) listOpts.status = query.status as PrivacyConsentStatus;
    const consents = await store.listConsents(worldId, listOpts);
    json(res, { consents });
  });

  router.post("/api/privacy/consents", async (req, res, _params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store || typeof store.upsertConsent !== "function") {
      json(res, { error: "Consent persistence not supported" }, 503);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const body = (await readBody(req)) as {
      id: string;
      subjectId: string;
      category: PrivacyDataCategory;
      regulatoryProfile: string;
      policyVersion: string;
      status: PrivacyConsentStatus;
      source?: string;
    };
    if (!body?.id || !body?.subjectId || !body?.category || !body?.status) {
      json(res, { error: "Missing required consent fields" }, 400);
      return;
    }
    const now = new Date();
    await store.upsertConsent({
      id: body.id,
      worldId,
      subjectId: body.subjectId,
      category: body.category,
      regulatoryProfile: body.regulatoryProfile ?? "custom",
      policyVersion: body.policyVersion ?? "1",
      status: body.status,
      source: body.source,
      createdAt: now,
      updatedAt: now,
    });
    json(res, { ok: true });
  });

  router.get("/api/privacy/audits", async (_req, res, _params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store || typeof store.listPolicyAudits !== "function") {
      json(res, { error: "Policy audit persistence not supported" }, 503);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "200", 10), 1000);
    const listOpts: {
      agentId?: string;
      category?: PrivacyDataCategory;
      decision?: "allow" | "reduce" | "deny";
      limit?: number;
    } = { limit };
    if (query.agentId) listOpts.agentId = query.agentId;
    if (query.category) listOpts.category = query.category as PrivacyDataCategory;
    if (query.decision) listOpts.decision = query.decision as "allow" | "reduce" | "deny";
    const audits = await store.listPolicyAudits(worldId, listOpts);
    json(res, { audits });
  });

  router.get("/api/agents/:id/storage", async (_req, res, params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store || typeof store.estimateAgentStorageUsage !== "function") {
      json(res, { error: "Storage usage metrics not supported" }, 503);
      return;
    }
    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const usage = await store.estimateAgentStorageUsage(agentId, worldId);
    json(res, { usage });
  });

  router.post("/api/agents/:id/data/delete", async (_req, res, params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store || typeof store.deleteAgentData !== "function") {
      json(res, { error: "DSAR deletion not supported" }, 503);
      return;
    }
    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const deleted = await store.deleteAgentData(agentId, worldId);
    json(res, { deleted });
  });
}
