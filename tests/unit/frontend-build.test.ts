import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = ["index.html", "app.js", "styles.css"] as const;

function readFrontendFile(area: "src" | "dist", file: typeof files[number]): string {
  return readFileSync(join(root, "frontend", area, file), "utf-8");
}

describe("frontend dashboard build surface", () => {
  it("keeps the frontend build configured from the owned source assets", () => {
    const build = readFileSync(join(root, "frontend", "build.mjs"), "utf-8");

    for (const file of files) {
      expect(readFrontendFile("src", file).length).toBeGreaterThan(0);
      expect(build).toContain(`"${file}"`);
    }
    expect(build).toContain("copySourceTree(srcDir, distDir)");
  });

  it("preserves the interactive Agentix control surface", () => {
    const html = readFrontendFile("src", "index.html");
    const app = readFrontendFile("src", "app.js");

    expect(html).toContain("Command palette");
    expect(html).toContain("API token");
    expect(html).not.toContain("Event token");
    expect(html).toContain('data-view="scheduler"');
    expect(html).toContain('data-view="plans"');
    expect(html).toContain('data-view="gateway"');
    expect(html).toContain('data-view="approvals"');
    expect(html).toContain('data-view="diagnostics"');
    expect(html).toContain('data-view="usage"');
    expect(html).toContain('data-view="config"');
    expect(html).toContain('data-panel="usage"');
    expect(html).toContain('data-panel="config"');
    expect(html).toContain('id="reloadUsageButton"');
    expect(html).toContain('id="configForm"');
    expect(html).toContain('id="authTokenForm"');
    expect(html).toContain('id="composeForm"');
    expect(app).toContain("new EventSource");
    expect(app).toContain("Authorization: `Bearer ${state.sessionToken}`");
    expect(app).toContain("/execute/stream");
    expect(app).toContain("/plans");
    expect(app).toContain("/scheduler/jobs");
    expect(app).toContain("data-action=\"inspect-plan");
    expect(app).toContain("/gateway");
    expect(app).toContain("/support/bundle");
    expect(app).toContain("/doctor");
    expect(app).toContain('api("/usage")');
    expect(app).toContain('api("/config")');
    expect(app).toContain('api("/auth/tokens")');
    expect(app).toContain("/sessions/prune");
    expect(app).toContain("/sessions/optimize");
    expect(app).toContain("data-action=\"rename-session");
    expect(app).toContain("diagnosticsCards");
    expect(app).toContain("data-action=\"approve");
    expect(app).toContain("data-action=\"restart-task-detail");
    expect(app).toContain("data-action=\"replay-plan");
    expect(app).toContain("data-action=\"cancel-plan");
    expect(app).toContain("data-action=\"retry-failed-plan");
  });

  it("executes dashboard quick actions through the slash command handler", () => {
    const app = readFrontendFile("src", "app.js");

    expect(app).toMatch(
      /document\.querySelectorAll\("\[data-quick\]"\)[\s\S]*button\.addEventListener\("click", async \(\) => \{[\s\S]*await handleSlash\(command\);/,
    );
    expect(app).not.toContain('const quick = button.dataset.quick?.replace(/^\\//, "")');
    expect(app).toMatch(
      /case "support":[\s\S]*api\("\/support\/bundle", \{ method: "POST" \}\)/,
    );
  });

  it("renders runtime usage from the backend with navigation and reload integration", () => {
    const html = readFrontendFile("src", "index.html");
    const app = readFrontendFile("src", "app.js");
    const styles = readFrontendFile("src", "styles.css");

    expect(html).toContain('data-quick="/usage"');
    expect(html).toContain('id="usageTaskStatuses"');
    expect(html).toContain('id="usageJobStatuses"');
    expect(html).toContain('id="usageGateways"');
    expect(app).toContain('title: "Usage"');
    expect(app).toContain('case "usage":');
    expect(app).toContain("state.usage.tasksByStatus");
    expect(app).toContain("state.usage.jobsByLastStatus");
    expect(app).toContain("state.usage.enabledGateways");
    expect(app).toContain('refs.reloadUsageButton.addEventListener("click", loadUsage)');
    expect(styles).toContain(".usage-layout");
    expect(styles).toContain("@media (max-width: 1180px)");
  });

  it("renders backend config controls from the Agentix config API", () => {
    const html = readFrontendFile("src", "index.html");
    const app = readFrontendFile("src", "app.js");
    const styles = readFrontendFile("src", "styles.css");

    expect(html).toContain('data-quick="/config"');
    expect(html).toContain('href="/openapi.json"');
    expect(html).toContain('name="provider"');
    expect(html).toContain('name="model"');
    expect(html).toContain('name="baseUrl"');
    expect(html).toContain('name="approvalTimeoutMs"');
    expect(html).toContain('id="authTokenList"');
    expect(html).toContain('value="admin"');
    expect(app).toContain("function renderConfigPanel()");
    expect(app).toContain("function saveConfigPanel(event)");
    expect(app).toContain("function createAuthToken(event)");
    expect(app).toContain('data-action="revoke-auth-token"');
    expect(app).toContain('case "config":');
    expect(app).toContain('body: JSON.stringify({ key, value })');
    expect(app).toContain('/auth/tokens/${encodeURIComponent(id)}');
    expect(styles).toContain(".config-form");
    expect(styles).toContain(".config-grid");
  });

  it("exposes real plan execution controls without inventing plan states", () => {
    const app = readFrontendFile("src", "app.js");

    expect(app).toContain('body: JSON.stringify({ action: "replay" })');
    expect(app).toContain('body: JSON.stringify({ action: "cancel" })');
    expect(app).toContain('body: JSON.stringify({ action: "retry-failed" })');
    expect(app).toContain("This can repeat side effects");
    expect(app).not.toContain("pause-plan");
    expect(app).not.toContain("complete-plan");
  });

  it("opens task details from approval details", () => {
    const app = readFrontendFile("src", "app.js");

    expect(app).toMatch(
      /else if \(action === "inspect-task"\) \{\s+state\.selectedTaskId = id;\s+saveFilterState\(\);\s+setView\("tasks"\);\s+await loadTaskDetail\(id\);/,
    );
  });

  it("loads session memory records separately from scored memory searches", () => {
    const app = readFrontendFile("src", "app.js");

    expect(app).toContain('api(`/memory?sessionId=${encodeURIComponent(state.sessionId)}`)');
    expect(app).not.toContain('state.memory = await api(`/memory/search?q=${encodeURIComponent(state.sessionId)}`)');
    expect(app).toContain("function memorySearchCard(item)");
    expect(app).toContain("state.memorySearchResults = await api(`/memory/search?q=${encodeURIComponent(query)}`)");
    expect(app).toContain("state.memorySearchResults.map(memorySearchCard)");
  });

  it("exposes scheduler parity controls and advanced create fields", () => {
    const html = readFrontendFile("src", "index.html");

    expect(html).toContain('id="runDueJobsButton"');
    expect(html).toContain('id="schedulerFeedback"');
    expect(html).toContain('name="script"');
    expect(html).toContain('name="noAgent"');
    expect(html).toContain('name="workdir"');
    expect(html).toContain('name="skills"');
  });

  it("creates, edits, and runs due scheduler jobs with feedback events", () => {
    const app = readFrontendFile("src", "app.js");

    expect(app).toContain('api("/scheduler/jobs", {');
    expect(app).toContain('api(`/scheduler/jobs/${encodeURIComponent(id)}`, {');
    expect(app).toContain('method: "PUT"');
    expect(app).toContain('api("/scheduler/run-due", { method: "POST", body: "{}" })');
    expect(app).toContain('appendEvent("scheduler job created"');
    expect(app).toContain('appendEvent("scheduler job updated"');
    expect(app).toContain('appendEvent("scheduler due run"');
    expect(app).toContain('data-job-edit="${escapeHtml(job.id)}"');
    expect(app).toContain('skills: parseSkills(form.get("skills"))');
    expect(app).toContain('noAgent: form.get("noAgent") === "on"');
  });
});
