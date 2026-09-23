import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";

function requestFor(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://apollon.example"), { headers });
}
function basicAuthHeader(password: string, username = "judge") {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}` };
}

describe("proxy access gate", () => {
  const originalPassword = process.env.APOLLON_ACCESS_PASSWORD;
  afterEach(() => {
    if (originalPassword === undefined) delete process.env.APOLLON_ACCESS_PASSWORD;
    else process.env.APOLLON_ACCESS_PASSWORD = originalPassword;
  });

  describe("when APOLLON_ACCESS_PASSWORD is unset", () => {
    beforeEach(() => { delete process.env.APOLLON_ACCESS_PASSWORD; });
    it("passes every request through without requiring auth", () => {
      const response = proxy(requestFor("/"));
      expect(response.status).not.toBe(401);
    });
    it("passes /api/data/products through without requiring auth", () => {
      const response = proxy(requestFor("/api/data/products"));
      expect(response.status).not.toBe(401);
    });
  });

  describe("when APOLLON_ACCESS_PASSWORD is set", () => {
    beforeEach(() => { process.env.APOLLON_ACCESS_PASSWORD = "s3cret"; });

    it("returns 401 with WWW-Authenticate when no Authorization header is sent", () => {
      const response = proxy(requestFor("/"));
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain("Basic realm=");
    });

    it("returns 401 for a wrong password", () => {
      const response = proxy(requestFor("/", basicAuthHeader("wrong-password")));
      expect(response.status).toBe(401);
    });

    it("passes through for the right password, with any username", () => {
      const response = proxy(requestFor("/", basicAuthHeader("s3cret", "anyone")));
      expect(response.status).not.toBe(401);
    });

    it("passes through /api/* routes for the right password", () => {
      const response = proxy(requestFor("/api/data/transactions", basicAuthHeader("s3cret")));
      expect(response.status).not.toBe(401);
    });

    it("rejects /api/* routes without credentials", () => {
      const response = proxy(requestFor("/api/data/transactions"));
      expect(response.status).toBe(401);
    });

    it("always passes /api/health through, even without credentials", () => {
      const response = proxy(requestFor("/api/health"));
      expect(response.status).not.toBe(401);
    });

    it("rejects a malformed (non-base64) Authorization header", () => {
      const response = proxy(requestFor("/", { authorization: "Basic not-valid-base64!!!" }));
      expect(response.status).toBe(401);
    });
  });
});
