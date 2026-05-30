import { z } from "zod";

/** Snapshot of the host-authenticated user passed into the overlay. */
export const hostUserSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
  roles: z.array(z.string()).default([]),
});

export const hostCapabilitiesSchema = z.object({
  canPost: z.boolean().default(true),
  canComment: z.boolean().default(true),
  canModerate: z.boolean().default(false),
  canViewModeration: z.boolean().default(false),
});

/** Host-provided session context for community features. */
export const hostSessionSchema = z.object({
  user: hostUserSchema,
  capabilities: hostCapabilitiesSchema.default({}),
  /** ISO timestamp when this snapshot was minted on the host. */
  issuedAt: z.string().datetime().optional(),
});

export type HostUser = z.infer<typeof hostUserSchema>;
export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>;
export type HostSession = z.infer<typeof hostSessionSchema>;
