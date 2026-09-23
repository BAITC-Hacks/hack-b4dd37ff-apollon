// Optional access gate for the shared public deployment. Next.js 16 renamed `middleware.ts` to
// `proxy.ts` (same file convention, same `export function proxy(request)` + `config.matcher`
// shape); see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// Proxy defaults to the Node.js runtime as of Next 16, so `node:crypto` is safe to use here
// without an explicit `export const runtime`.
//
// Behaviour: if APOLLON_ACCESS_PASSWORD is set, every page and /api/* route (except /api/health,
// used by the Docker healthcheck and judges' scripts) requires HTTP Basic auth with that password
// (any username). If the env var is unset, every request passes through unchanged so judges
// running locally, or a public demo deployment, keep frictionless access.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const config = {
  // Exclude static assets so a wrong/missing password never blocks CSS/JS/images from loading;
  // everything else (all pages and all /api/* routes, including /api/health, which is excluded
  // inside the function instead) still goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Apollon"' },
  });
}

// Constant-time comparison: plain `===` on the decoded password would let an attacker infer the
// correct password one byte at a time from response-time differences.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    // Still run a same-length comparison so a length mismatch doesn't short-circuit into a
    // faster code path that would itself leak timing information.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function proxy(request: NextRequest): Response {
  const password = process.env.APOLLON_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return unauthorized();

  let suppliedPassword: string;
  try {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf-8");
    const sepIndex = decoded.indexOf(":");
    suppliedPassword = sepIndex === -1 ? decoded : decoded.slice(sepIndex + 1);
  } catch {
    return unauthorized();
  }

  if (!safeEqual(suppliedPassword, password)) return unauthorized();
  return NextResponse.next();
}
