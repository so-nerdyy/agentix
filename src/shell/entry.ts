// Shell entry point - starts the HermesShell.
import { HermesShell } from "./HermesShell.js";

async function main() {
  const shell = new HermesShell();
  await shell.start();
}

main().catch((err) => {
  console.error("Shell failed:", err);
  process.exit(1);
});