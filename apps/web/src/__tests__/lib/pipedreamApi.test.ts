import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchConnectToken } from "../../lib/pipedreamApi";

const BASE = "http://localhost:3001";
const USER_ID = "test-user-123";

describe("fetchConnectToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a CreateTokenResponse on success", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "tok_abc123",
          expiresAt,
          connectLinkUrl: "https://pipedream.com/connect/abc",
        }),
      }),
    );

    const result = await fetchConnectToken(BASE, USER_ID);

    expect(result.token).toBe("tok_abc123");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.connectLinkUrl).toBe("https://pipedream.com/connect/abc");
  });

  it("throws when the server returns a non-200 status with body text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      }),
    );

    await expect(fetchConnectToken(BASE, USER_ID)).rejects.toThrow("Unauthorized");
  });

  it("throws with status message when non-200 body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "",
      }),
    );

    await expect(fetchConnectToken(BASE, USER_ID)).rejects.toThrow("HTTP 500");
  });

  it("throws when response body is missing the token field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ expiresAt: new Date().toISOString(), connectLinkUrl: "" }),
      }),
    );

    await expect(fetchConnectToken(BASE, USER_ID)).rejects.toThrow("no token");
  });

  it("posts to the correct URL with externalUserId in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "tok_xyz",
        expiresAt: new Date().toISOString(),
        connectLinkUrl: "",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchConnectToken(BASE, USER_ID);

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/v1/connect/tokens`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ externalUserId: USER_ID }),
      }),
    );
  });
});
