import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", serverExternalPackages: ["exceljs", "pg"] };
export default config;
