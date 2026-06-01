// TypeScript client for the Agentix HTTP bridge.
// All communication with the Python backend goes through this bridge.

const BRIDGE_URL = process.env.AGENTIX_BRIDGE_URL || "http://127.0.0.1:3456";

export class AgentixBackend {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || BRIDGE_URL;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async execute(opts: {
    stimulus: string;
    sessionId?: string;
    streamCallback?: (delta: string) => void;
  }): Promise<{ response: string; sessionId: string }> {
    const { stimulus, sessionId } = opts;

    const res = await fetch(`${this.baseUrl}/execute/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stimulus, sessionId }),
    });

    if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let response = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).replace(/\\n/g, "\n");
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              response += parsed.delta;
              opts.streamCallback?.(parsed.delta);
            } else if (data === "[DONE]") {
              // end
            }
          } catch {
            // plain text delta
            response += data;
            opts.streamCallback?.(data);
          }
        }
      }
    }

    return { response, sessionId: sessionId || "default" };
  }

  async executeStream(opts: {
    stimulus: string;
    sessionId?: string;
    streamCallback: (delta: string) => void;
  }): Promise<void> {
    await this.execute(opts);
  }

  async listSessions(): Promise<Array<{ id: string; createdAt: string }>> {
    return this.get("/sessions");
  }

  async createSession(opts?: { model?: string }): Promise<{ id: string }> {
    return this.post("/sessions", opts);
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    }
  }

  async memorySearch(query: string): Promise<Array<{ content: string; score: number }>> {
    return this.get(`/memory/search?q=${encodeURIComponent(query)}`);
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    return this.get("/tools");
  }
}