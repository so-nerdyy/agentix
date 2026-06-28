import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name?: string; version?: string };

export const PACKAGE_METADATA = {
  name: String(pkg.name ?? "agentix"),
  version: String(pkg.version ?? "unknown"),
} as const;
