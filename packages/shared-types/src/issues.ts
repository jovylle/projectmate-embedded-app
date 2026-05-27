import { z } from "zod";

export const issueStatusSchema = z.enum([
  "pending",
  "approved_open",
  "resolved",
  "rejected",
]);

export const issueViewSchema = z.enum(["open", "resolved"]);

export const issueMetaSchema = z.object({
  userAgent: z.string().optional(),
  viewport: z
    .object({
      w: z.number().int().positive().optional(),
      h: z.number().int().positive().optional(),
    })
    .optional(),
  parentHref: z.string().optional(),
});

export const issueScreenshotInputSchema = z.object({
  name: z.string().min(1),
  dataUrl: z.string().min(1),
});

export const createIssueRequestSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().min(1),
  email: z.string().email().optional(),
  screenshot: issueScreenshotInputSchema.optional(),
  interactions: z.array(z.string().min(1)).optional().default([]),
  meta: issueMetaSchema.optional(),
});

export const issueRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  message: z.string(),
  email: z.string().nullable(),
  status: issueStatusSchema,
  interactions: z.array(z.string()),
  hasScreenshot: z.boolean(),
  screenshotName: z.string().nullable(),
  screenshotPath: z.string().nullable(),
  meta: issueMetaSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const issueListResponseSchema = z.object({
  items: z.array(issueRecordSchema),
});

export const issueModerationResponseSchema = z.object({
  items: z.array(issueRecordSchema),
});

export const updateIssueStatusRequestSchema = z.object({
  status: issueStatusSchema,
  note: z.string().optional(),
});

export type IssueStatus = z.infer<typeof issueStatusSchema>;
export type IssueView = z.infer<typeof issueViewSchema>;
export type IssueMeta = z.infer<typeof issueMetaSchema>;
export type CreateIssueRequest = z.infer<typeof createIssueRequestSchema>;
export type IssueRecord = z.infer<typeof issueRecordSchema>;
export type IssueListResponse = z.infer<typeof issueListResponseSchema>;
export type IssueModerationResponse = z.infer<typeof issueModerationResponseSchema>;
export type UpdateIssueStatusRequest = z.infer<typeof updateIssueStatusRequestSchema>;
