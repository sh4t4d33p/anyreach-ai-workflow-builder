import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { healthRouter } from "../../routes/healthRoutes.js";

const app = express();
app.use(healthRouter);

describe("GET /health", () => {
  it("returns 200 with ok:true and service name", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("chat-api");
  });
});

describe("GET /v1/ready", () => {
  it("returns 200 with gemini.configured field", async () => {
    const res = await request(app).get("/v1/ready");
    expect(res.status).toBe(200);
    expect(typeof res.body.gemini.configured).toBe("boolean");
    expect(typeof res.body.gemini.model).toBe("string");
  });
});
