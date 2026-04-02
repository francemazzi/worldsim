import { describe, it, expect, beforeEach } from "vitest";
import { ConversationManager } from "../../src/messaging/ConversationManager.js";

describe("ConversationManager", () => {
  let manager: ConversationManager;

  beforeEach(() => {
    manager = new ConversationManager(5);
  });

  describe("startConversation", () => {
    it("creates a conversation with initiator as first speaker", () => {
      const conv = manager.startConversation("alice", ["bob", "charlie"], "weather");
      expect(conv.initiatorId).toBe("alice");
      expect(conv.currentSpeakerId).toBe("alice");
      expect(conv.participantIds).toEqual(["alice", "bob", "charlie"]);
      expect(conv.topic).toBe("weather");
      expect(conv.status).toBe("active");
      expect(conv.turnNumber).toBe(0);
    });

    it("deduplicates initiator from participants", () => {
      const conv = manager.startConversation("alice", ["alice", "bob"]);
      expect(conv.participantIds).toEqual(["alice", "bob"]);
    });
  });

  describe("canSpeak", () => {
    it("allows agents not in any conversation", () => {
      const result = manager.canSpeak("nobody");
      expect(result.allowed).toBe(true);
    });

    it("allows the current speaker", () => {
      manager.startConversation("alice", ["bob"]);
      expect(manager.canSpeak("alice").allowed).toBe(true);
    });

    it("blocks non-current speaker in conversation", () => {
      manager.startConversation("alice", ["bob"]);
      const result = manager.canSpeak("bob");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("alice");
    });
  });

  describe("advanceTurn", () => {
    it("moves to next participant (round-robin)", () => {
      const conv = manager.startConversation("alice", ["bob", "charlie"], undefined, 0);

      // Alice speaks, advances to Bob
      manager.advanceTurn(conv.id, "alice", 0);
      expect(manager.getCurrentSpeaker(conv.id)).toBe("bob");

      // Bob speaks, advances to Charlie
      manager.advanceTurn(conv.id, "bob", 1);
      expect(manager.getCurrentSpeaker(conv.id)).toBe("charlie");

      // Charlie speaks, wraps to Alice
      manager.advanceTurn(conv.id, "charlie", 2);
      expect(manager.getCurrentSpeaker(conv.id)).toBe("alice");
    });

    it("ignores advance from wrong speaker", () => {
      const conv = manager.startConversation("alice", ["bob"]);
      manager.advanceTurn(conv.id, "bob", 0); // Bob can't advance, it's Alice's turn
      expect(manager.getCurrentSpeaker(conv.id)).toBe("alice");
    });

    it("ends conversation when maxTurns reached", () => {
      const conv = manager.startConversation("alice", ["bob"], undefined, 0);
      conv.maxTurns = 2;
      manager.advanceTurn(conv.id, "alice", 0);
      manager.advanceTurn(conv.id, "bob", 1);
      // After 2 turns, conversation should be ended
      const updated = manager.getConversation(conv.id);
      expect(updated?.status).toBe("ended");
    });
  });

  describe("endConversation", () => {
    it("frees all participants", () => {
      const conv = manager.startConversation("alice", ["bob"]);
      manager.endConversation(conv.id);
      expect(manager.canSpeak("alice").allowed).toBe(true);
      expect(manager.canSpeak("bob").allowed).toBe(true);
    });
  });

  describe("tickCleanup", () => {
    it("removes stale conversations", () => {
      const conv = manager.startConversation("alice", ["bob"], undefined, 0);
      // No turns advanced, staleThreshold=5, tick 6 should clean up
      manager.tickCleanup(6);
      expect(manager.getConversation(conv.id)).toBeUndefined();
      expect(manager.canSpeak("alice").allowed).toBe(true);
    });

    it("keeps active conversations within threshold", () => {
      const conv = manager.startConversation("alice", ["bob"], undefined, 0);
      manager.tickCleanup(3);
      expect(manager.getConversation(conv.id)?.status).toBe("active");
    });
  });

  describe("getConversationForAgent", () => {
    it("returns active conversation", () => {
      const conv = manager.startConversation("alice", ["bob"]);
      expect(manager.getConversationForAgent("alice")?.id).toBe(conv.id);
    });

    it("returns undefined for ended conversation", () => {
      const conv = manager.startConversation("alice", ["bob"]);
      manager.endConversation(conv.id);
      expect(manager.getConversationForAgent("alice")).toBeUndefined();
    });
  });

  describe("activeCount", () => {
    it("counts active conversations", () => {
      expect(manager.activeCount).toBe(0);
      manager.startConversation("a", ["b"]);
      expect(manager.activeCount).toBe(1);
      const conv2 = manager.startConversation("c", ["d"]);
      expect(manager.activeCount).toBe(2);
      manager.endConversation(conv2.id);
      expect(manager.activeCount).toBe(1);
    });
  });
});
