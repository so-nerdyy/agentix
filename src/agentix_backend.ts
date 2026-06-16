// TypeScript client for the Agentix HTTP bridge.
// All communication with the Python backend goes through this bridge.

const BRIDGE_URL = process.env.AGENTIX_BRIDGE_URL || "http://127.0.0.1:3456";

export class AgentixBackend {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || BRIDGE_URL;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.AGENTIX_SESSION_TOKEN) {
      headers.Authorization = `Bearer ${process.env.AGENTIX_SESSION_TOKEN}`;
    }
    return headers;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
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
      headers: this.headers(),
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

  async getSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async createSession(opts?: { model?: string }): Promise<{ id: string }> {
    return this.post("/sessions", opts);
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    }
  }

  async renameSession(id: string, title: string): Promise<Record<string, unknown>> {
    return this.post(`/sessions/${encodeURIComponent(id)}/rename`, { title });
  }

  async pruneSessions(input: { olderThanDays?: number; source?: string }): Promise<Record<string, unknown>> {
    return this.post("/sessions/prune", input);
  }

  async optimizeSessions(): Promise<Record<string, unknown>> {
    return this.post("/sessions/optimize", {});
  }

  async memorySearch(query: string): Promise<Array<{ content: string; score: number }>> {
    return this.get(`/memory/search?q=${encodeURIComponent(query)}`);
  }

  async listMemory(sessionId?: string): Promise<Array<Record<string, unknown>>> {
    const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return this.get(`/memory${suffix}`);
  }

  async consolidateMemory(sessionId?: string): Promise<Record<string, unknown>> {
    return this.post("/memory/consolidate", { sessionId });
  }

  async resetMemory(input: {
    target?: "all" | "memory" | "user";
    sessionId?: string;
  } = {}): Promise<Record<string, unknown>> {
    return this.post("/memory/reset", input);
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    return this.get("/tools");
  }

  async getTool(toolId: string): Promise<Record<string, unknown>> {
    return this.get(`/tools/${encodeURIComponent(toolId)}`);
  }

  async search(query: string): Promise<Record<string, unknown>> {
    return this.get(`/search?q=${encodeURIComponent(query)}`);
  }

  async doctor(): Promise<Record<string, unknown>> {
    return this.get("/doctor");
  }

  async usage(): Promise<Record<string, unknown>> {
    return this.get("/usage");
  }

  async config(): Promise<Record<string, unknown>> {
    return this.get("/config");
  }

  async setConfig(key: string, value: unknown): Promise<Record<string, unknown>> {
    return this.post("/config", { key, value });
  }

  async listPlans(): Promise<Array<Record<string, unknown>>> {
    return this.get("/plans");
  }

  async getPlan(planId: string): Promise<Record<string, unknown>> {
    return this.get(`/plans/${encodeURIComponent(planId)}`);
  }

  async listTasks(sessionId?: string): Promise<Array<Record<string, unknown>>> {
    const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return this.get(`/tasks${suffix}`);
  }

  async getTask(taskId: string): Promise<Record<string, unknown>> {
    return this.get(`/tasks/${encodeURIComponent(taskId)}`);
  }

  async controlTask(taskId: string, action: "cancel" | "retry" | "restart"): Promise<Record<string, unknown>> {
    return this.post(`/tasks/${encodeURIComponent(taskId)}/action`, { action });
  }

  async listApprovals(): Promise<Array<Record<string, unknown>>> {
    return this.get("/approvals");
  }

  async getApproval(taskId: string): Promise<Record<string, unknown>> {
    return this.get(`/approvals/${encodeURIComponent(taskId)}`);
  }

  async approve(taskId: string): Promise<Record<string, unknown>> {
    return this.post(`/approvals/${encodeURIComponent(taskId)}/approve`);
  }

  async reject(taskId: string, reason?: string): Promise<Record<string, unknown>> {
    return this.post(`/approvals/${encodeURIComponent(taskId)}/reject`, { reason });
  }

  async listAudit(): Promise<Array<Record<string, unknown>>> {
    return this.get("/audit");
  }

  async getAudit(id: string): Promise<Record<string, unknown>> {
    return this.get(`/audit/${encodeURIComponent(id)}`);
  }

  async listLogs(): Promise<Array<Record<string, unknown>>> {
    return this.get("/logs");
  }

  async getLog(index: number): Promise<Record<string, unknown>> {
    return this.get(`/logs/${encodeURIComponent(index)}`);
  }

  async healingStats(): Promise<Record<string, unknown>> {
    return this.get("/healing/stats");
  }

  async getHealingDetail(id: string): Promise<Record<string, unknown>> {
    return this.get(`/healing/detail/${encodeURIComponent(id)}`);
  }

  async promoteHealingProcedure(id: string): Promise<Record<string, unknown>> {
    return this.post(`/healing/procedures/${encodeURIComponent(id)}/promote`);
  }

  async deprecateHealingProcedure(id: string): Promise<Record<string, unknown>> {
    return this.post(`/healing/procedures/${encodeURIComponent(id)}/deprecate`);
  }

  async listScheduledJobs(): Promise<Array<Record<string, unknown>>> {
    return this.get("/scheduler/jobs");
  }

  async getScheduledJob(id: string): Promise<Record<string, unknown>> {
    return this.get(`/scheduler/jobs/${encodeURIComponent(id)}`);
  }

  async createScheduledJob(input: {
    name: string;
    stimulus: string;
    schedule?: string;
    intervalMs?: number;
    script?: string;
    noAgent?: boolean;
    workdir?: string;
    skills?: string[];
    enabled?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.post("/scheduler/jobs", input);
  }

  async updateScheduledJob(id: string, input: {
    name?: string;
    stimulus?: string;
    schedule?: string;
    intervalMs?: number;
    script?: string | null;
    noAgent?: boolean;
    workdir?: string | null;
    skills?: string[];
    enabled?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.post(`/scheduler/jobs/${encodeURIComponent(id)}`, input);
  }

  async runScheduledJob(id: string): Promise<Record<string, unknown>> {
    return this.post(`/scheduler/jobs/${encodeURIComponent(id)}/run`);
  }

  async runDueScheduledJobs(): Promise<Record<string, unknown>> {
    return this.post("/scheduler/run-due");
  }

  async setScheduledJobEnabled(id: string, enabled: boolean): Promise<Record<string, unknown>> {
    return this.post(`/scheduler/jobs/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`);
  }

  async deleteScheduledJob(id: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/scheduler/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async listGateways(): Promise<Array<Record<string, unknown>>> {
    return this.get("/gateway");
  }

  async getGateway(id: string): Promise<Record<string, unknown>> {
    return this.get(`/gateway/${encodeURIComponent(id)}`);
  }

  async setGatewayEnabled(id: string, enabled: boolean): Promise<Record<string, unknown>> {
    return this.post(`/gateway/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`);
  }

  async receiveGatewayMessage(input: {
    gatewayId: string;
    stimulus: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.post(`/gateway/${encodeURIComponent(input.gatewayId)}/message`, {
      stimulus: input.stimulus,
      sessionId: input.sessionId,
      metadata: input.metadata,
    });
  }
}
