// Main CLI entry point.
// Routes to HermesShell (TypeScript) or delegates to Python CLI based on args.

import { spawn } from "child_process";
import { AgentixBackend } from "./agentix_backend.js";

const args = process.argv.slice(2);

// Default: check if bridge is running and fall back to spawning it
async function main() {
  const backend = new AgentixBackend();

  // Try to talk to bridge
  try {
    await fetch("http://127.0.0.1:3456/health");
    console.log("Agentix backend ready.");
  } catch {
    // Bridge not running - spawn it
    console.log("Starting bridge...");
    const child = spawn("node", ["dist/bridge/entry.js"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch(console.error);