import "dotenv/config";
import { defineConfig } from "prisma/config";
export default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_URL ?? "postgresql://apollon:apollon@localhost:55432/apollon" } });
