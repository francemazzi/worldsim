import type { StudioRouter } from "../StudioRouter.js";
import { json, readBody } from "../StudioRouter.js";
import { loadScenario, type ScenarioConfig } from "../ScenarioLoader.js";
import type { StudioServer } from "../StudioServer.js";
import type { LLMConfig } from "../../types/WorldTypes.js";

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  agentCount: number;
  maxTicks: number;
  scenario: ScenarioConfig;
}

export function registerScenarioApi(
  router: StudioRouter,
  getPresets: () => ScenarioPreset[],
  onStartScenario: (scenarioConfig: ScenarioConfig, llmConfig: LLMConfig) => Promise<{ started: boolean; error?: string }>,
): void {
  router.get("/api/scenarios", async (_req, res) => {
    const presets = getPresets();
    json(res, {
      presets: presets.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        agentCount: p.agentCount,
        maxTicks: p.maxTicks,
      })),
      hasApiKey: !!process.env.OPENAI_API_KEY,
    });
  });

  router.post("/api/scenario/start", async (req, res) => {
    try {
      const body = await readBody(req) as {
        presetId?: string;
        scenario?: ScenarioConfig;
        llm?: Partial<LLMConfig>;
      };

      const apiKey = body.llm?.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        json(res, { started: false, error: "No API key provided. Set OPENAI_API_KEY or pass llm.apiKey." }, 400);
        return;
      }

      const llmConfig: LLMConfig = {
        baseURL: body.llm?.baseURL ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
        apiKey,
        model: body.llm?.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini",
      };

      let scenario: ScenarioConfig;

      if (body.presetId) {
        const preset = getPresets().find((p) => p.id === body.presetId);
        if (!preset) {
          json(res, { started: false, error: `Preset '${body.presetId}' not found.` }, 404);
          return;
        }
        scenario = preset.scenario;
      } else if (body.scenario) {
        scenario = body.scenario;
      } else {
        json(res, { started: false, error: "Provide either presetId or scenario." }, 400);
        return;
      }

      const result = await onStartScenario(scenario, llmConfig);
      json(res, result, result.started ? 200 : 500);
    } catch (err) {
      json(res, { started: false, error: (err as Error).message }, 500);
    }
  });
}
