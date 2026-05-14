import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendChatTurn } from "../../lib/chatApi";

const BASE = "http://localhost:3002";

const validResponse = {
  message: "Let's get started!",
  phase: "clarify",
  widget: null,
  workflowPatch: null,
};

describe("sendChatTurn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a parsed AssistantTurnResponse on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => validResponse,
      }),
    );

    const result = await sendChatTurn(BASE, {
      messages: [{ role: "user", content: "Hello" }],
      workflowDraft: {},
    });

    expect(result.message).toBe("Let's get started!");
    expect(result.phase).toBe("clarify");
  });

  it("throws with server error message on non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "Gemini is down" }),
      }),
    );

    await expect(
      sendChatTurn(BASE, { messages: [{ role: "user", content: "Hi" }], workflowDraft: {} }),
    ).rejects.toThrow("Gemini is down");
  });

  it("throws with status fallback message when error body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    await expect(
      sendChatTurn(BASE, { messages: [{ role: "user", content: "Hi" }], workflowDraft: {} }),
    ).rejects.toThrow("Chat failed (503)");
  });

  it("throws when response body is missing message field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ phase: "clarify" }),
      }),
    );

    await expect(
      sendChatTurn(BASE, { messages: [{ role: "user", content: "Hi" }], workflowDraft: {} }),
    ).rejects.toThrow("missing message");
  });

  it("throws when response body is missing phase field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Hello" }),
      }),
    );

    await expect(
      sendChatTurn(BASE, { messages: [{ role: "user", content: "Hi" }], workflowDraft: {} }),
    ).rejects.toThrow("missing phase");
  });

  it("calls the correct URL with POST method and JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validResponse,
    });
    vi.stubGlobal("fetch", mockFetch);

    await sendChatTurn(BASE, {
      messages: [{ role: "user", content: "Test" }],
      workflowDraft: { schemaVersion: 1 },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/v1/chat`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
