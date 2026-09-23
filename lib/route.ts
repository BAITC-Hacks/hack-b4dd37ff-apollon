export type Route = { kind: "start" } | { kind: "dataset"; id: string } | { kind: "run"; id: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Parses a workspace pathname; returns null for paths the workspace does not own. */
export function parseRoute(pathname: string): Route | null {
  const parts = pathname.split("/").filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return ""; } });
  if (parts.length === 0) return { kind: "start" };
  if (parts.length === 2 && ID.test(parts[1])) {
    if (parts[0] === "datasets") return { kind: "dataset", id: parts[1] };
    if (parts[0] === "runs") return { kind: "run", id: parts[1] };
  }
  return null;
}

export function routePath(route: Route) {
  return route.kind === "start" ? "/" : `/${route.kind === "dataset" ? "datasets" : "runs"}/${encodeURIComponent(route.id)}`;
}
