import { spawn } from "node:child_process";
import { productionDatabaseConnection, PRODUCTION } from "./railway-production";

// Uses argument arrays, not a shell, and never prints credentials.
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Supply a database command to run against Railway production");
const connection = await productionDatabaseConnection();
console.log(JSON.stringify({ databaseTarget: PRODUCTION }));
try {
  const child = spawn(command, args, { env: { ...process.env, DATABASE_URL: connection.url, APOLLON_PRODUCTION_RELAY: "1" }, stdio: "inherit" });
  const exitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
  let interrupted: keyof typeof exitCodes | undefined;
  const forward = (signal: keyof typeof exitCodes) => {
    interrupted ??= signal;
    // Signal the command's parent (next dev), which owns shutdown of its server child.
    // Wait for it to exit before closing the database relay.
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  const onHangup = () => forward("SIGHUP");
  const onExit = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  process.on("SIGHUP", onHangup);
  process.on("exit", onExit);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve(interrupted ? exitCodes[interrupted] : code ?? 1));
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    process.off("SIGHUP", onHangup);
    process.off("exit", onExit);
  }
} finally { await connection.close(); }
