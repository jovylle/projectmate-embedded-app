import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index.js";

const fakeEnv = {
  PROJECTMATE_DB: {
    prepare() {
      throw new Error("DB should not be touched in this test.");
    },
  } as unknown as D1Database,
  PROJECTMATE_ISSUES_BUCKET: {
    put() {
      throw new Error("R2 should not be touched in this test.");
    },
  } as unknown as R2Bucket,
};

describe("issues api guards", () => {
  it("rejects moderation list when caller is not admin", async () => {
    const req = new Request("https://example.com/issues/moderation?projectId=demo", {
      method: "GET",
    });

    const res = await handleRequest(req, fakeEnv);
    expect(res.status).toBe(403);
  });

  it("rejects status update when caller is not admin", async () => {
    const req = new Request("https://example.com/issues/abc/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });

    const res = await handleRequest(req, fakeEnv);
    expect(res.status).toBe(403);
  });

  it("requires projectId on public issue list", async () => {
    const req = new Request("https://example.com/issues?view=open", {
      method: "GET",
    });

    const res = await handleRequest(req, fakeEnv);
    expect(res.status).toBe(400);
  });
});
