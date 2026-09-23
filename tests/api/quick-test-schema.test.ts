import { describe, expect, it } from "vitest";
import { quickTestQuerySchema } from "../../app/api/quick-test/route";

describe("quickTestQuerySchema", () => {
  it("defaults limit to 50 with no query params", () => {
    const parsed = quickTestQuerySchema.parse({});
    expect(parsed).toEqual({ limit: 50 });
  });
  it("coerces a numeric limit string", () => {
    expect(quickTestQuerySchema.parse({ limit: "12" }).limit).toBe(12);
  });
  it("rejects a non-numeric limit", () => {
    expect(quickTestQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
  });
  it("rejects a limit outside 1..200", () => {
    expect(quickTestQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(quickTestQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
  it("accepts a valid supplier and rejects an invalid one", () => {
    expect(quickTestQuerySchema.safeParse({ supplier: "IEK" }).success).toBe(true);
    expect(quickTestQuerySchema.safeParse({ supplier: "SE" }).success).toBe(true);
    expect(quickTestQuerySchema.safeParse({ supplier: "ACME" }).success).toBe(false);
  });
  it("accepts an optional datasetId", () => {
    const parsed = quickTestQuerySchema.parse({ datasetId: "abc123" });
    expect(parsed.datasetId).toBe("abc123");
  });
});
