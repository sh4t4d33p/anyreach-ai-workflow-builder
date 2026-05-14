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
    expect(res.body.service).toBe("pipedream-api");
  });
});
