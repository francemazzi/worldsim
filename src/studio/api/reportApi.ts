import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { SimulationReport } from "../../types/ReportTypes.js";

export function registerReportApi(
  router: StudioRouter,
  getReport: () => SimulationReport | null,
): void {
  router.get("/api/report", async (_req, res) => {
    const report = getReport();
    if (!report) {
      json(res, { ready: false, message: "Simulation still running or no report available." }, 202);
      return;
    }
    json(res, report);
  });
}
