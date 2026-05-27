import {
  createIssueRequestSchema,
  issueListResponseSchema,
  issueModerationResponseSchema,
  issueStatusSchema,
  issueViewSchema,
  updateIssueStatusRequestSchema,
  type IssueMeta,
  type IssueRecord,
  type IssueStatus,
} from "@projectmate/shared-types";

type Env = {
  PROJECTMATE_DB: D1Database;
  PROJECTMATE_ISSUES_BUCKET: R2Bucket;
  ADMIN_API_KEY?: string;
  CORS_ALLOW_ORIGIN?: string;
  REQUIRE_IMAGE_APPROVAL?: string;
};

type IssueRow = {
  id: string;
  project_id: string;
  message: string;
  email: string | null;
  status: IssueStatus;
  interactions_json: string;
  meta_json: string;
  has_screenshot: number;
  screenshot_name: string | null;
  screenshot_key: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

const STATUS_TO_PUBLIC_VIEW: Record<"open" | "resolved", IssueStatus> = {
  open: "approved_open",
  resolved: "resolved",
};

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Unexpected error";
}

function isImageApprovalRequired(env: Env): boolean {
  const raw = env.REQUIRE_IMAGE_APPROVAL?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function isAdminRequest(request: Request): boolean {
  const explicitAdmin = request.headers.get("x-projectmate-admin")?.toLowerCase() === "true";
  const role = request.headers.get("x-projectmate-role")?.toLowerCase();
  return explicitAdmin || role === "admin";
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  if (!isAdminRequest(request)) return false;
  const apiKey = env.ADMIN_API_KEY?.trim();
  if (!apiKey) return true;
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length).trim() === apiKey;
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const requestOrigin = request.headers.get("origin");
  const allowOrigin = env.CORS_ALLOW_ORIGIN?.trim() || requestOrigin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization,x-projectmate-admin,x-projectmate-role",
  };
}

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...getCorsHeaders(request, env), ...extraHeaders },
  });
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1] || "application/octet-stream";
  const base64 = match[2];
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function safeFilePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "screenshot.png";
}

function nowIso(): string {
  return new Date().toISOString();
}

function toIssueRecord(row: IssueRow): IssueRecord {
  let interactions: string[] = [];
  let meta: IssueMeta | undefined;
  try {
    const parsed = JSON.parse(row.interactions_json);
    if (Array.isArray(parsed)) {
      interactions = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    interactions = [];
  }
  try {
    const parsedMeta = JSON.parse(row.meta_json) as unknown;
    if (parsedMeta && typeof parsedMeta === "object") {
      meta = parsedMeta as IssueMeta;
    }
  } catch {
    meta = undefined;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    message: row.message,
    email: row.email,
    status: row.status,
    interactions,
    hasScreenshot: !!row.has_screenshot,
    screenshotName: row.screenshot_name,
    screenshotPath: row.has_screenshot ? `/issues/${row.id}/screenshot` : null,
    meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

async function readIssueOrNull(env: Env, id: string): Promise<IssueRow | null> {
  return (
    (await env.PROJECTMATE_DB.prepare(
      `SELECT id, project_id, message, email, status, interactions_json, meta_json,
              has_screenshot, screenshot_name, screenshot_key, created_at, updated_at, resolved_at
         FROM issues
        WHERE id = ?1`
    )
      .bind(id)
      .first<IssueRow>()) ?? null
  );
}

async function handleCreateIssue(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON body." }, 400);
  }

  const parsed = createIssueRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(request, env, { error: "Invalid issue payload.", details: parsed.error.format() }, 400);
  }

  const body = parsed.data;
  const issueId = crypto.randomUUID();
  const createdAt = nowIso();
  const status: IssueStatus =
    !!body.screenshot && isImageApprovalRequired(env) ? "pending" : "approved_open";

  let screenshotKey: string | null = null;
  let screenshotName: string | null = null;
  let screenshotContentType: string | null = null;

  if (body.screenshot) {
    const parsedDataUrl = parseDataUrl(body.screenshot.dataUrl);
    if (!parsedDataUrl) {
      return jsonResponse(request, env, { error: "Screenshot data URL is invalid." }, 400);
    }
    screenshotName = body.screenshot.name;
    screenshotContentType = parsedDataUrl.contentType;
    const safeName = safeFilePart(body.screenshot.name);
    screenshotKey = `${body.projectId}/${issueId}/${safeName}`;
    await env.PROJECTMATE_ISSUES_BUCKET.put(screenshotKey, parsedDataUrl.bytes, {
      httpMetadata: { contentType: screenshotContentType },
    });
  }

  await env.PROJECTMATE_DB.prepare(
    `INSERT INTO issues (
       id, project_id, message, email, status, interactions_json, meta_json, has_screenshot,
       screenshot_name, screenshot_key, screenshot_content_type, created_at, updated_at, resolved_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL)`
  )
    .bind(
      issueId,
      body.projectId,
      body.message.trim(),
      body.email ?? null,
      status,
      JSON.stringify(body.interactions ?? []),
      JSON.stringify(body.meta ?? {}),
      body.screenshot ? 1 : 0,
      screenshotName,
      screenshotKey,
      screenshotContentType,
      createdAt,
      createdAt
    )
    .run();

  await env.PROJECTMATE_DB.prepare(
    "INSERT INTO issue_status_events (issue_id, status, actor, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(issueId, status, "system:create", null, createdAt)
    .run();

  const row = await readIssueOrNull(env, issueId);
  if (!row) return jsonResponse(request, env, { error: "Issue creation failed." }, 500);
  return jsonResponse(request, env, { item: toIssueRecord(row) }, 201);
}

async function handleListIssues(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const viewParsed = issueViewSchema.safeParse(url.searchParams.get("view") ?? "open");
  if (!viewParsed.success) {
    return jsonResponse(request, env, { error: "Invalid view query parameter." }, 400);
  }

  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return jsonResponse(request, env, { error: "Missing projectId query parameter." }, 400);
  }

  const status = STATUS_TO_PUBLIC_VIEW[viewParsed.data];
  const rows = await env.PROJECTMATE_DB.prepare(
    `SELECT id, project_id, message, email, status, interactions_json, meta_json,
            has_screenshot, screenshot_name, screenshot_key, created_at, updated_at, resolved_at
       FROM issues
      WHERE project_id = ?1
        AND status = ?2
      ORDER BY created_at DESC
      LIMIT 200`
  )
    .bind(projectId, status)
    .all<IssueRow>();

  const items = (rows.results ?? []).map(toIssueRecord);
  const response = issueListResponseSchema.parse({ items });
  return jsonResponse(request, env, response);
}

async function handleModerationList(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse(request, env, { error: "Admin authorization required." }, 403);
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return jsonResponse(request, env, { error: "Missing projectId query parameter." }, 400);
  }

  const rows = await env.PROJECTMATE_DB.prepare(
    `SELECT id, project_id, message, email, status, interactions_json, meta_json,
            has_screenshot, screenshot_name, screenshot_key, created_at, updated_at, resolved_at
       FROM issues
      WHERE project_id = ?1
        AND status IN ('pending', 'approved_open', 'rejected')
      ORDER BY created_at DESC
      LIMIT 300`
  )
    .bind(projectId)
    .all<IssueRow>();

  const items = (rows.results ?? []).map(toIssueRecord);
  const response = issueModerationResponseSchema.parse({ items });
  return jsonResponse(request, env, response);
}

async function handleUpdateStatus(request: Request, env: Env, issueId: string): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse(request, env, { error: "Admin authorization required." }, 403);
  }

  const issue = await readIssueOrNull(env, issueId);
  if (!issue) return jsonResponse(request, env, { error: "Issue not found." }, 404);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON body." }, 400);
  }

  const parsed = updateIssueStatusRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Invalid status payload.", details: parsed.error.format() },
      400
    );
  }

  const newStatus = issueStatusSchema.parse(parsed.data.status);
  const now = nowIso();
  const resolvedAt = newStatus === "resolved" ? now : null;

  await env.PROJECTMATE_DB.prepare(
    "UPDATE issues SET status = ?1, updated_at = ?2, resolved_at = ?3 WHERE id = ?4"
  )
    .bind(newStatus, now, resolvedAt, issueId)
    .run();

  await env.PROJECTMATE_DB.prepare(
    "INSERT INTO issue_status_events (issue_id, status, actor, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(issueId, newStatus, "admin", parsed.data.note ?? null, now)
    .run();

  const updated = await readIssueOrNull(env, issueId);
  if (!updated) return jsonResponse(request, env, { error: "Issue not found after update." }, 500);

  return jsonResponse(request, env, { item: toIssueRecord(updated) });
}

async function handleScreenshot(request: Request, env: Env, issueId: string): Promise<Response> {
  const row = await env.PROJECTMATE_DB.prepare(
    "SELECT status, screenshot_key, screenshot_content_type FROM issues WHERE id = ?1"
  )
    .bind(issueId)
    .first<{
      status: IssueStatus;
      screenshot_key: string | null;
      screenshot_content_type: string | null;
    }>();

  if (!row?.screenshot_key) {
    return jsonResponse(request, env, { error: "Screenshot not found." }, 404);
  }

  const isPublicStatus = row.status === "approved_open" || row.status === "resolved";
  if (!isPublicStatus && !isAuthorizedAdmin(request, env)) {
    return jsonResponse(request, env, { error: "Screenshot unavailable." }, 404);
  }

  const object = await env.PROJECTMATE_ISSUES_BUCKET.get(row.screenshot_key);
  if (!object?.body) return jsonResponse(request, env, { error: "Screenshot not found." }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": row.screenshot_content_type || object.httpMetadata?.contentType || "image/png",
      "Cache-Control": "public, max-age=60",
      ...getCorsHeaders(request, env),
    },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request, env),
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (request.method === "GET" && path === "/health") {
      return jsonResponse(request, env, { ok: true });
    }

    if (path === "/issues" && request.method === "POST") {
      return await handleCreateIssue(request, env);
    }
    if (path === "/issues" && request.method === "GET") {
      return await handleListIssues(request, env);
    }
    if (path === "/issues/moderation" && request.method === "GET") {
      return await handleModerationList(request, env);
    }

    const statusMatch = path.match(/^\/issues\/([^/]+)\/status$/);
    if (statusMatch && request.method === "PATCH") {
      return await handleUpdateStatus(request, env, statusMatch[1]);
    }

    const screenshotMatch = path.match(/^\/issues\/([^/]+)\/screenshot$/);
    if (screenshotMatch && request.method === "GET") {
      return await handleScreenshot(request, env, screenshotMatch[1]);
    }

    return jsonResponse(request, env, { error: "Not found." }, 404);
  } catch (err) {
    return jsonResponse(request, env, { error: normalizeErrorMessage(err) }, 500);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
