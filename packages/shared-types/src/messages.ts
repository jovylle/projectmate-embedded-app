import { z } from "zod";
import { initConfigSchema } from "./init-config.js";
import { hostSessionSchema } from "./session.js";

export const PROTOCOL_VERSION = 1 as const;

export const hostToIframeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("PM_CONFIG"),
    payload: z.object({
      config: initConfigSchema,
      parentOrigin: z.string(),
      parentHref: z.string().optional(),
    }),
  }),
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("PM_CLOSE"),
    payload: z.object({}).optional(),
  }),
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("PM_HOST_SESSION"),
    payload: z.object({
      session: hostSessionSchema.nullable(),
    }),
  }),
]);

export const iframeToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("PM_READY"),
    payload: z.object({}).optional(),
  }),
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal("PM_REQUEST_CLOSE"),
    payload: z.object({}).optional(),
  }),
]);

export type HostToIframeMessage = z.infer<typeof hostToIframeMessageSchema>;
export type IframeToHostMessage = z.infer<typeof iframeToHostMessageSchema>;
