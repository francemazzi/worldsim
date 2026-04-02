import type { WorldContext } from "../../types/WorldTypes.js";

export type OnWorldTickHook = (
  tick: number,
  ctx: WorldContext,
) => Promise<void>;
