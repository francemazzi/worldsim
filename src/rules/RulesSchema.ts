import { z } from "zod";

export const RuleSchema = z.object({
  id: z.string(),
  priority: z.number().int().min(0).default(100),
  scope: z.enum(["world", "control", "person", "all"]),
  condition: z.string().optional(),
  instruction: z.string().min(1),
  enforcement: z.enum(["hard", "soft"]).default("soft"),
});

export const RuleSetSchema = z.object({
  version: z.string().default("1.0.0"),
  name: z.string(),
  description: z.string().optional(),
  rules: z.array(RuleSchema),
});

export type RuleSetInput = z.input<typeof RuleSetSchema>;
