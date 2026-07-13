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

  it("parses fragmented SSE events without rendering the done sentinel", async () => {
    const payload = [
      `data: ${JSON.stringify({ delta: "hello\n" })}\n\n`,
      `data: ${JSON.stringify({ delta: "world" })}\n\n`,
      `data: ${JSON.stringify({ type: "result", sessionId: "sess-real", status: "complete", taskIds: ["task-1"] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const boundaries = [7, 19, 31, payload.length - 5];
    const chunks: string[] = [];
    let start = 0;
    for (const end of boundaries) {
      chunks.push(payload.slice(start, end));
      start = end;
    }
    chunks.push(payload.slice(start));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new AgentixBackend("http://127.0.0.1:3456");
    const deltas: string[] = [];

    const result = await backend.execute({
      stimulus: "test",
      gatewayId: "discord",
      metadata: { chatId: "channel-1" },
      deliver: false,
      toolsets: [],
      skills: ["release-audit"],
      streamCallback: (delta) => deltas.push(delta),
    });

    expect(result.response).toBe("hello\nworld");
    expect(result.sessionId).toBe("sess-real");
    expect(result.status).toBe("complete");
    expect(result.taskIds).toEqual(["task-1"]);
    expect(deltas.join("")).toBe("hello\nworld");
    expect(deltas).not.toContain("[DONE]");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      stimulus: "test",
      gatewayId: "discord",
      metadata: { chatId: "channel-1" },
      deliver: false,
      toolsets: [],
      skills: ["release-audit"],
    });
  });

  it("propagates structured SSE errors", async () => {
    const body = `data: ${JSON.stringify({ error: "backend exploded" })}\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const backend = new AgentixBackend("http://127.0.0.1:3456");

    await expect(backend.execute({ stimulus: "test" })).rejects.toThrow("backend exploded");
  });
});
