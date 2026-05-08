import { z } from "zod";

export const themeModeSchema = z.enum(["light", "dark", "auto"]);

export const featuresSchema = z
  .object({
    chat: z.boolean().default(false),
    feedback: z.boolean().default(true),
    updates: z.boolean().default(true),
    issues: z.boolean().default(false),
    about: z.boolean().default(true),
  })
  .default({
    chat: false,
    feedback: true,
    updates: true,
    issues: false,
    about: true,
  });

export const customSectionSchema = z.object({
  title: z.string(),
  /** Markdown or plain text; host/iframe sanitizes before HTML */
  content: z.string(),
});

export const hostMetaSchema = z.object({
  /** Stable host/tenant identifier (e.g. acme-prod) */
  id: z.string().min(1),
  /** Human-friendly host name */
  name: z.string().min(1),
  /** Host-provided current app/site version to display in overlay */
  version: z.string().min(1),
  environment: z.enum(["development", "staging", "production"]).optional().default("production"),
  plan: z.string().optional(),
  region: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  supportEmail: z.string().email().optional(),
  /** Per-host module toggles for UI metadata (separate from `features` behavior toggles). */
  modules: z.record(z.boolean()).optional().default({}),
  /** Optional role mapping, e.g. { admin: ["view", "manage"], viewer: ["view"] } */
  permissions: z.record(z.array(z.string())).optional().default({}),
});

export const multiHostSchema = z.object({
  enabled: z.boolean().optional().default(false),
  activeHostId: z.string().optional(),
  totalHosts: z.number().int().positive().optional(),
  canSwitchHosts: z.boolean().optional(),
  benchmarkLabel: z.string().optional(),
});

export const changelogEntrySchema = z.object({
  version: z.string(),
  date: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const autoOpenSchema = z
  .object({
    /** Match `location.hash` after stripping `#` (config may include or omit leading `#`). */
    hash: z.string().min(1).optional(),
    /** Match a query param; if `value` is set it must match exactly, otherwise any non-empty value matches. */
    query: z
      .object({
        name: z.string().min(1),
        value: z.string().optional(),
      })
      .optional(),
    /** Match `location.pathname` (exact, or prefix when `pathMatch` is `prefix`). */
    path: z.string().min(1).regex(/^\//).optional(),
    pathMatch: z.enum(["exact", "prefix"]).optional().default("prefix"),
  })
  .optional();

export const initConfigSchema = z.object({
  projectId: z.string(),
  /** Full URL of the hosted overlay app (iframe src), e.g. https://projectmate.uft1.com/overlay/ */
  appUrl: z.string().url(),
  github: z.string().optional(),
  about: z
    .object({
      title: z.string(),
      description: z.string(),
    })
    .optional(),
  links: z
    .record(z.string(), z.string().url())
    .optional()
    .default({}),
  customSections: z.array(customSectionSchema).optional().default([]),
  /** Host/tenant metadata for multi-host overlays. */
  host: hostMetaSchema.optional(),
  /** Optional aggregate metadata when serving multiple hosts/workspaces. */
  multiHost: multiHostSchema.optional(),
  /** Optional quotes shown in About; overlay picks one at random on load. */
  quotes: z.array(z.string().min(1)).optional().default([]),
  features: featuresSchema,
  theme: themeModeSchema.optional().default("auto"),
  /** CSS color, e.g. #6366f1 */
  accentColor: z.string().optional(),
  /** Optional feedback POST URL (BYO backend) */
  feedbackEndpoint: z.string().url().optional(),
  /**
   * Optional Web3Forms config — zero-backend feedback via web3forms.com.
   * The `accessKey` is public-by-design; the overlay will POST to
   * https://api.web3forms.com/submit. Takes precedence over `feedbackEndpoint`.
   */
  web3forms: z
    .object({
      accessKey: z.string().min(1),
      subject: z.string().optional(),
      fromName: z.string().optional(),
    })
    .optional(),
  /** Static changelog for Phase 1 */
  changelog: z.array(changelogEntrySchema).optional().default([]),
  launcher: z
    .object({
      /** When true, the floating launcher button is not rendered. Use with `autoOpen` or `ProjectMate.open()` to trigger the overlay. */
      hidden: z.boolean().optional().default(false),
      position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).default("bottom-right"),
      offsetX: z.number().default(16),
      offsetY: z.number().default(16),
      label: z.string().optional(),
    })
    .optional()
    .default({ hidden: false, position: "bottom-right", offsetX: 16, offsetY: 16 }),
  /** When the host URL matches any rule, open the overlay automatically (also on `hashchange` / `popstate`). */
  autoOpen: autoOpenSchema,
});

export type InitConfig = z.infer<typeof initConfigSchema>;
export type AutoOpenConfig = z.infer<typeof autoOpenSchema>;
export type ThemeMode = z.infer<typeof themeModeSchema>;
export type Features = z.infer<typeof featuresSchema>;
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;
