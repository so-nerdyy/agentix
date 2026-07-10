import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentixBackend } from "../../src/agentix_backend.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agentix backend HTTP client", () => {
  it("sends an empty JSON object for bodyless POST operations", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new AgentixBackend("http://127.0.0.1:3456");

    await backend.runDueScheduledJobs();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3456/scheduler/run-due",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
  });

  it("deletes dynamic Pi profiles through the bridge", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new AgentixBackend("http://127.0.0.1:3456");

    await backend.deleteAgentProfile("profile one");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3456/agents/profiles/profile%20one",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
