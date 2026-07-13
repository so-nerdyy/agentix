// Bridge entry point - starts the HTTP bridge server.
import { startBridge } from "./server.js";

const server = await startBridge().catch((err) => {
  console.error("Bridge entry failed:", err);
  process.exit(1);
  throw err;
});

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Bridge received ${signal}, shutting down...`);
  try {
    await server.close();
  } finally {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
