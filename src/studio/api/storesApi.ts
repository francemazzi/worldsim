import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { StudioCapabilities } from "../StoreDetector.js";

export function registerStoresApi(
  router: StudioRouter,
  getCapabilities: () => StudioCapabilities,
): void {
  router.get("/api/stores", async (_req, res) => {
    json(res, getCapabilities());
  });
}
