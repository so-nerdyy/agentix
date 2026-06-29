// Bridge entry point - starts the HTTP bridge server.
import { startBridge } from "./server.js";

startBridge().catch((err) => {
  console.error("Bridge entry failed:", err);
  process.exit(1);
});