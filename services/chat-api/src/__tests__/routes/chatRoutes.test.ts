import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock chatTurn module — selectively replace runChatTurn so parseChatRequestBody
// stays real and exercises the actual request validation logic.
vi.mock("../../chatTurn.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../chatTurn.js")>();
  return {
    ...original,
    runChatTurn: vi.fn(),
  };
});

import { chatRouter } from "../../routes/chatRoutes.js";
import { runChatTurn } from "../../chatTurn.js";

const app = express();
app.use(express.json());
app.use(chatRouter);

const cannedTurn = {
  message: "Tell me more about your workflow.",
  phase: "clarify",
  widget: null,
  workflowPatch: null,
};

const validBody = {
  messages: [{ role: "user", content: "I want to build a workflow" }],
  workflowDraft: { schemaVersion: 1, title: "", trigger: null, steps: [] },
};

describe("POST /v1/chat", () => {
  beforeEach(() => {
    vi.mocked(runChatTurn).mockResolvedValue(cannedTurn as never);
  });

  it("returns 200 with the assistant turn on a valid request", async () => {
    const res = await request(app).post("/v1/chat").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(cannedTurn.message);
    expect(res.body.phase).toBe("clarify");
  });

  it("returns 400 when messages field is missing", async () => {
    const res = await request(app).post("/v1/chat").send({ workflowDraft: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it("returns 400 when messages is not an array", async () => {
    const res = await request(app)
      .post("/v1/chat")
      .send({ messages: "not an array", workflowDraft: {} });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a message has an invalid role", async () => {
    const res = await request(app)
      .post("/v1/chat")
      .send({ messages: [{ role: "system", content: "hi" }], workflowDraft: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it("returns 400 when a message content is not a string", async () => {
    const res = await request(app)
      .post("/v1/chat")
      .send({ messages: [{ role: "user", content: 42 }], workflowDraft: {} });
    expect(res.status).toBe(400);
  });

  it("returns 400 when request body is empty", async () => {
    const res = await request(app).post("/v1/chat").send(null);
    expect(res.status).toBe(400);
  });

  it("returns 502 when runChatTurn throws a non-validation error", async () => {
    vi.mocked(runChatTurn).mockRejectedValue(new Error("Gemini API unreachable"));
    const res = await request(app).post("/v1/chat").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Gemini/i);
  });
});
