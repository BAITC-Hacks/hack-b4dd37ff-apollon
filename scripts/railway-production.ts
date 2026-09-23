import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";

export const PRODUCTION = {
  project: "5458bd50-da4b-44d4-9670-38d2e6849f7e",
  environment: "428afbae-1686-4dbb-a3e5-200a2a2cd0d2",
  service: "d996992f-11a9-46c3-86da-8cc7b526fa5b",
};
function railway(args: string[]) {
  try {
    return JSON.parse(execFileSync("railway", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RAILWAY_CALLER: "skill:use-railway@1.5.3", RAILWAY_AGENT_SESSION: "apollon-iek-source-import" } }));
  } catch { throw new Error("Railway context/credentials could not be read. No database action was performed."); }
}
/** Resolve credentials in memory. The loopback listener is an SSH relay to production, not a local DB. */
export async function productionDatabaseConnection(): Promise<{ url: string; close: () => Promise<void> }> {
  const status = railway(["status", "--json"]);
  const environment = status.environments?.edges?.find((e: { node: { id: string; name: string } }) => e.node.id === PRODUCTION.environment)?.node;
  if (status.id !== PRODUCTION.project || environment?.name !== "production" ||
    !status.services?.edges?.some((s: { node: { id: string; name: string } }) => s.node.id === PRODUCTION.service && s.node.name === "Postgres")) {
    throw new Error("Expected Apollon Railway production PostgreSQL context was not found");
  }
  const variables = railway(["variable", "list", "--service", PRODUCTION.service, "--environment", PRODUCTION.environment, "--json"]);
  if (typeof variables.DATABASE_PUBLIC_URL === "string") {
    const url = new URL(variables.DATABASE_PUBLIC_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".proxy.rlwy.net")) throw new Error("Expected Railway TCP proxy database URL");
    return { url: url.toString(), close: async () => {} };
  }
  const url = new URL(variables.DATABASE_URL);
  if (!url.hostname.endsWith(".railway.internal")) throw new Error("Expected Railway private database hostname");
  const app = environment.serviceInstances?.edges?.find((e: { node: { serviceId: string } }) => e.node.serviceId === "02be117b-61a2-4e26-a0cc-6b475d2d321c")?.node;
  if (!app?.id) throw new Error("Production application SSH instance is unavailable");
  const code = `const net=require("node:net");const s=net.connect({host:${JSON.stringify(url.hostname)},port:${Number(url.port || 5432)}});process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(1));s.on("close",()=>process.exit(0));`;
  const quoted = "'" + code.replaceAll("'", "'\\''") + "'";
  const children = new Set<ChildProcess>(), sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", `${app.id}@ssh.railway.com`, `node -e ${quoted}`], { stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    socket.pipe(child.stdin!); child.stdout!.pipe(socket);
    child.stderr!.resume(); // do not log transport diagnostics or remote environment
    child.on("error", () => socket.destroy());
    child.on("close", () => { children.delete(child); socket.destroy(); });
    socket.on("error", () => child.kill());
    socket.on("close", () => { sockets.delete(socket); child.kill(); });
    child.stdin!.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SSH relay could not listen");
  url.hostname = "127.0.0.1"; url.port = String(address.port);
  return { url: url.toString(), close: async () => {
    for (const socket of sockets) socket.destroy();
    for (const child of children) child.kill();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
