import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { apollonPrisma?: PrismaClient };
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured. Start PostgreSQL and set the server environment.");
  if (!globalDb.apollonPrisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 10000 });
    globalDb.apollonPrisma = new PrismaClient({ adapter });
  }
  return globalDb.apollonPrisma;
}
