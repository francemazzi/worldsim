import { describe, it, expect, vi } from "vitest";
import { privacyCompliancePlugin } from "../../src/plugins/built-in/PrivacyCompliancePlugin.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";

describe("privacyCompliancePlugin", () => {
  it("reduces tool_call actions when consent is missing in soft_gate mode", async () => {
    const plugin = privacyCompliancePlugin({
      privacyConfig: {
        regulatoryProfile: "gdpr",
        policyVersion: "v1",
        consentMode: "soft_gate",
        categories: {
          tool_inputs: { required: true, redactionLevel: "strict" },
        },
      },
      resolveConsent: async () => "rejected",
    });

    const action: AgentAction = {
      agentId: "agent-1",
      actionType: "tool_call",
      payload: { toolResults: [{ toolName: "calendar" }] },
      tick: 1,
    };

    const transformed = await plugin.onAgentAction!(
      action,
      {
        agentId: "agent-1",
        status: "running",
        currentMessages: [],
        loopCount: 0,
        ephemeralMemory: { worldId: "w1" },
      },
    );

    expect(transformed.actionType).toBe("observe");
    expect((transformed.payload as any).compliance.reasonCode).toBe("consent_missing");
  });

  it("writes audit entries through persistence store", async () => {
    const savePolicyAudit = vi.fn().mockResolvedValue(undefined);
    const plugin = privacyCompliancePlugin({
      privacyConfig: {
        regulatoryProfile: "custom-enterprise",
        policyVersion: "v2",
        consentMode: "soft_gate",
        categories: {
          memory: { required: true },
        },
      },
      resolveConsent: async () => "accepted",
      persistenceStore: {
        saveAgentConfig: vi.fn(),
        getAgentConfig: vi.fn(),
        listAgentConfigs: vi.fn(),
        saveMemoryEntry: vi.fn(),
        saveMemoryEntries: vi.fn(),
        getMemoryEntries: vi.fn(),
        deleteMemoryEntries: vi.fn(),
        countMemoryEntries: vi.fn(),
        saveStateSnapshot: vi.fn(),
        getLatestState: vi.fn(),
        getStateHistory: vi.fn(),
        saveConversation: vi.fn(),
        getConversations: vi.fn(),
        saveKnowledge: vi.fn(),
        getKnowledge: vi.fn(),
        deleteKnowledge: vi.fn(),
        savePolicyAudit,
      },
    });

    await plugin.onAgentActionsBatch!(
      [{
        agentId: "agent-1",
        actionType: "speak",
        payload: "hello",
        tick: 2,
      }],
      {
        worldId: "w1",
        tickCount: 2,
        startedAt: new Date(),
        metadata: {},
      },
    );

    expect(savePolicyAudit).toHaveBeenCalledOnce();
    expect(savePolicyAudit.mock.calls[0]?.[0]?.decision).toBe("allow");
  });
});
