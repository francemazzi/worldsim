import { randomUUID } from "node:crypto";
import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { AgentAction, AgentState } from "../../types/AgentTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { PersistenceStore } from "../../types/PersistenceTypes.js";
import type {
  PrivacyConsentStatus,
  PrivacyDataCategory,
  PrivacyCategoryRule,
  WorldPrivacyConfig,
} from "../../types/PrivacyTypes.js";

export interface PrivacyCompliancePluginOptions {
  privacyConfig: WorldPrivacyConfig;
  persistenceStore?: PersistenceStore | undefined;
  /**
   * Optional custom consent resolver.
   * If omitted, the plugin queries persistenceStore.getConsent() when available.
   */
  resolveConsent?: (
    worldId: string,
    subjectId: string,
    category: PrivacyDataCategory,
  ) => Promise<PrivacyConsentStatus>;
}

function ruleForCategory(
  config: WorldPrivacyConfig,
  worldId: string,
  category: PrivacyDataCategory,
): PrivacyCategoryRule {
  const worldOverride = config.worldOverrides?.[worldId];
  return {
    ...config.defaults,
    ...worldOverride?.defaults,
    ...config.categories?.[category],
    ...worldOverride?.categories?.[category],
  };
}

function categoryForAction(action: AgentAction): PrivacyDataCategory {
  if (action.actionType === "tool_call") return "tool_inputs";
  if (action.actionType === "interact") return "social_graph";
  if (action.actionType === "observe") return "telemetry";
  return "memory";
}

function redactPayload(payload: unknown, level: "none" | "partial" | "strict"): unknown {
  if (level === "none") return payload;
  if (typeof payload === "string") {
    if (level === "strict") return "[REDACTED]";
    return payload.length > 24 ? `${payload.slice(0, 24)}...[REDACTED]` : "[REDACTED]";
  }
  if (payload == null || typeof payload !== "object") {
    return level === "strict" ? "[REDACTED]" : payload;
  }
  const clone = { ...(payload as Record<string, unknown>) };
  const keys = Object.keys(clone);
  for (const key of keys) {
    const sensitive = /content|summary|details|toolResults|text|message/i.test(key);
    if (sensitive) {
      clone[key] = "[REDACTED]";
    } else if (level === "strict") {
      delete clone[key];
    }
  }
  return level === "strict" ? { redacted: true } : clone;
}

async function resolveConsentStatus(
  options: PrivacyCompliancePluginOptions,
  worldId: string,
  subjectId: string,
  category: PrivacyDataCategory,
): Promise<PrivacyConsentStatus> {
  if (options.resolveConsent) {
    return options.resolveConsent(worldId, subjectId, category);
  }
  if (options.persistenceStore?.getConsent) {
    const existing = await options.persistenceStore.getConsent(worldId, subjectId, category);
    return existing?.status ?? "unset";
  }
  // Fallback when no consent backend is configured.
  return "accepted";
}

export function privacyCompliancePlugin(options: PrivacyCompliancePluginOptions): WorldSimPlugin {
  const config = options.privacyConfig;
  return {
    name: "privacy-compliance",
    version: "1.0.0",
    parallel: false,
    async onAgentAction(action: AgentAction, state: AgentState): Promise<AgentAction> {
      const worldId = typeof state.ephemeralMemory.worldId === "string"
        ? state.ephemeralMemory.worldId
        : "unknown";
      const category = categoryForAction(action);
      const rule = ruleForCategory(config, worldId, category);
      const consent = await resolveConsentStatus(options, worldId, action.agentId, category);
      const required = rule.required ?? false;
      const redactionLevel = rule.redactionLevel ?? "partial";

      // soft_gate: keep base chat alive, reduce advanced capabilities when consent is missing.
      if (config.consentMode === "soft_gate" && required && consent !== "accepted") {
        if (action.actionType === "tool_call" || rule.allowToolUse === false) {
          return {
            ...action,
            actionType: "observe",
            payload: {
              compliance: {
                decision: "reduce",
                reasonCode: "consent_missing",
                category,
              },
              content: "Tool usage is disabled until consent is granted for this data category.",
            },
          };
        }
        return {
          ...action,
          payload: {
            compliance: {
              decision: "reduce",
              reasonCode: "redacted",
              category,
            },
            originalType: action.actionType,
            content: redactPayload(action.payload, redactionLevel),
          },
        };
      }
      if (redactionLevel !== "none") {
        return {
          ...action,
          payload: redactPayload(action.payload, redactionLevel),
        };
      }
      return action;
    },
    async onAgentActionsBatch(actions: AgentAction[], ctx: WorldContext): Promise<void> {
      if (!options.persistenceStore?.savePolicyAudit) return;
      for (const action of actions) {
        const category = categoryForAction(action);
        const rule = ruleForCategory(config, ctx.worldId, category);
        const consent = await resolveConsentStatus(options, ctx.worldId, action.agentId, category);
        const required = rule.required ?? false;
        const decision = required && consent !== "accepted" ? "reduce" : "allow";
        await options.persistenceStore.savePolicyAudit({
          id: randomUUID(),
          worldId: ctx.worldId,
          agentId: action.agentId,
          category,
          decision,
          reasonCode: decision === "allow" ? "policy_ok" : "consent_missing",
          tick: action.tick,
          policyVersion: config.policyVersion,
          details: {
            actionType: action.actionType,
            regulatoryProfile: config.regulatoryProfile,
            consentMode: config.consentMode,
            consent,
          },
          timestamp: new Date(),
        });
      }
    },
  };
}
