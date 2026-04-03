import { describe, it, expect } from "vitest";
import { BatchExecutor, type SettledResult } from "../../src/engine/BatchExecutor.js";

describe("BatchExecutor", () => {
  it("executes empty task array", async () => {
    const executor = new BatchExecutor(3);
    const results = await executor.execute([]);
    expect(results).toEqual([]);
  });

  it("returns results in order", async () => {
    const executor = new BatchExecutor(2);
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];
    const results = await executor.execute(tasks);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("respects concurrency limit", async () => {
    const executor = new BatchExecutor(2);
    let maxConcurrent = 0;
    let running = 0;

    const makeTask = (value: string, delayMs: number) => async () => {
      running++;
      if (running > maxConcurrent) maxConcurrent = running;
      await new Promise((r) => setTimeout(r, delayMs));
      running--;
      return value;
    };

    const tasks = [
      makeTask("a", 30),
      makeTask("b", 30),
      makeTask("c", 30),
      makeTask("d", 30),
    ];

    const results = await executor.execute(tasks);
    expect(results).toEqual(["a", "b", "c", "d"]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("with Infinity concurrency runs all in parallel", async () => {
    const executor = new BatchExecutor(Infinity);
    let maxConcurrent = 0;
    let running = 0;

    const makeTask = (value: string) => async () => {
      running++;
      if (running > maxConcurrent) maxConcurrent = running;
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return value;
    };

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const results = await executor.execute(tasks);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxConcurrent).toBe(3);
  });

  it("propagates errors", async () => {
    const executor = new BatchExecutor(2);
    const tasks = [
      () => Promise.resolve("ok"),
      () => Promise.reject(new Error("fail")),
      () => Promise.resolve("ok2"),
    ];
    await expect(executor.execute(tasks)).rejects.toThrow("fail");
  });

  describe("executeSettled", () => {
    it("returns empty array for empty tasks", async () => {
      const executor = new BatchExecutor(3);
      const results = await executor.executeSettled([]);
      expect(results).toEqual([]);
    });

    it("captures fulfilled results", async () => {
      const executor = new BatchExecutor(2);
      const tasks = [
        () => Promise.resolve("a"),
        () => Promise.resolve("b"),
      ];
      const results = await executor.executeSettled(tasks);
      expect(results).toEqual([
        { status: "fulfilled", value: "a", index: 0 },
        { status: "fulfilled", value: "b", index: 1 },
      ]);
    });

    it("captures rejected results without stopping other tasks", async () => {
      const executor = new BatchExecutor(2);
      const tasks = [
        () => Promise.resolve("ok"),
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve("also ok"),
      ];
      const results = await executor.executeSettled(tasks);

      expect(results[0]).toEqual({ status: "fulfilled", value: "ok", index: 0 });
      expect(results[1]).toEqual(
        expect.objectContaining({ status: "rejected", index: 1 }),
      );
      expect((results[1] as { error: Error }).error.message).toBe("boom");
      expect(results[2]).toEqual({ status: "fulfilled", value: "also ok", index: 2 });
    });

    it("handles all tasks failing", async () => {
      const executor = new BatchExecutor(2);
      const tasks = [
        () => Promise.reject(new Error("err1")),
        () => Promise.reject(new Error("err2")),
      ];
      const results = await executor.executeSettled(tasks);
      expect(results).toHaveLength(2);
      expect(results[0]!.status).toBe("rejected");
      expect(results[1]!.status).toBe("rejected");
    });

    it("works with Infinity concurrency", async () => {
      const executor = new BatchExecutor(Infinity);
      const tasks = [
        () => Promise.resolve("a"),
        () => Promise.reject(new Error("fail")),
        () => Promise.resolve("c"),
      ];
      const results = await executor.executeSettled(tasks);
      expect(results[0]!.status).toBe("fulfilled");
      expect(results[1]!.status).toBe("rejected");
      expect(results[2]!.status).toBe("fulfilled");
    });
  });
});
