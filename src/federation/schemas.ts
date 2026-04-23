import { z } from "zod";

export const worldCapabilitySchema = z.enum(["messaging", "calls", "travel"]);

export const worldNodeSchema = z.object({
  worldId: z.string().min(1),
  displayName: z.string().min(1),
  coordinates: z
    .object({ lat: z.number(), lng: z.number() })
    .optional(),
  capabilities: z.array(worldCapabilitySchema),
  endpoint: z.string().optional(),
});

export const crossWorldChannelSchema = z.enum([
  "sms",
  "email",
  "call_request",
  "call_turn",
  "system",
]);

export const crossWorldEnvelopeSchema = z.object({
  id: z.string().min(1),
  fromWorldId: z.string().min(1),
  toWorldId: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  channel: crossWorldChannelSchema,
  payload: z.unknown(),
  sentAtTick: z.number().int().nonnegative(),
  sentAtRealTime: z.string().min(1),
  correlationId: z.string().optional(),
});

export const travelModeSchema = z.enum(["car", "train", "plane", "walk"]);

export const travelOptionSchema = z.object({
  kind: travelModeSchema,
  estimatedTicks: z.number().int().nonnegative(),
  energyCost: z.number().nonnegative(),
});

export const travelEdgeSchema = z.object({
  fromWorldId: z.string().min(1),
  toWorldId: z.string().min(1),
  modes: z.array(travelOptionSchema).min(1),
});
