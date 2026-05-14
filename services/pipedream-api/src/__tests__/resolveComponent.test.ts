import { describe, it, expect } from "vitest";
import { _scoreMatchForTest as scoreMatch } from "../resolveComponent.js";

describe("scoreMatch", () => {
  it("returns 1_000_000 for an exact match (underscore ↔ hyphen normalised)", () => {
    expect(scoreMatch("google_sheets-new-spreadsheet-row", "google_sheets-new-spreadsheet-row")).toBe(
      1_000_000,
    );
    expect(scoreMatch("google_sheets-new-spreadsheet-row", "google-sheets-new-spreadsheet-row")).toBe(
      1_000_000,
    );
  });

  it("returns 500_000 when the candidate CONTAINS the hint (candidate is more specific)", () => {
    // candidate is a superset of the hint → more specific → high score
    expect(scoreMatch("slack", "slack-send-message")).toBe(500_000);
    expect(scoreMatch("google_sheets", "google_sheets-new-spreadsheet-row")).toBe(500_000);
  });

  it("does NOT return 500_000 when the hint contains the candidate (candidate is a shorter prefix)", () => {
    // Regression: google_sheets-new-spreadsheet was getting 500_000 against
    // hint google_sheets-new-spreadsheet-row because h.includes(c) was true.
    // The candidate is a DIFFERENT, less-specific component — it should not win.
    const score = scoreMatch("google_sheets-new-spreadsheet-row", "google_sheets-new-spreadsheet");
    expect(score).toBeLessThan(500_000);
    // Should fall through to token overlap (google+sheets+new+spreadsheet = ~260)
    expect(score).toBeGreaterThan(0);
  });

  it("scores the exact hint key higher than its shorter prefix when both are candidates", () => {
    const exact = scoreMatch(
      "google_sheets-new-spreadsheet-row",
      "google_sheets-new-spreadsheet-row",
    );
    const prefix = scoreMatch(
      "google_sheets-new-spreadsheet-row",
      "google_sheets-new-spreadsheet",
    );
    expect(exact).toBeGreaterThan(prefix);
  });

  it("returns token overlap score for partial key matches", () => {
    // hint: google_sheets-new-spreadsheet-row (tokens: google, sheets, new, spreadsheet, row)
    // candidate: google_sheets-add-row
    // shared tokens: google(60) + sheets(60) + row(30) = 150
    const score = scoreMatch("google_sheets-new-spreadsheet-row", "google_sheets-add-row");
    expect(score).toBe(150);
  });

  it("returns 0 for completely unrelated keys", () => {
    expect(scoreMatch("slack-send-message", "github-create-issue")).toBe(0);
  });

  it("handles underscore/hyphen equivalence in hint and candidate", () => {
    expect(scoreMatch("slack_send_message", "slack-send-message")).toBe(1_000_000);
  });
});
