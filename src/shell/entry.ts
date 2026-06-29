// Shell entry point - starts the Agentix interactive shell.
import { HermesShell } from "./HermesShell.js";

async function main() {
  const shell = new HermesShell();
  await shell.start();
}

main().catch((err) => {
  console.error("Shell failed:", err);
  process.exit(1);
});
