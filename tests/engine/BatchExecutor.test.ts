import { describe, it, expect } from "vitest";
import { BatchExecutor } from "../../src/engine/BatchExecutor.js";

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
});
