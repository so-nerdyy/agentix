// Shell entry point - starts the Agentix interactive shell.
import { AgentixShell } from "./AgentixShell.js";

async function main() {
  const shell = new AgentixShell();
  await shell.start();
}

main().catch((err) => {
  console.error("Shell failed:", err);
  process.exit(1);
});
