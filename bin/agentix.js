#!/usr/bin/env node

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--node-shell")) {
  process.stdout.write("Starting Agentix...\n");
}

import("./agentix-main.js").catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentix bootstrap failed: ${message}`);
  process.exitCode = 1;
});
