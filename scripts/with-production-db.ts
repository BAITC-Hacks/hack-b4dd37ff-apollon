import { spawn } from "node:child_process";
import { productionDatabaseConnection, PRODUCTION } from "./railway-production";

// Uses argument arrays, not a shell, and never prints credentials.
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Supply a database command to run against Railway production");
const connection = await productionDatabaseConnection();
console.log(JSON.stringify({ databaseTarget: PRODUCTION }));
try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, DATABASE_URL: connection.url }, stdio: "inherit" });
    child.once("error", reject); child.once("close", code => resolve(code ?? 1));
  });
} finally { await connection.close(); }
