import { createRequire } from "module";
import { startBridge } from "./bridge/server.js";
import { PATHS, ensureDataDirs } from "./config/paths.js";
import { startInboxServer } from "./config/InboxServer.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

async function isBridgeHealthy(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:3456/health");
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const [cmd] = process.argv.slice(2);

  switch (cmd) {
    case "version":
    case "--version":
    case "-V":
      console.log(`Agentix v${pkg.version}`);
      return;
    case "server":
      ensureDataDirs();
      await startInboxServer();
      try {
        await startBridge();
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("EADDRINUSE") &&
          (await isBridgeHealthy())
        ) {
          console.error("Bridge already running on 127.0.0.1:3456");
          return;
        }
        throw err;
      }
      return;
    case "support":
      ensureDataDirs();
      console.log(`Agentix v${pkg.version}`);
      console.log(`Project root: ${PATHS.projectRoot}`);
      console.log(`Hermes root: ${PATHS.hermesRoot}`);
      console.log(`Data dir: ${PATHS.dataDir}`);
      console.log(`Bridge entry: ${PATHS.bridgeEntry}`);
      console.log(`Inbox entry: ${PATHS.inboxEntry}`);
      return;
    case "mods":
      console.log(
        "Mod management is not restored yet; the Hermes frontend is wired back in.",
      );
      return;
    default:
      console.log(
        "Agentix backend ready. Use `agentix` for the Hermes shell or `agentix server` to start backend services.",
      );
    }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
