import { afterEach, describe, expect, it } from "vitest";
import { StudioServer } from "../../src/studio/StudioServer.js";

let nextPort = 23_000;
function allocPort(): number {
  return nextPort++;
}

describe("StudioServer report API", () => {
  let server: StudioServer | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await server.close();
      } catch {
        // ignore close race/errors in tests
      }
      server = null;
    }
  });

  it("exposes worlds endpoint in multi-world mode", async () => {
    const port = allocPort();
    server = new StudioServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/api/worlds`);
    expect(response.status).toBe(200);
    const body = await response.json() as { worlds: unknown[]; runs: unknown[] };
    expect(Array.isArray(body.worlds)).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it("validates compare endpoint query", async () => {
    const port = allocPort();
    server = new StudioServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/api/reports/compare`);
    expect(response.status).toBe(400);
    const body = await response.json() as { error?: string };
    expect(body.error).toContain("exactly 2");
  });
});
