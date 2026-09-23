import { describe, expect, it } from "vitest";
import { readCappedBody, rejectCrossOrigin, rateLimit } from "../../lib/http";
import { AppError } from "../../lib/repo";
import { safeText, supplierWorkbook } from "../../lib/export";
import { calculatePlan } from "../../lib/engine";
import { makeEngineFixture } from "../fixtures/engine";
import ExcelJS from "exceljs";
import type { OrderView, ExportLine } from "../../lib/contracts/api";

function chunkedRequest(chunks: string[], url = "https://apollon.example/api/import") {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  // duplex:"half" is required by undici/Node's fetch implementation for any request with a
  // streaming (non-buffered) body.
  return new Request(url, { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("safeText formula-injection neutralization", () => {
  it("strips a leading control character before detecting a hidden formula trigger", () => {
    expect(safeText("\u0001=cmd")).toBe("'\u0001=cmd");
  });
  it("strips leading whitespace before detecting a formula trigger", () => {
    expect(safeText(" =1+1")).toBe("' =1+1");
  });
  it("escapes a string cell that looks like a negative-number formula", () => {
    expect(safeText("-5")).toBe("'-5");
  });
  it("keeps a genuinely numeric negative value as a real number cell, never escaped", async () => {
    const recommendation = calculatePlan(makeEngineFixture()).recommendations[0];
    recommendation.provenance.availableStock = -5;
    const lines: ExportLine[] = [{ recommendation, quantity: -5 }];
    const order: OrderView = { id: "T", supplier: "SE", revision: 0, status: "DRAFT", approver: null, approvedAt: null, approvedKeys: [], quantities: {} };
    const bytes = await supplierWorkbook(lines, order);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(recommendation.supplier === "SE" ? "Systeme Electric" : "IEK")!;
    expect(sheet.getCell("E2").value).toBe(-5); // stock
    expect(sheet.getCell("G2").value).toBe(-5); // quantity
    expect(typeof sheet.getCell("G2").value).toBe("number");
  });
});

describe("rejectCrossOrigin", () => {
  const url = "https://apollon.example/api/runs";
  it("allows a request with no Origin and no sec-fetch-site header (curl/CLI/server-to-server)", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST" }))).not.toThrow();
  });
  it("rejects when sec-fetch-site is cross-site even without an Origin header", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).toThrow(AppError);
  });
  it("rejects when sec-fetch-site is same-site", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST", headers: { "sec-fetch-site": "same-site" } }))).toThrow(AppError);
  });
  it("allows sec-fetch-site: same-origin", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }))).not.toThrow();
  });
  it("allows a matching Origin header", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST", headers: { origin: "https://apollon.example" } }))).not.toThrow();
  });
  it("rejects a mismatched Origin header", () => {
    expect(() => rejectCrossOrigin(new Request(url, { method: "POST", headers: { origin: "https://evil.example" } }))).toThrow(AppError);
  });
  it("allows an Origin matching Railway's forwarded host/proto behind the proxy", () => {
    const request = new Request(url, { method: "POST", headers: { origin: "https://apollon.up.railway.app", "x-forwarded-host": "apollon.up.railway.app", "x-forwarded-proto": "https" } });
    expect(() => rejectCrossOrigin(request)).not.toThrow();
  });
  it("rejects an Origin that matches neither the request URL nor the forwarded host", () => {
    const request = new Request(url, { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "apollon.up.railway.app", "x-forwarded-proto": "https" } });
    expect(() => rejectCrossOrigin(request)).toThrow(AppError);
  });
});

describe("readCappedBody", () => {
  it("returns the full buffer when the stream stays under the cap", async () => {
    const buf = await readCappedBody(chunkedRequest(["a", "b", "c"]), 10);
    expect(buf.toString("utf-8")).toBe("abc");
  });
  it("throws a 413 AppError once a chunked stream exceeds the cap, regardless of Content-Length", async () => {
    const request = chunkedRequest(["x".repeat(5), "x".repeat(5), "x".repeat(5)]);
    // No content-length header is set at all, simulating chunked transfer encoding.
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readCappedBody(request, 10)).rejects.toMatchObject({ status: 413 });
  });
  it("returns an empty buffer when the request has no body", async () => {
    const buf = await readCappedBody(new Request("https://apollon.example/api/runs"), 10);
    expect(buf.length).toBe(0);
  });
});

describe("rateLimit", () => {
  it("allows up to the limit within the window and then rejects with 429", () => {
    const request = new Request("https://apollon.example/api/agent", { headers: { "x-forwarded-for": "203.0.113.9" } });
    const scope = `test-scope-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(() => rateLimit(request, scope, 3, 60_000)).not.toThrow();
    expect(() => rateLimit(request, scope, 3, 60_000)).toThrow(AppError);
    try { rateLimit(request, scope, 3, 60_000); } catch (e) { expect((e as AppError).status).toBe(429); }
  });
  it("tracks separate buckets per client IP", () => {
    const scope = `test-scope-${Math.random()}`;
    const a = new Request("https://apollon.example/api/agent", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const b = new Request("https://apollon.example/api/agent", { headers: { "x-forwarded-for": "203.0.113.2" } });
    expect(() => rateLimit(a, scope, 1, 60_000)).not.toThrow();
    expect(() => rateLimit(a, scope, 1, 60_000)).toThrow(AppError);
    expect(() => rateLimit(b, scope, 1, 60_000)).not.toThrow();
  });
});
