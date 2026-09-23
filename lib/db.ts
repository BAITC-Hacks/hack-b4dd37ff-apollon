import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { apollonPrisma?: PrismaClient };
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured. Connect to Railway production PostgreSQL using the production wrapper.");
  const host = new URL(process.env.DATABASE_URL).hostname;
  const productionRelay = ["localhost", "127.0.0.1", "[::1]"].includes(host) && process.env.APOLLON_PRODUCTION_RELAY === "1";
  const localOptIn = process.env.APOLLON_LOCAL_DB === "1";
  if (!localOptIn && !productionRelay && !host.endsWith(".railway.internal") && !host.endsWith(".proxy.rlwy.net")) {
    throw new Error("Only Railway PostgreSQL is supported. Use scripts/with-production-db.ts for local development, or set APOLLON_LOCAL_DB=1 to connect to a local judge/dev database.");
  }
  if (!globalDb.apollonPrisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 10000 });
    globalDb.apollonPrisma = new PrismaClient({ adapter });
  }
  return globalDb.apollonPrisma;
}
