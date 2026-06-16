const state = {
  view: "live",
  sessionToken: localStorage.getItem("agentix.sessionToken") || "",
  sessionId: localStorage.getItem("agentix.sessionId") || "",
  selectedSessionId: localStorage.getItem("agentix.selectedSessionId") || "",
  selectedTaskId: localStorage.getItem("agentix.selectedTaskId") || "",
  selectedPlanId: localStorage.getItem("agentix.selectedPlanId") || "",
  taskFilter: localStorage.getItem("agentix.taskFilter") || "",
  taskStatusFilter: localStorage.getItem("agentix.taskStatusFilter") || "",
  approvalFilter: localStorage.getItem("agentix.approvalFilter") || "",
  searchQuery: localStorage.getItem("agentix.searchQuery") || "",
  searchResults: null,
  sessions: [],
  tasks: [],
  plans: [],
  planDetail: null,
  planDetailLoading: false,
  tools: [],
  selectedToolId: localStorage.getItem("agentix.selectedToolId") || "",
  approvals: [],
  selectedApprovalId: localStorage.getItem("agentix.selectedApprovalId") || "",
  jobs: [],
  selectedJobId: localStorage.getItem("agentix.selectedJobId") || "",
  selectedGatewayId: localStorage.getItem("agentix.selectedGatewayId") || "",
  memory: [],
  memorySearchResults: null,
  healing: { failures: [], procedures: [] },
  gatewayFilter: localStorage.getItem("agentix.gatewayFilter") || "",
  gateways: [],
  gatewayDetail: null,
  gatewayDetailLoading: false,
  selectedHealingId: localStorage.getItem("agentix.selectedHealingId") || "",
  selectedLogIndex: localStorage.getItem("agentix.selectedLogIndex") || "",
  selectedAuditId: localStorage.getItem("agentix.selectedAuditId") || "",
  audit: [],
  logs: [],
  supportBundle: null,
  diagnostics: null,
  usage: null,
  usageLoading: false,
  usageError: "",
  config: null,
  configLoading: false,
  configFeedback: "",
  events: [],
  health: null,
  taskDetail: null,
  taskDetailLoading: false,
  sessionDetail: null,
  sessionDetailLoading: false,
  jobDetail: null,
  jobDetailLoading: false,
  schedulerFeedback: null,
  approvalDetail: null,
  approvalDetailLoading: false,
  healingDetail: null,
  healingDetailLoading: false,
  auditDetail: null,
  auditDetailLoading: false,
  refreshPending: false,
  paletteOpen: false,
  paletteQuery: "",
  paletteIndex: 0,
  eventSource: null,
  lastError: "",
};

const el = (id) => document.getElementById(id);
const refs = {
  healthChip: el("healthChip"),
  backendChip: el("backendChip"),
  sessionChip: el("sessionChip"),
  tokenInput: el("tokenInput"),
  saveTokenButton: el("saveTokenButton"),
  refreshButton: el("refreshButton"),
  connectEventsButton: el("connectEventsButton"),
  clearEventsButton: el("clearEventsButton"),
  reloadTasksButton: el("reloadTasksButton"),
  reloadPlansButton: el("reloadPlansButton"),
  planDetail: el("planDetail"),
  reloadToolsButton: el("reloadToolsButton"),
  toolDetail: el("toolDetail"),
  reloadApprovalsButton: el("reloadApprovalsButton"),
  approvalDetail: el("approvalDetail"),
  healingDetail: el("healingDetail"),
  auditDetail: el("auditDetail"),
  reloadJobsButton: el("reloadJobsButton"),
  runDueJobsButton: el("runDueJobsButton"),
  schedulerFeedback: el("schedulerFeedback"),
  jobDetail: el("jobDetail"),
  reloadGatewayButton: el("reloadGatewayButton"),
  gatewayFilterInput: el("gatewayFilterInput"),
  gatewayDetail: el("gatewayDetail"),
  reloadHealingButton: el("reloadHealingButton"),
  reloadAuditButton: el("reloadAuditButton"),
  auditDetail: el("auditDetail"),
  reloadLogsButton: el("reloadLogsButton"),
  logDetail: el("logDetail"),
  reloadUsageButton: el("reloadUsageButton"),
  usageGeneratedAt: el("usageGeneratedAt"),
  usageSummary: el("usageSummary"),
  usageTaskStatuses: el("usageTaskStatuses"),
  usageJobStatuses: el("usageJobStatuses"),
  usageGateways: el("usageGateways"),
  usageNote: el("usageNote"),
  reloadConfigButton: el("reloadConfigButton"),
  configSummary: el("configSummary"),
  configForm: el("configForm"),
  configFeedback: el("configFeedback"),
  createSupportButton: el("createSupportButton"),
  reloadDiagnosticsButton: el("reloadDiagnosticsButton"),
  diagnosticsSummary: el("diagnosticsSummary"),
  diagnosticsList: el("diagnosticsList"),
  reloadSessionsButton: el("reloadSessionsButton"),
  pruneSessionsButton: el("pruneSessionsButton"),
  optimizeSessionsButton: el("optimizeSessionsButton"),
  sessionDetail: el("sessionDetail"),
  consolidateButton: el("consolidateButton"),
  newSessionButton: el("newSessionButton"),
  openPaletteButton: el("openPaletteButton"),
  closePaletteButton: el("closePaletteButton"),
  paletteBackdrop: el("paletteBackdrop"),
  paletteInput: el("paletteInput"),
  paletteResults: el("paletteResults"),
  reloadSearchButton: el("reloadSearchButton"),
  searchForm: el("searchForm"),
  searchInput: el("searchInput"),
  searchSummary: el("searchSummary"),
  searchTasksList: el("searchTasksList"),
  searchPlansList: el("searchPlansList"),
  searchSessionsList: el("searchSessionsList"),
  searchMemoryList: el("searchMemoryList"),
  searchLogsList: el("searchLogsList"),
  searchAuditList: el("searchAuditList"),
  searchJobsList: el("searchJobsList"),
  searchGatewaysList: el("searchGatewaysList"),
  searchHealingList: el("searchHealingList"),
  memoryForm: el("memoryForm"),
  jobForm: el("jobForm"),
  composeForm: el("composeForm"),
  composeInput: el("composeInput"),
  sessionSelect: el("sessionSelect"),
  taskFilterInput: el("taskFilterInput"),
  taskStatusFilter: el("taskStatusFilter"),
  approvalFilterInput: el("approvalFilterInput"),
  viewTitle: el("viewTitle"),
  statsGrid: el("statsGrid"),
  eventStream: el("eventStream"),
  tasksList: el("tasksList"),
  taskDetail: el("taskDetail"),
  plansList: el("plansList"),
  toolsList: el("toolsList"),
  approvalsList: el("approvalsList"),
  jobsList: el("jobsList"),
  gatewayList: el("gatewayList"),
  memoryList: el("memoryList"),
  healingList: el("healingList"),
  auditList: el("auditList"),
  logsList: el("logsList"),
  supportSummary: el("supportSummary"),
  supportList: el("supportList"),
  sessionsList: el("sessionsList"),
  composeHistory: el("composeHistory"),
};

const viewTitles = {
  live: "Live activity",
  tasks: "Tasks and state",
  plans: "Symphony plans",
  search: "Global search",
  tools: "Tools and capabilities",
  approvals: "Approval queue",
  scheduler: "Scheduler and jobs",
  gateway: "Gateway integrations",
  memory: "Memory search and consolidation",
  healing: "Healing and procedures",
  audit: "Audit trail",
  logs: "Logs",
  usage: "Runtime usage",
  config: "Backend config",
  diagnostics: "Doctor diagnostics",
  support: "Support bundle",
  sessions: "Sessions",
  compose: "Compose a task",
};

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === view);
  });
  refs.viewTitle.textContent = viewTitles[view] || "Agentix Control";
}

function fmtTime(ts) {
  if (!ts) return "n/a";
  const value = typeof ts === "string" ? new Date(ts) : new Date(ts);
  return value.toLocaleString();
}

function matchesFilter(value, filter) {
  if (!filter) return true;
  return String(value).toLowerCase().includes(filter.toLowerCase());
}

function saveToken() {
  localStorage.setItem("agentix.sessionToken", state.sessionToken);
}

function setSessionId(id) {
  state.sessionId = id || "";
  if (state.sessionId) {
    localStorage.setItem("agentix.sessionId", state.sessionId);
  } else {
    localStorage.removeItem("agentix.sessionId");
  }
  render();
}

function saveFilterState() {
  localStorage.setItem("agentix.selectedTaskId", state.selectedTaskId || "");
  localStorage.setItem("agentix.selectedPlanId", state.selectedPlanId || "");
  localStorage.setItem("agentix.selectedSessionId", state.selectedSessionId || "");
  localStorage.setItem("agentix.selectedJobId", state.selectedJobId || "");
  localStorage.setItem("agentix.selectedGatewayId", state.selectedGatewayId || "");
  localStorage.setItem("agentix.selectedToolId", state.selectedToolId || "");
  localStorage.setItem("agentix.selectedApprovalId", state.selectedApprovalId || "");
  localStorage.setItem("agentix.selectedHealingId", state.selectedHealingId || "");
  localStorage.setItem("agentix.selectedLogIndex", state.selectedLogIndex || "");
  localStorage.setItem("agentix.selectedAuditId", state.selectedAuditId || "");
  localStorage.setItem("agentix.taskFilter", state.taskFilter || "");
  localStorage.setItem("agentix.taskStatusFilter", state.taskStatusFilter || "");
  localStorage.setItem("agentix.approvalFilter", state.approvalFilter || "");
  localStorage.setItem("agentix.gatewayFilter", state.gatewayFilter || "");
  localStorage.setItem("agentix.searchQuery", state.searchQuery || "");
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.sessionToken) {
    headers.Authorization = `Bearer ${state.sessionToken}`;
  }
  const init = {
    ...opts,
    headers,
  };
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function eventStreamUrl() {
  if (!state.sessionToken) return "/events";
  const params = new URLSearchParams({ token: state.sessionToken });
  return `/events?${params.toString()}`;
}

function appendEvent(title, detail, tone = "") {
  state.events.unshift({
    title,
    detail,
    tone,
    createdAt: new Date().toISOString(),
  });
  state.events = state.events.slice(0, 80);
  renderEvents();
}

function paletteItems() {
  const base = [
    { title: "Live activity", hint: "Go to the live event stream", action: () => setView("live"), keywords: ["live", "events", "stream"] },
    { title: "Search", hint: "Search tasks, sessions, memory, logs, and jobs", action: () => setView("search"), keywords: ["search", "find", "query"] },
    { title: "Tasks", hint: "Inspect and control tasks", action: () => setView("tasks"), keywords: ["task", "tasks", "inspect"] },
    { title: "Plans", hint: "Inspect Symphony plans and step execution", action: () => setView("plans"), keywords: ["plan", "plans", "symphony", "steps"] },
    { title: "Tools", hint: "View available tools", action: () => setView("tools"), keywords: ["tool", "tools"] },
    { title: "Approvals", hint: "Open approval queue", action: () => setView("approvals"), keywords: ["approval", "approve", "reject"] },
    { title: "Scheduler", hint: "Manage scheduled jobs", action: () => setView("scheduler"), keywords: ["scheduler", "cron", "job"] },
    { title: "Gateway", hint: "Manage gateway integrations", action: () => setView("gateway"), keywords: ["gateway", "slack", "teams", "discord", "telegram", "webhook"] },
    { title: "Memory", hint: "Search and consolidate memory", action: () => setView("memory"), keywords: ["memory", "search"] },
    { title: "Healing", hint: "Review failure fingerprints", action: () => setView("healing"), keywords: ["heal", "healing", "failure"] },
    { title: "Audit", hint: "Inspect the audit trail", action: () => setView("audit"), keywords: ["audit", "log"] },
    { title: "Logs", hint: "Inspect runtime logs", action: () => setView("logs"), keywords: ["logs", "log"] },
    { title: "Usage", hint: "Inspect runtime counts and status breakdowns", action: async () => { setView("usage"); await loadUsage(); }, keywords: ["usage", "counts", "tasks", "jobs", "gateways"] },
    { title: "Config", hint: "Inspect and update Agentix backend config", action: async () => { setView("config"); await loadConfigPanel(); }, keywords: ["config", "provider", "model", "ports", "api"] },
    { title: "Doctor", hint: "Run backend readiness diagnostics", action: async () => { setView("diagnostics"); await loadDiagnostics(); }, keywords: ["doctor", "diagnostics", "health", "readiness"] },
    { title: "Support bundle", hint: "Generate runtime bundle", action: async () => { setView("support"); state.supportBundle = await api("/support/bundle", { method: "POST" }); appendEvent("support bundle", `Created bundle at ${state.supportBundle.bundleDir}`, "success"); render(); }, keywords: ["support", "bundle"] },
    { title: "Sessions", hint: "Open session management", action: () => setView("sessions"), keywords: ["session", "sessions"] },
    { title: "Compose", hint: "Write a new stimulus", action: () => setView("compose"), keywords: ["compose", "message", "prompt"] },
    { title: "Refresh all", hint: "Reload live backend state", action: refreshAll, keywords: ["refresh", "reload", "sync"] },
    { title: "Connect events", hint: "Reconnect the live event stream", action: connectEvents, keywords: ["connect", "events", "stream"] },
    { title: "Clear events", hint: "Clear the local live stream log", action: () => { state.events = []; renderEvents(); renderHistory(); }, keywords: ["clear", "events", "log"] },
    { title: "New session", hint: "Create a fresh session", action: async () => { const session = await api("/sessions", { method: "POST", body: JSON.stringify({}) }); setSessionId(session.id); await refreshAll(); setView("compose"); }, keywords: ["new", "session", "fresh"] },
  ];
  if (state.selectedTaskId) {
    const task = state.tasks.find((item) => item.id === state.selectedTaskId);
    if (task) {
      base.unshift(
        { title: `Open task ${task.id}`, hint: `Inspect the selected ${task.kind} task`, action: async () => { setView("tasks"); await loadTaskDetail(task.id); }, keywords: ["task", task.id, task.kind, "open"] },
      );
      if (task.status === "awaiting-approval") {
        base.unshift(
          { title: `Approve task ${task.id}`, hint: "Approve the selected pending task", action: async () => { await api(`/approvals/${encodeURIComponent(task.id)}/approve`, { method: "POST" }); await refreshAll(); }, keywords: ["approve", task.id] },
          { title: `Reject task ${task.id}`, hint: "Reject the selected pending task", action: async () => { await api(`/approvals/${encodeURIComponent(task.id)}/reject`, { method: "POST", body: JSON.stringify({ reason: "rejected from command palette" }) }); await refreshAll(); }, keywords: ["reject", task.id] },
        );
      }
      if (task.status === "queued" || task.status === "running" || task.status === "awaiting-approval") {
        base.unshift(
          { title: `Cancel task ${task.id}`, hint: "Stop the selected task", action: async () => { await api(`/tasks/${encodeURIComponent(task.id)}/action`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }); await refreshAll(); }, keywords: ["cancel", task.id] },
        );
      }
      if (task.status === "failed" || task.status === "rejected") {
        base.unshift(
          { title: `Retry task ${task.id}`, hint: "Retry the selected task", action: async () => { await api(`/tasks/${encodeURIComponent(task.id)}/action`, { method: "POST", body: JSON.stringify({ action: "retry" }) }); await refreshAll(); }, keywords: ["retry", task.id] },
          { title: `Restart task ${task.id}`, hint: "Restart the selected task", action: async () => { await api(`/tasks/${encodeURIComponent(task.id)}/action`, { method: "POST", body: JSON.stringify({ action: "restart" }) }); await refreshAll(); }, keywords: ["restart", task.id] },
        );
      }
    }
  }
  return base;
}

function filteredPaletteItems() {
  const needle = state.paletteQuery.trim().toLowerCase();
  const items = paletteItems();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack = [item.title, item.hint, ...(item.keywords || [])].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function renderPalette() {
  if (!refs.paletteBackdrop || !refs.paletteResults || !refs.paletteInput) return;
  refs.paletteBackdrop.hidden = !state.paletteOpen;
  if (!state.paletteOpen) return;
  refs.paletteInput.value = state.paletteQuery;
  const items = filteredPaletteItems();
  state.paletteIndex = Math.max(0, Math.min(state.paletteIndex, items.length - 1));
  refs.paletteResults.innerHTML = items.length
    ? items
        .map((item, index) => `
          <button class="palette-item ${index === state.paletteIndex ? "active" : ""}" data-palette-index="${index}" type="button">
            <span>
              <strong>${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.hint)}</span>
            </span>
            <span class="pill">${index + 1}</span>
          </button>
        `)
        .join("")
    : '<div class="card muted">No actions match your search.</div>';
}

function openPalette(initial = "") {
  state.paletteOpen = true;
  state.paletteQuery = initial;
  state.paletteIndex = 0;
  renderPalette();
  requestAnimationFrame(() => refs.paletteInput?.focus());
}

function closePalette() {
  state.paletteOpen = false;
  state.paletteQuery = "";
  state.paletteIndex = 0;
  renderPalette();
}

async function runPaletteSelection() {
  const items = filteredPaletteItems();
  const selected = items[state.paletteIndex];
  if (!selected) return;
  closePalette();
  await selected.action();
}

function scheduleRefresh(reason = "sync") {
  if (state.refreshPending) return;
  state.refreshPending = true;
  appendEvent("sync queued", reason, "warn");
  setTimeout(async () => {
    try {
      await refreshAll();
      appendEvent("sync complete", reason, "success");
    } catch (err) {
      appendEvent("sync failed", err instanceof Error ? err.message : String(err), "danger");
    } finally {
      state.refreshPending = false;
    }
  }, 200);
}

function renderEvents() {
  refs.eventStream.innerHTML = state.events
    .map(
      (event) => `
        <div class="event">
          <div class="row">
            <strong>${escapeHtml(event.title)}</strong>
            ${event.tone ? `<span class="pill ${event.tone}">${escapeHtml(event.tone)}</span>` : ""}
            <span class="meta">${fmtTime(event.createdAt)}</span>
          </div>
          <div class="muted">${escapeHtml(event.detail)}</div>
        </div>
      `,
    )
    .join("");
}

function renderStats() {
  const stats = [
    ["Session", state.sessionId || "none", state.health?.version || "Agentix"],
    ["Tasks", String(state.tasks.length), `${state.tasks.filter((task) => task.status !== "complete").length} open`],
    ["Plans", String(state.plans.length), `${state.plans.filter((plan) => plan.status === "awaiting-approval").length} paused`],
    ["Approvals", String(state.approvals.length), "awaiting decisions"],
    ["Scheduler", String(state.jobs.length), `${state.jobs.filter((job) => job.enabled).length} enabled`],
    ["Gateway", String(state.gateways.length), `${state.gateways.filter((gateway) => gateway.enabled).length} enabled`],
  ];
  refs.statsGrid.innerHTML = stats
    .map(
      ([label, value, sub]) => `
        <div>
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-value">${escapeHtml(value)}</div>
          <div class="stat-sub">${escapeHtml(sub)}</div>
        </div>
      `,
    )
    .join("");
}

function usageStatusTone(status) {
  const value = String(status).toLowerCase();
  if (["complete", "completed", "success", "succeeded", "pass"].includes(value)) return "success";
  if (["failed", "failure", "error", "rejected", "cancelled"].includes(value)) return "danger";
  if (["queued", "running", "awaiting-approval", "never-run", "warn"].includes(value)) return "warn";
  return "";
}

function usageBreakdown(entries, emptyMessage) {
  const rows = Object.entries(entries || {}).sort(([left], [right]) => left.localeCompare(right));
  return rows.length
    ? rows.map(([status, count]) => `
        <div class="usage-breakdown-row">
          <span class="pill ${usageStatusTone(status)}">${escapeHtml(status)}</span>
          <strong>${escapeHtml(count)}</strong>
        </div>
      `).join("")
    : `<div class="card muted">${escapeHtml(emptyMessage)}</div>`;
}

function renderUsage() {
  if (!refs.usageSummary) return;
  refs.reloadUsageButton.disabled = state.usageLoading;
  refs.reloadUsageButton.textContent = state.usageLoading ? "Loading..." : "Reload";

  if (state.usageLoading && !state.usage) {
    refs.usageGeneratedAt.textContent = "Loading current runtime usage...";
    refs.usageSummary.innerHTML = '<div class="card muted">Requesting usage from Agentix.</div>';
    refs.usageTaskStatuses.innerHTML = "";
    refs.usageJobStatuses.innerHTML = "";
    refs.usageGateways.innerHTML = "";
    refs.usageNote.textContent = "Provider usage details have not been loaded.";
    return;
  }

  if (!state.usage) {
    refs.usageGeneratedAt.textContent = state.usageError ? "Usage request failed." : "Usage has not been loaded yet.";
    refs.usageSummary.innerHTML = `<div class="card muted">${escapeHtml(state.usageError || "Reload to request runtime usage.")}</div>`;
    refs.usageTaskStatuses.innerHTML = "";
    refs.usageJobStatuses.innerHTML = "";
    refs.usageGateways.innerHTML = "";
    refs.usageNote.textContent = "Provider usage details have not been loaded.";
    return;
  }

  const counts = state.usage.counts || {};
  const countEntries = Object.entries(counts);
  refs.usageGeneratedAt.textContent = `Generated ${fmtTime(state.usage.generatedAt)}`;
  refs.usageSummary.innerHTML = countEntries.length
    ? countEntries.map(([label, count]) => `
        <div class="usage-metric">
          <div class="stat-label">${escapeHtml(label.replace(/([a-z])([A-Z])/g, "$1 $2"))}</div>
          <div class="stat-value">${escapeHtml(count)}</div>
        </div>
      `).join("")
    : '<div class="card muted">No runtime counts were returned.</div>';
  refs.usageTaskStatuses.innerHTML = usageBreakdown(state.usage.tasksByStatus, "No task statuses recorded.");
  refs.usageJobStatuses.innerHTML = usageBreakdown(state.usage.jobsByLastStatus, "No job statuses recorded.");
  refs.usageGateways.innerHTML = (state.usage.enabledGateways || []).length
    ? state.usage.enabledGateways.map((gateway) => `<span class="pill success">${escapeHtml(gateway)}</span>`).join("")
    : '<div class="card muted">No gateways are enabled.</div>';
  refs.usageNote.textContent = state.usage.note || "Runtime usage loaded.";
}

function configValue(key) {
  return state.config && state.config[key] !== undefined && state.config[key] !== null
    ? String(state.config[key])
    : "";
}

function renderConfigPanel() {
  if (!refs.configSummary) return;
  if (refs.reloadConfigButton) {
    refs.reloadConfigButton.disabled = state.configLoading;
    refs.reloadConfigButton.textContent = state.configLoading ? "Loading..." : "Reload";
  }
  if (refs.configFeedback) {
    refs.configFeedback.textContent = state.configFeedback || "Config values save to Agentix backend runtime config.";
  }

  if (!state.config) {
    refs.configSummary.innerHTML = `<div class="card muted">${state.configLoading ? "Loading backend config..." : "Reload to inspect backend config."}</div>`;
    return;
  }

  const form = refs.configForm;
  if (form) {
    for (const key of ["provider", "model", "baseUrl", "inboxPort", "bridgePort", "sessionTtlMs", "approvalTimeoutMs"]) {
      if (form.elements[key] && document.activeElement !== form.elements[key]) {
        form.elements[key].value = configValue(key);
      }
    }
  }

  refs.configSummary.innerHTML = `
    <div class="config-grid">
      <div class="usage-metric">
        <div class="stat-label">Provider</div>
        <div class="stat-value">${escapeHtml(state.config.provider || "n/a")}</div>
      </div>
      <div class="usage-metric">
        <div class="stat-label">Model</div>
        <div class="stat-value">${escapeHtml(state.config.model || "n/a")}</div>
      </div>
      <div class="usage-metric">
        <div class="stat-label">LLM key</div>
        <div class="stat-value">${state.config.llmApiKeyConfigured ? "Configured" : "Missing"}</div>
      </div>
      <div class="usage-metric">
        <div class="stat-label">API token</div>
        <div class="stat-value">${state.config.sessionTokenConfigured ? "Configured" : "Loopback only"}</div>
      </div>
    </div>
    <div class="card muted">
      <div>Workspace: ${escapeHtml(state.config.workspace || "n/a")}</div>
      <div>Data: ${escapeHtml(state.config.dataDir || "n/a")}</div>
      <div>Config: ${escapeHtml(state.config.configFile || "n/a")}</div>
      <div>Base URL: ${escapeHtml(state.config.baseUrl || "(provider default)")}</div>
    </div>
  `;
}

function taskCard(task) {
  return `
    <div class="card ${state.selectedTaskId === task.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(task.kind)}</h4>
        <span class="pill">${escapeHtml(task.status)}</span>
        ${task.requiresApproval ? '<span class="pill danger">approval</span>' : ""}
      </div>
      <div class="meta">${escapeHtml(task.id)} / ${escapeHtml(task.sessionId)}${task.planId ? ` / ${escapeHtml(task.planId)}` : ""}${task.stepId ? ` / step ${escapeHtml(task.stepId)}` : ""}</div>
      <div class="muted">${escapeHtml(JSON.stringify(task.payload, null, 2))}</div>
      <div class="meta">created ${fmtTime(task.createdAt)}${task.finishedAt ? ` · finished ${fmtTime(task.finishedAt)}` : ""}</div>
      <div class="row">
        <button class="ghost" data-action="select-task" data-id="${escapeHtml(task.id)}">Focus</button>
      </div>
    </div>
  `;
}

function planCard(plan) {
  const tone = plan.status === "complete" ? "success" : plan.status === "failed" ? "danger" : "warn";
  const progress = `${plan.completedSteps || 0}/${plan.stepCount || 0} steps`;
  return `
    <div class="card ${state.selectedPlanId === plan.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(plan.id)}</h4>
        <span class="pill ${tone}">${escapeHtml(plan.status)}</span>
        <span class="pill">${escapeHtml(plan.planner || "planner")}</span>
      </div>
      <div class="meta">${escapeHtml(plan.sessionId)} · ${progress} · ${plan.taskCount || 0} tasks</div>
      <div class="muted">${escapeHtml(plan.stimulus || "")}</div>
      <div class="meta">updated ${fmtTime(plan.updatedAt)}${plan.awaitingApprovals ? ` · approvals ${plan.awaitingApprovals}` : ""}${plan.failedTasks ? ` · failed ${plan.failedTasks}` : ""}</div>
      <div class="row">
        <button class="primary" data-action="inspect-plan" data-id="${escapeHtml(plan.id)}">Inspect</button>
      </div>
    </div>
  `;
}

function planDetailCard() {
  if (state.planDetailLoading) {
    return '<div class="card muted">Loading plan details...</div>';
  }
  if (!state.planDetail) {
    return '<div class="card muted">Select a Symphony plan to inspect step dependencies, task state, audit, and logs.</div>';
  }
  const { execution, steps, audit, logs } = state.planDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(execution.id)}</h4>
        <span class="pill ${execution.status === "complete" ? "success" : execution.status === "failed" ? "danger" : "warn"}">${escapeHtml(execution.status)}</span>
        <span class="pill">${escapeHtml(execution.planner)}</span>
      </div>
      <div class="meta">${escapeHtml(execution.sessionId)} · ${execution.stepCount} steps · ${execution.taskCount} tasks</div>
      <div class="muted">${escapeHtml(execution.stimulus)}</div>
      ${execution.reasoning ? `<div class="muted">Reasoning: ${escapeHtml(execution.reasoning)}</div>` : ""}
      ${execution.fallbackReason ? `<div class="muted danger-text">Fallback: ${escapeHtml(execution.fallbackReason)}</div>` : ""}
      <div class="panel-section">
        <div class="eyebrow">Step timeline</div>
        <div class="plan-timeline">
          ${steps.map(planStepCard).join("")}
        </div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded for this plan.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map((entry, index) => logCard(entry, index)).join("") : '<div class="card muted">No logs recorded for this plan.</div>'}</div>
      </div>
    </div>
  `;
}

function planStepCard(step) {
  const task = step.task;
  const status = task?.status || "pending";
  const tone = status === "complete" ? "success" : status === "failed" ? "danger" : status === "awaiting-approval" ? "warn" : "";
  return `
    <div class="plan-step ${tone}">
      <div class="row">
        <strong>${escapeHtml(step.id)}</strong>
        <span class="pill">${escapeHtml(step.kind)}</span>
        <span class="pill ${tone}">${escapeHtml(status)}</span>
        ${step.requiresApproval ? '<span class="pill danger">approval</span>' : ""}
      </div>
      <div class="meta">depends on ${escapeHtml(step.dependsOn?.join(", ") || "nothing")} · max attempts ${step.maxAttempts}</div>
      <div class="muted">${escapeHtml(JSON.stringify(step.payload, null, 2))}</div>
      ${
        task
          ? `<div class="meta">task ${escapeHtml(task.id)} · started ${fmtTime(task.startedAt)} · finished ${fmtTime(task.finishedAt)}</div>
             ${task.error ? `<div class="muted danger-text">${escapeHtml(task.error)}</div>` : ""}
             <div class="row"><button class="ghost" data-action="select-task" data-id="${escapeHtml(task.id)}">Open task</button></div>`
          : '<div class="meta">No task has been created for this step yet.</div>'
      }
    </div>
  `;
}

function toolCard(tool) {
  return `
    <div class="card ${state.selectedToolId === tool.name ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(tool.name)}</h4>
        <span class="pill success">ready</span>
      </div>
      <div class="muted">${escapeHtml(tool.description || "No description")}</div>
      <div class="row">
        <button class="primary" data-action="inspect-tool" data-id="${escapeHtml(tool.name)}">Inspect</button>
      </div>
    </div>
  `;
}

function toolDetailCard() {
  if (state.toolDetailLoading) {
    return '<div class="card muted">Loading tool details...</div>';
  }
  if (!state.toolDetail) {
    return '<div class="card muted">Select a tool to inspect its health, recent activity, and audit trail.</div>';
  }
  const { tool, summary, audit, logs } = state.toolDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(tool.id)}</h4>
        <span class="pill ${tool.healthy ? "success" : "danger"}">${tool.healthy ? "healthy" : "unhealthy"}</span>
      </div>
      <div class="meta">kind ${escapeHtml(tool.kind)}</div>
      <div class="row">
        <button class="ghost" data-action="inspect-tool" data-id="${escapeHtml(tool.id)}">Reload</button>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Recent tasks</div>
        <div class="list">
          ${
            summary?.recentTasks?.length
              ? summary.recentTasks.map(taskCard).join("")
              : '<div class="card muted">No recent tasks for this tool.</div>'
          }
        </div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">
          ${
            audit && audit.length
              ? audit.map(auditCard).join("")
              : '<div class="card muted">No audit entries for this tool.</div>'
          }
        </div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">
          ${
            logs && logs.length
              ? logs.map(logCard).join("")
              : '<div class="card muted">No logs for this tool.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function taskDetailCard() {
  if (state.taskDetailLoading) {
    return '<div class="card muted">Loading task details...</div>';
  }
  if (!state.taskDetail) {
    return '<div class="card muted">Select a task to inspect details and recent activity.</div>';
  }
  const { task, memory, audit, logs, session } = state.taskDetail;
  const canApprove = task.status === "awaiting-approval";
  const canRetry = task.status === "failed" || task.status === "rejected";
  const canCancel = task.status === "queued" || task.status === "running" || task.status === "awaiting-approval";
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(task.kind)} details</h4>
        <span class="pill">${escapeHtml(task.status)}</span>
        ${task.requiresApproval ? '<span class="pill danger">approval</span>' : ""}
      </div>
      <div class="meta">${escapeHtml(task.id)} / ${escapeHtml(task.sessionId)}</div>
      <div class="muted"><pre>${escapeHtml(JSON.stringify(task, null, 2))}</pre></div>
      <div class="row">
        <button class="ghost" data-action="select-session" data-id="${escapeHtml(task.sessionId)}">Open session</button>
        ${canApprove ? `<button class="primary" data-action="approve-task-detail" data-id="${escapeHtml(task.id)}">Approve</button>` : ""}
        ${canApprove ? `<button class="ghost" data-action="reject-task-detail" data-id="${escapeHtml(task.id)}">Reject</button>` : ""}
        ${canCancel ? `<button class="ghost danger" data-action="cancel-task-detail" data-id="${escapeHtml(task.id)}">Cancel</button>` : ""}
        ${canRetry ? `<button class="primary" data-action="retry-task-detail" data-id="${escapeHtml(task.id)}">Retry</button>` : ""}
        ${canRetry ? `<button class="ghost" data-action="restart-task-detail" data-id="${escapeHtml(task.id)}">Restart</button>` : ""}
        <button class="ghost" data-action="copy-task-json" data-id="${escapeHtml(task.id)}">Copy JSON</button>
      </div>
      ${session ? `
        <div class="panel-section">
          <div class="eyebrow">Session</div>
          <div class="card">
            <div class="row">
              <strong>${escapeHtml(session.id)}</strong>
              <span class="pill">${escapeHtml(session.status)}</span>
            </div>
            <div class="meta">created ${fmtTime(session.createdAt)} · updated ${fmtTime(session.updatedAt)}</div>
          </div>
        </div>
      ` : ""}
      <div class="panel-section">
        <div class="eyebrow">Related memory</div>
        <div class="list">
          ${
            memory && memory.length
              ? memory
                  .map(
                    (entry) => `
                      <div class="card">
                        <div class="row">
                          <strong>${escapeHtml(entry.role)}</strong>
                          <span class="meta">${fmtTime(entry.createdAt)}</span>
                        </div>
                        <div class="muted">${escapeHtml(entry.content)}</div>
                      </div>
                    `,
                  )
                  .join("")
              : '<div class="card muted">No memory entries yet.</div>'
          }
        </div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit trail</div>
        <div class="list">
          ${
            audit && audit.length
              ? audit
                  .map(
                    (entry) => `
                      <div class="card">
                        <div class="row">
                          <strong>${escapeHtml(entry.type)}</strong>
                          <span class="pill">${escapeHtml(entry.actor)}</span>
                          <span class="meta">${fmtTime(entry.createdAt)}</span>
                        </div>
                        <div class="muted">${escapeHtml(JSON.stringify(entry.data, null, 2))}</div>
                      </div>
                    `,
                  )
                  .join("")
              : '<div class="card muted">No audit entries found for this task.</div>'
          }
        </div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Runtime logs</div>
        <div class="list">
          ${
            logs && logs.length
              ? logs
                  .map(
                    (entry) => `
                      <div class="card log-line">
                        <div class="row">
                          <strong>${escapeHtml(entry.level)}</strong>
                          <span class="pill">${escapeHtml(entry.source)}</span>
                          <span class="meta">${escapeHtml(entry.timestamp)}</span>
                        </div>
                        <div class="muted">${escapeHtml(entry.message)}</div>
                      </div>
                    `,
                  )
                  .join("")
              : '<div class="card muted">No logs match this task yet.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function approvalCard(task) {
  return `
    <div class="card ${state.selectedApprovalId === task.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(task.kind)}</h4>
        <span class="pill danger">pending</span>
      </div>
      <div class="meta">${escapeHtml(task.id)} / ${escapeHtml(task.sessionId)}</div>
      <div class="muted">${escapeHtml(JSON.stringify(task.payload, null, 2))}</div>
      <div class="row">
        <button class="primary" data-action="inspect-approval" data-id="${escapeHtml(task.id)}">Inspect</button>
        <button class="primary" data-action="approve" data-id="${escapeHtml(task.id)}">Approve</button>
        <button class="ghost" data-action="reject" data-id="${escapeHtml(task.id)}">Reject</button>
        <button class="ghost" data-action="select-task" data-id="${escapeHtml(task.id)}">Inspect</button>
      </div>
    </div>
  `;
}

function approvalDetailCard() {
  if (state.approvalDetailLoading) {
    return '<div class="card muted">Loading approval details...</div>';
  }
  if (!state.approvalDetail) {
    return '<div class="card muted">Select a pending approval to inspect its task, session, logs, and audit trail.</div>';
  }
  const { approval, task, session, memory, audit, logs } = state.approvalDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(approval.kind)}</h4>
        <span class="pill danger">${escapeHtml(approval.status)}</span>
      </div>
      <div class="meta">${escapeHtml(approval.id)} / ${escapeHtml(approval.sessionId)}</div>
      <div class="muted"><pre>${escapeHtml(JSON.stringify(approval.payload, null, 2))}</pre></div>
      <div class="row">
        <button class="primary" data-action="approve" data-id="${escapeHtml(approval.id)}">Approve</button>
        <button class="ghost" data-action="reject" data-id="${escapeHtml(approval.id)}">Reject</button>
        <button class="ghost" data-action="inspect-task" data-id="${escapeHtml(approval.id)}">Inspect task</button>
      </div>
      ${task ? `
        <div class="panel-section">
          <div class="eyebrow">Task</div>
          <div class="card">
            <div class="row">
              <strong>${escapeHtml(task.id)}</strong>
              <span class="pill">${escapeHtml(task.status)}</span>
            </div>
            <div class="meta">${escapeHtml(task.kind)} · created ${fmtTime(task.createdAt)}</div>
          </div>
        </div>
      ` : ""}
      ${session ? `
        <div class="panel-section">
          <div class="eyebrow">Session</div>
          <div class="card">
            <div class="row">
              <strong>${escapeHtml(session.id)}</strong>
              <span class="pill">${escapeHtml(session.status)}</span>
            </div>
            <div class="meta">created ${fmtTime(session.createdAt)} · updated ${fmtTime(session.updatedAt)}</div>
          </div>
        </div>
      ` : ""}
      <div class="panel-section">
        <div class="eyebrow">Memory</div>
        <div class="list">${memory.length ? memory.map(memoryCard).join("") : '<div class="card muted">No memory recorded for this approval.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded for this approval.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map(logCard).join("") : '<div class="card muted">No logs recorded for this approval.</div>'}</div>
      </div>
    </div>
  `;
}

function healingDetailCard() {
  if (state.healingDetailLoading) {
    return '<div class="card muted">Loading healing details...</div>';
  }
  if (!state.healingDetail) {
    return '<div class="card muted">Select a failure fingerprint or procedure to inspect recovery history.</div>';
  }
  const { failure, procedure, relatedTasks, audit, logs } = state.healingDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(procedure?.id || failure?.fingerprint || "Healing detail")}</h4>
        <span class="pill ${procedure?.status === "promoted" ? "success" : procedure?.status === "deprecated" ? "danger" : "warn"}">${escapeHtml(procedure?.status || (failure ? "failure" : "unknown"))}</span>
      </div>
      ${failure ? `
        <div class="meta">fingerprint ${escapeHtml(failure.fingerprint)} · count ${failure.count}</div>
        <div class="muted">${escapeHtml(failure.lastError)}</div>
        <div class="meta">first ${fmtTime(failure.firstSeenAt)} · last ${fmtTime(failure.lastSeenAt)}</div>
      ` : ""}
      ${procedure ? `
        <div class="meta">procedure ${escapeHtml(procedure.id)} · uses ${procedure.uses}</div>
        <div class="muted">${escapeHtml(procedure.summary)}</div>
      ` : ""}
      <div class="row">
        ${procedure ? `<button class="primary" data-action="promote-proc" data-id="${escapeHtml(procedure.id)}">Promote</button>` : ""}
        ${procedure ? `<button class="ghost" data-action="deprecate-proc" data-id="${escapeHtml(procedure.id)}">Deprecate</button>` : ""}
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related tasks</div>
        <div class="list">${relatedTasks.length ? relatedTasks.map(taskCard).join("") : '<div class="card muted">No related tasks recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map(logCard).join("") : '<div class="card muted">No logs recorded yet.</div>'}</div>
      </div>
    </div>
  `;
}

function filteredTasks() {
  return state.tasks.filter((task) => {
    const haystack = [task.id, task.sessionId, task.kind, task.status, JSON.stringify(task.payload)].join(" ");
    return matchesFilter(haystack, state.taskFilter) && (!state.taskStatusFilter || task.status === state.taskStatusFilter);
  });
}

function filteredApprovals() {
  return state.approvals.filter((task) => {
    const haystack = [task.id, task.sessionId, task.kind, JSON.stringify(task.payload)].join(" ");
    return matchesFilter(haystack, state.approvalFilter);
  });
}

function jobSchedule(job) {
  if (job.scheduleDisplay) return job.scheduleDisplay;
  if (job.schedule) return job.schedule;
  return `every ${Math.round(Number(job.intervalMs || 60000) / 1000)}s`;
}

function jobStatus(job) {
  if (!job.lastStatus) return "";
  const statusClass = job.lastStatus === "success" || job.lastStatus === "ok" ? "success" : "danger";
  return `<span class="pill ${statusClass}">${escapeHtml(job.lastStatus)}</span>`;
}

function parseSkills(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function setSchedulerFeedback(message, tone = "success") {
  state.schedulerFeedback = { message, tone };
  renderSchedulerFeedback();
}

function renderSchedulerFeedback() {
  if (!refs.schedulerFeedback) return;
  if (!state.schedulerFeedback) {
    refs.schedulerFeedback.hidden = true;
    refs.schedulerFeedback.textContent = "";
    refs.schedulerFeedback.className = "scheduler-feedback";
    return;
  }
  refs.schedulerFeedback.hidden = false;
  refs.schedulerFeedback.textContent = state.schedulerFeedback.message;
  refs.schedulerFeedback.className = `scheduler-feedback ${state.schedulerFeedback.tone}`;
}

function jobCard(job) {
  return `
    <div class="card ${state.selectedJobId === job.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(job.name)}</h4>
        <span class="pill ${job.enabled ? "success" : "danger"}">${job.enabled ? "enabled" : "disabled"}</span>
        ${jobStatus(job)}
      </div>
      <div class="meta">${escapeHtml(job.id)} · ${escapeHtml(jobSchedule(job))}</div>
      <div class="muted">${escapeHtml(job.stimulus)}</div>
      <div class="meta">next ${fmtTime(job.nextRunAt)} · last ${fmtTime(job.lastRunAt)}</div>
      ${job.lastError ? `<div class="muted danger-text">${escapeHtml(job.lastError)}</div>` : ""}
      <div class="row">
        <button class="primary" data-action="inspect-job" data-id="${escapeHtml(job.id)}">Inspect</button>
        <button class="primary" data-action="run-job" data-id="${escapeHtml(job.id)}">Run now</button>
        <button class="ghost" data-action="toggle-job" data-id="${escapeHtml(job.id)}">${job.enabled ? "Disable" : "Enable"}</button>
        <button class="ghost danger" data-action="delete-job" data-id="${escapeHtml(job.id)}">Delete</button>
      </div>
    </div>
  `;
}

function jobDetailCard() {
  if (state.jobDetailLoading) {
    return '<div class="card muted">Loading job details...</div>';
  }
  if (!state.jobDetail) {
    return '<div class="card muted">Select a scheduled job to inspect its audit trail and related tasks.</div>';
  }
  const { job, audit, relatedTasks } = state.jobDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(job.name)}</h4>
        <span class="pill ${job.enabled ? "success" : "danger"}">${job.enabled ? "enabled" : "disabled"}</span>
        ${jobStatus(job)}
      </div>
      <div class="meta">${escapeHtml(job.id)} · ${escapeHtml(jobSchedule(job))}</div>
      <div class="meta">next ${fmtTime(job.nextRunAt)} · last ${fmtTime(job.lastRunAt)} · runs ${job.runCount}</div>
      ${job.lastError ? `<div class="muted danger-text">${escapeHtml(job.lastError)}</div>` : ""}
      <form class="job-edit-form" data-job-edit="${escapeHtml(job.id)}">
        <label>
          <span>Name</span>
          <input name="name" value="${escapeHtml(job.name)}" required />
        </label>
        <label>
          <span>Schedule</span>
          <input name="schedule" value="${escapeHtml(job.schedule || jobSchedule(job))}" required />
        </label>
        <label class="wide">
          <span>Stimulus</span>
          <textarea name="stimulus" rows="3">${escapeHtml(job.stimulus || "")}</textarea>
        </label>
        <label>
          <span>Script</span>
          <input name="script" value="${escapeHtml(job.script || "")}" placeholder="Optional script path" />
        </label>
        <label>
          <span>Working directory</span>
          <input name="workdir" value="${escapeHtml(job.workdir || "")}" placeholder="Optional absolute path" />
        </label>
        <label class="wide">
          <span>Skills</span>
          <input name="skills" value="${escapeHtml((job.skills || []).join(", "))}" placeholder="Comma separated" />
        </label>
        <label class="check-field wide">
          <input name="noAgent" type="checkbox" ${job.noAgent ? "checked" : ""} />
          <span>Run script without agent</span>
        </label>
        <div class="row wide">
          <button class="primary" type="submit">Save changes</button>
        </div>
      </form>
      <div class="row">
        <button class="primary" data-action="run-job" data-id="${escapeHtml(job.id)}">Run now</button>
        <button class="ghost" data-action="toggle-job" data-id="${escapeHtml(job.id)}">${job.enabled ? "Disable" : "Enable"}</button>
        <button class="ghost danger" data-action="delete-job" data-id="${escapeHtml(job.id)}">Delete</button>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related tasks</div>
        <div class="list">${relatedTasks.length ? relatedTasks.map(taskCard).join("") : '<div class="card muted">No related tasks recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded yet.</div>'}</div>
      </div>
    </div>
  `;
}

function filteredGateways() {
  return state.gateways.filter((gateway) => {
    const haystack = [
      gateway.id,
      gateway.name,
      gateway.platform,
      gateway.status,
      gateway.endpoint,
    ].join(" ");
    return matchesFilter(haystack, state.gatewayFilter);
  });
}

function gatewayCard(gateway) {
  return `
    <div class="card ${state.selectedGatewayId === gateway.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(gateway.name)}</h4>
        <span class="pill ${gateway.enabled ? "success" : "danger"}">${gateway.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div class="meta">${escapeHtml(gateway.id)} · ${escapeHtml(gateway.platform)} · ${escapeHtml(gateway.status)}</div>
      <div class="muted">${escapeHtml(gateway.endpoint || "No endpoint configured")}</div>
      <div class="meta">messages ${gateway.messageCount} · last ${fmtTime(gateway.lastSeenAt)}</div>
      <div class="row">
        <button class="primary" data-action="inspect-gateway" data-id="${escapeHtml(gateway.id)}">Inspect</button>
        <button class="ghost" data-action="toggle-gateway" data-id="${escapeHtml(gateway.id)}">${gateway.enabled ? "Disable" : "Enable"}</button>
      </div>
    </div>
  `;
}

function gatewayDetailCard() {
  if (state.gatewayDetailLoading) {
    return '<div class="card muted">Loading gateway details...</div>';
  }
  if (!state.gatewayDetail) {
    return '<div class="card muted">Select a gateway to inspect related sessions, tasks, logs, and audit trail.</div>';
  }
  const { gateway, relatedSessions, relatedTasks, audit, logs } = state.gatewayDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(gateway.name)}</h4>
        <span class="pill ${gateway.enabled ? "success" : "danger"}">${gateway.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div class="meta">${escapeHtml(gateway.id)} · ${escapeHtml(gateway.platform)} · ${escapeHtml(gateway.status)}</div>
      <div class="muted">${escapeHtml(gateway.endpoint || "No endpoint configured")}</div>
      <div class="meta">messages ${gateway.messageCount} · last ${fmtTime(gateway.lastSeenAt)} · token ${gateway.tokenConfigured ? "configured" : "missing"}</div>
      <div class="row">
        <button class="primary" data-action="toggle-gateway" data-id="${escapeHtml(gateway.id)}">${gateway.enabled ? "Disable" : "Enable"}</button>
        <button class="ghost" data-action="gateway-test" data-id="${escapeHtml(gateway.id)}">Send test</button>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related sessions</div>
        <div class="list">${relatedSessions.length ? relatedSessions.map(sessionCard).join("") : '<div class="card muted">No related sessions recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related tasks</div>
        <div class="list">${relatedTasks.length ? relatedTasks.map(taskCard).join("") : '<div class="card muted">No related tasks recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded yet.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map((entry, index) => logCard(entry, index)).join("") : '<div class="card muted">No logs recorded yet.</div>'}</div>
      </div>
    </div>
  `;
}

function memoryCard(item) {
  return `
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(item.role)}</h4>
        <span class="pill">${escapeHtml(item.tags?.join(", ") || "memory")}</span>
      </div>
      <div class="meta">${escapeHtml(item.sessionId)}${item.taskId ? ` · ${escapeHtml(item.taskId)}` : ""}</div>
      <div class="muted">${escapeHtml(item.content)}</div>
      <div class="meta">${fmtTime(item.createdAt)}</div>
    </div>
  `;
}

function memorySearchCard(item) {
  const score = Number(item.score);
  const scoreLabel = Number.isFinite(score) ? score.toFixed(2) : "n/a";
  return `
    <div class="card">
      <div class="row">
        <h4>Memory match</h4>
        <span class="pill">score ${escapeHtml(scoreLabel)}</span>
      </div>
      <div class="muted">${escapeHtml(item.content)}</div>
    </div>
  `;
}

function healingView() {
  const failureList = (state.healing.failures || [])
    .map(
      (failure) => `
        <div class="card ${state.selectedHealingId === failure.fingerprint ? "selected" : ""}">
          <div class="row">
            <h4>${escapeHtml(failure.fingerprint)}</h4>
            <span class="pill">${failure.count}x</span>
          </div>
          <div class="muted">${escapeHtml(failure.lastError)}</div>
          <div class="meta">${fmtTime(failure.firstSeenAt)} - ${fmtTime(failure.lastSeenAt)}</div>
          <div class="row">
            <button class="primary" data-action="inspect-healing" data-id="${escapeHtml(failure.fingerprint)}">Inspect</button>
          </div>
        </div>
      `,
    )
    .join("");

  const procList = (state.healing.procedures || [])
    .map(
      (procedure) => `
        <div class="card ${state.selectedHealingId === procedure.id ? "selected" : ""}">
          <div class="row">
            <h4>${escapeHtml(procedure.status)}</h4>
            <span class="pill">${escapeHtml(procedure.id)}</span>
          </div>
          <div class="muted">${escapeHtml(procedure.summary)}</div>
          <div class="meta">${escapeHtml(procedure.fingerprint)} · uses ${procedure.uses || 0}</div>
          <div class="row">
            <button class="primary" data-action="inspect-healing" data-id="${escapeHtml(procedure.id)}">Inspect</button>
            <button class="primary" data-action="promote-proc" data-id="${escapeHtml(procedure.id)}">Promote</button>
            <button class="ghost" data-action="deprecate-proc" data-id="${escapeHtml(procedure.id)}">Deprecate</button>
          </div>
        </div>
      `,
    )
    .join("");

  return `
    <div class="panel-section">
      <div class="eyebrow">Failures</div>
      <div class="list">${failureList || '<div class="card muted">No failures recorded yet.</div>'}</div>
    </div>
    <div class="panel-section">
      <div class="eyebrow">Procedures</div>
      <div class="list">${procList || '<div class="card muted">No procedures promoted yet.</div>'}</div>
    </div>
  `;
}

function auditCard(entry) {
  return `
    <div class="card ${state.selectedAuditId === entry.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(entry.type)}</h4>
        <span class="pill">${escapeHtml(entry.actor)}</span>
      </div>
      <div class="meta">${escapeHtml(entry.id)}${entry.subjectId ? ` · ${escapeHtml(entry.subjectId)}` : ""}</div>
      <div class="muted">${escapeHtml(JSON.stringify(entry.data, null, 2))}</div>
      <div class="meta">${fmtTime(entry.createdAt)}</div>
      <div class="row">
        <button class="primary" data-action="inspect-audit" data-id="${escapeHtml(entry.id)}">Inspect</button>
      </div>
    </div>
  `;
}

function auditDetailCard() {
  if (state.auditDetailLoading) {
    return '<div class="card muted">Loading audit details...</div>';
  }
  if (!state.auditDetail) {
    return '<div class="card muted">Select an audit entry to inspect related tasks, sessions, and logs.</div>';
  }
  const { audit, relatedTasks, relatedSessions, logs } = state.auditDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(audit.type)}</h4>
        <span class="pill">${escapeHtml(audit.actor)}</span>
      </div>
      <div class="meta">${escapeHtml(audit.id)}${audit.subjectId ? ` · ${escapeHtml(audit.subjectId)}` : ""}</div>
      <div class="muted"><pre>${escapeHtml(JSON.stringify(audit.data, null, 2))}</pre></div>
      <div class="panel-section">
        <div class="eyebrow">Related tasks</div>
        <div class="list">${relatedTasks.length ? relatedTasks.map(taskCard).join("") : '<div class="card muted">No related tasks recorded for this audit entry.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related sessions</div>
        <div class="list">${relatedSessions.length ? relatedSessions.map(sessionCard).join("") : '<div class="card muted">No related sessions recorded for this audit entry.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map((entry, index) => logCard(entry, index)).join("") : '<div class="card muted">No logs recorded for this audit entry.</div>'}</div>
      </div>
    </div>
  `;
}

function logCard(entry, index) {
  return `
    <div class="card log-line ${state.selectedLogIndex === String(index) ? "selected" : ""}">
      <div class="row">
        <strong>${escapeHtml(entry.level)}</strong>
        <span class="pill">${escapeHtml(entry.source)}</span>
        <span class="meta">${escapeHtml(entry.timestamp)}</span>
      </div>
      <div class="muted">${escapeHtml(entry.message)}</div>
      ${typeof index === "number" ? `<div class="row"><button class="primary" data-action="inspect-log" data-id="${escapeHtml(String(index))}">Inspect</button></div>` : ""}
    </div>
  `;
}

function logDetailCard() {
  if (state.logDetailLoading) {
    return '<div class="card muted">Loading log details...</div>';
  }
  if (!state.logDetail) {
    return '<div class="card muted">Select a log entry to inspect related tasks, sessions, and audit trail.</div>';
  }
  const { log, relatedTasks, relatedSessions, audit } = state.logDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>${escapeHtml(log?.level || "Log")}</h4>
        <span class="pill">${escapeHtml(log?.source || "system")}</span>
      </div>
      <div class="meta">index ${escapeHtml(String(log?.index ?? ""))} · ${escapeHtml(log?.timestamp || "")}</div>
      <div class="muted">${escapeHtml(log?.message || "")}</div>
      <div class="panel-section">
        <div class="eyebrow">Related tasks</div>
        <div class="list">${relatedTasks.length ? relatedTasks.map(taskCard).join("") : '<div class="card muted">No related tasks recorded for this log.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Related sessions</div>
        <div class="list">${relatedSessions.length ? relatedSessions.map(sessionCard).join("") : '<div class="card muted">No related sessions recorded for this log.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded for this log.</div>'}</div>
      </div>
    </div>
  `;
}

function supportCard(bundle) {
  return `
    <div class="card">
      <div class="row">
        <h4>Bundle created</h4>
        <span class="pill success">${escapeHtml(bundle.bundleDir || "ok")}</span>
      </div>
      <div class="muted">Files: ${(bundle.files || []).map((file) => escapeHtml(file)).join(", ")}</div>
    </div>
  `;
}

function diagnosticsCards() {
  if (!state.diagnostics) {
    return '<div class="card muted">No diagnostics loaded yet.</div>';
  }
  const checks = state.diagnostics.checks || [];
  return checks.map((check) => {
    const tone = check.status === "pass" ? "success" : check.status === "fail" ? "danger" : "warn";
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(check.label || check.id)}</h4>
          <span class="pill ${tone}">${escapeHtml(check.status)}</span>
        </div>
        <div class="muted">${escapeHtml(check.detail || "")}</div>
        ${check.action ? `<div class="meta">Action: ${escapeHtml(check.action)}</div>` : ""}
      </div>
    `;
  }).join("") || '<div class="card muted">Diagnostics returned no checks.</div>';
}

function diagnosticsSummaryText() {
  if (!state.diagnostics) {
    return "Run backend diagnostics to verify setup, runtime state, integrations, and recovery readiness.";
  }
  const counts = state.diagnostics.counts || {};
  const config = state.diagnostics.config || {};
  return [
    `Status: ${String(state.diagnostics.status || "unknown").toUpperCase()}`,
    `Workspace: ${state.diagnostics.workspace || "n/a"}`,
    `Provider/model: ${config.provider || "n/a"} / ${config.model || "n/a"}`,
    `LLM key: ${config.llmApiKeyConfigured ? "configured" : "missing"}`,
    `Sessions ${counts.sessions || 0} · Tasks ${counts.tasks || 0} · Plans ${counts.plans || 0} · Approvals ${counts.approvals || 0}`,
    `Jobs ${counts.jobs || 0} · Gateways ${counts.gateways || 0} · Memory ${counts.memory || 0} · Healing ${counts.healingProcedures || 0}`,
  ].join("\n");
}

function sessionCard(session) {
  const title = session.metadata?.title;
  const source = session.metadata?.source;
  return `
    <div class="card ${state.selectedSessionId === session.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(title || session.id)}</h4>
        <span class="pill">${escapeHtml(session.status || "active")}</span>
      </div>
      <div class="meta">${escapeHtml(session.id)} - created ${fmtTime(session.createdAt)}${source ? ` - ${escapeHtml(source)}` : ""}</div>
      <div class="row">
        <button class="primary" data-action="inspect-session" data-id="${escapeHtml(session.id)}">Inspect</button>
        <button class="ghost" data-action="select-session" data-id="${escapeHtml(session.id)}">Use</button>
        <button class="ghost" data-action="rename-session" data-id="${escapeHtml(session.id)}">Rename</button>
        <button class="ghost" data-action="delete-session" data-id="${escapeHtml(session.id)}">Close</button>
      </div>
    </div>
  `;
}

function sessionDetailCard() {
  if (state.sessionDetailLoading) {
    return '<div class="card muted">Loading session details...</div>';
  }
  if (!state.sessionDetail) {
    return '<div class="card muted">Select a session to inspect tasks, memory, logs, and audit trail.</div>';
  }
  const { session, tasks, memory, audit, logs } = state.sessionDetail;
  return `
    <div class="card selected">
      <div class="row">
        <h4>Session ${escapeHtml(session.id)}</h4>
        <span class="pill">${escapeHtml(session.status)}</span>
      </div>
      <div class="meta">created ${fmtTime(session.createdAt)} · updated ${fmtTime(session.updatedAt)}</div>
      <div class="muted"><pre>${escapeHtml(JSON.stringify(session.metadata || {}, null, 2))}</pre></div>
      <div class="row">
        <button class="primary" data-action="select-session" data-id="${escapeHtml(session.id)}">Use in composer</button>
        <button class="ghost" data-action="rename-session" data-id="${escapeHtml(session.id)}">Rename</button>
        <button class="ghost" data-action="delete-session" data-id="${escapeHtml(session.id)}">Close</button>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Tasks</div>
        <div class="list">${tasks.length ? tasks.map(taskCard).join("") : '<div class="card muted">No tasks recorded for this session.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Memory</div>
        <div class="list">${memory.length ? memory.map(memoryCard).join("") : '<div class="card muted">No memory recorded for this session.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Audit</div>
        <div class="list">${audit.length ? audit.map(auditCard).join("") : '<div class="card muted">No audit entries recorded for this session.</div>'}</div>
      </div>
      <div class="panel-section">
        <div class="eyebrow">Logs</div>
        <div class="list">${logs.length ? logs.map(logCard).join("") : '<div class="card muted">No logs recorded for this session.</div>'}</div>
      </div>
    </div>
  `;
}

function renderLists() {
  const visibleTasks = filteredTasks();
  const visibleApprovals = filteredApprovals();
  const visibleGateways = filteredGateways();
  if (!visibleTasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = visibleTasks[0]?.id || state.tasks[0]?.id || "";
    saveFilterState();
  }
  if (!state.selectedSessionId && state.sessionId) {
    state.selectedSessionId = state.sessionId;
    saveFilterState();
  }
  if (!state.selectedSessionId && state.sessions[0]?.id) {
    state.selectedSessionId = state.sessions[0].id;
    saveFilterState();
  }
  if (state.selectedTaskId && (!state.taskDetail || state.taskDetail.task.id !== state.selectedTaskId) && !state.taskDetailLoading) {
    void loadTaskDetail(state.selectedTaskId);
  }
  if (!state.selectedPlanId && state.plans[0]?.id) {
    state.selectedPlanId = state.plans[0].id;
    saveFilterState();
  }
  if (state.selectedPlanId && (!state.planDetail || state.planDetail.execution.id !== state.selectedPlanId) && !state.planDetailLoading) {
    void loadPlanDetail(state.selectedPlanId);
  }
  if (state.selectedSessionId && (!state.sessionDetail || state.sessionDetail.session.id !== state.selectedSessionId) && !state.sessionDetailLoading) {
    void loadSessionDetail(state.selectedSessionId);
  }
  if (!state.selectedToolId && state.tools[0]?.name) {
    state.selectedToolId = state.tools[0].name;
    saveFilterState();
  }
  if (state.selectedToolId && (!state.toolDetail || state.toolDetail.tool.id !== state.selectedToolId) && !state.toolDetailLoading) {
    void loadToolDetail(state.selectedToolId);
  }
  if (!state.selectedApprovalId && visibleApprovals[0]?.id) {
    state.selectedApprovalId = visibleApprovals[0].id;
    saveFilterState();
  }
  if (state.selectedApprovalId && (!state.approvalDetail || state.approvalDetail.approval.id !== state.selectedApprovalId) && !state.approvalDetailLoading) {
    void loadApprovalDetail(state.selectedApprovalId);
  }
  if (!state.selectedHealingId && state.healing.failures[0]?.fingerprint) {
    state.selectedHealingId = state.healing.failures[0].fingerprint;
    saveFilterState();
  }
  if (state.selectedHealingId && (!state.healingDetail || (state.healingDetail.failure?.fingerprint !== state.selectedHealingId && state.healingDetail.procedure?.id !== state.selectedHealingId)) && !state.healingDetailLoading) {
    void loadHealingDetail(state.selectedHealingId);
  }
  if (!state.selectedLogIndex && state.logs[0]) {
    state.selectedLogIndex = "0";
    saveFilterState();
  }
  if (state.selectedLogIndex !== "" && (!state.logDetail || state.logDetail.log?.index !== Number(state.selectedLogIndex)) && !state.logDetailLoading) {
    void loadLogDetail(Number(state.selectedLogIndex));
  }
  if (!state.selectedAuditId && state.audit[0]?.id) {
    state.selectedAuditId = state.audit[0].id;
    saveFilterState();
  }
  if (state.selectedAuditId && (!state.auditDetail || state.auditDetail.audit.id !== state.selectedAuditId) && !state.auditDetailLoading) {
    void loadAuditDetail(state.selectedAuditId);
  }
  refs.taskDetail.innerHTML = taskDetailCard();
  refs.tasksList.innerHTML = visibleTasks.map(taskCard).join("") || '<div class="card muted">No tasks match the current filters.</div>';
  refs.planDetail.innerHTML = planDetailCard();
  refs.plansList.innerHTML = state.plans.map(planCard).join("") || '<div class="card muted">No Symphony plans recorded yet.</div>';
  refs.toolDetail.innerHTML = toolDetailCard();
  refs.toolsList.innerHTML = state.tools.map(toolCard).join("") || '<div class="card muted">No tools loaded yet.</div>';
  refs.approvalDetail.innerHTML = approvalDetailCard();
  refs.healingDetail.innerHTML = healingDetailCard();
  refs.approvalsList.innerHTML = visibleApprovals.map(approvalCard).join("") || '<div class="card muted">No approvals match the current filter.</div>';
  refs.jobsList.innerHTML = state.jobs.map(jobCard).join("") || '<div class="card muted">No scheduler jobs yet.</div>';
  if (!state.selectedJobId && state.jobs[0]?.id) {
    state.selectedJobId = state.jobs[0].id;
    saveFilterState();
  }
  if (state.selectedJobId && (!state.jobDetail || state.jobDetail.job.id !== state.selectedJobId) && !state.jobDetailLoading) {
    void loadJobDetail(state.selectedJobId);
  }
  refs.jobDetail.innerHTML = jobDetailCard();
  renderSchedulerFeedback();
  if (!visibleGateways.some((gateway) => gateway.id === state.selectedGatewayId)) {
    state.selectedGatewayId = visibleGateways[0]?.id || state.gateways[0]?.id || "";
    saveFilterState();
  }
  if (state.selectedGatewayId && (!state.gatewayDetail || state.gatewayDetail.gateway.id !== state.selectedGatewayId) && !state.gatewayDetailLoading) {
    void loadGatewayDetail(state.selectedGatewayId);
  }
  refs.gatewayDetail.innerHTML = gatewayDetailCard();
  refs.gatewayList.innerHTML = visibleGateways.map(gatewayCard).join("") || '<div class="card muted">No gateways match the current filter.</div>';
  refs.memoryList.innerHTML = state.memorySearchResults
    ? state.memorySearchResults.map(memorySearchCard).join("") || '<div class="card muted">No memory records matched.</div>'
    : state.memory.map(memoryCard).join("") || '<div class="card muted">No memory recorded for this session.</div>';
  refs.healingList.innerHTML = healingView();
  refs.auditDetail.innerHTML = auditDetailCard();
  refs.auditList.innerHTML = state.audit.map(auditCard).join("") || '<div class="card muted">No audit entries yet.</div>';
  refs.logDetail.innerHTML = logDetailCard();
  refs.logsList.innerHTML = state.logs.map((entry, index) => logCard(entry, index)).join("") || '<div class="card muted">No logs available yet.</div>';
  refs.diagnosticsSummary.textContent = diagnosticsSummaryText();
  refs.diagnosticsList.innerHTML = diagnosticsCards();
  refs.supportSummary.textContent = state.supportBundle
    ? `Support bundle written to ${state.supportBundle.bundleDir}`
    : "Generate a support bundle with runtime snapshots, logs, and diagnostics.";
  refs.supportList.innerHTML = state.supportBundle
    ? supportCard(state.supportBundle)
    : '<div class="card muted">No support bundle generated yet.</div>';
  refs.sessionDetail.innerHTML = sessionDetailCard();
  refs.sessionsList.innerHTML = state.sessions.map(sessionCard).join("") || '<div class="card muted">No sessions yet.</div>';
}

function renderHistory() {
  refs.composeHistory.innerHTML = state.events
    .slice(0, 10)
    .map(
      (item) => `
        <div class="card">
          <div class="row">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="meta">${fmtTime(item.createdAt)}</span>
          </div>
          <div class="muted">${escapeHtml(item.detail)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSessionSelect() {
  refs.sessionSelect.innerHTML = [
    `<option value="">(new session)</option>`,
    ...state.sessions.map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(session.id)}</option>`),
  ].join("");
  refs.sessionSelect.value = state.sessionId || "";
}

function renderHealth() {
  if (!state.health) {
    refs.healthChip.textContent = "Checking health";
    refs.healthChip.className = "chip warn";
    refs.backendChip.textContent = "Backend";
    refs.sessionChip.textContent = `Session: ${state.sessionId || "none"}`;
    return;
  }
  refs.healthChip.textContent = `Health: ${state.health.status}`;
  refs.healthChip.className = `chip ${state.refreshPending ? "syncing" : state.health.status === "ok" ? "ok" : "warn"}`;
  refs.backendChip.textContent = `Backend: ${state.health.backend || "agentix"}`;
  refs.sessionChip.textContent = `Session: ${state.sessionId || "none"}`;
}

function renderFilters() {
  refs.taskFilterInput.value = state.taskFilter;
  refs.taskStatusFilter.value = state.taskStatusFilter;
  refs.approvalFilterInput.value = state.approvalFilter;
  if (refs.gatewayFilterInput) refs.gatewayFilterInput.value = state.gatewayFilter;
  if (refs.searchInput) refs.searchInput.value = state.searchQuery;
}

function renderToken() {
  refs.tokenInput.value = state.sessionToken;
}

function render() {
  renderFilters();
  renderToken();
  renderHealth();
  renderStats();
  renderUsage();
  renderConfigPanel();
  renderLists();
  renderSearch();
  renderHistory();
  renderSessionSelect();
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === state.view);
  });
  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function searchCard(item, kind) {
  if (kind === "task") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.kind)}</h4>
          <span class="pill">${escapeHtml(item.status)}</span>
        </div>
        <div class="meta">${escapeHtml(item.id)} / ${escapeHtml(item.sessionId)}</div>
        <div class="muted">${escapeHtml(item.summary || "")}</div>
        <div class="row">
          <button class="ghost" data-action="search-open-task" data-id="${escapeHtml(item.id)}">Open</button>
        </div>
      </div>
    `;
  }
  if (kind === "session") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.id)}</h4>
          <span class="pill">${escapeHtml(item.status)}</span>
        </div>
        <div class="meta">created ${fmtTime(item.createdAt)} · updated ${fmtTime(item.updatedAt)}</div>
        <div class="row">
          <button class="ghost" data-action="search-open-session" data-id="${escapeHtml(item.id)}">Open</button>
        </div>
      </div>
    `;
  }
  if (kind === "plan") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.id)}</h4>
          <span class="pill">${escapeHtml(item.status)}</span>
          <span class="pill">${escapeHtml(item.planner)}</span>
        </div>
        <div class="meta">${escapeHtml(item.sessionId)} · ${item.stepCount || 0} steps · ${item.taskCount || 0} tasks</div>
        <div class="muted">${escapeHtml(item.stimulus || "")}</div>
        <div class="row">
          <button class="ghost" data-action="search-open-plan" data-id="${escapeHtml(item.id)}">Open</button>
        </div>
      </div>
    `;
  }
  if (kind === "gateway") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="pill ${item.enabled ? "success" : "danger"}">${item.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(item.platform)} · ${escapeHtml(item.status)}</div>
        <div class="muted">${escapeHtml(item.endpoint || "No endpoint configured")}</div>
        <div class="row">
          <button class="ghost" data-action="search-open-gateway" data-id="${escapeHtml(item.id)}">Open</button>
        </div>
      </div>
    `;
  }
  if (kind === "memory") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.role)}</h4>
          <span class="pill">${escapeHtml((item.tags || []).join(", ") || "memory")}</span>
        </div>
        <div class="meta">${escapeHtml(item.sessionId)}${item.taskId ? ` · ${escapeHtml(item.taskId)}` : ""}</div>
        <div class="muted">${escapeHtml(item.content)}</div>
      </div>
    `;
  }
  if (kind === "log") {
    return `
      <div class="card log-line">
        <div class="row">
          <strong>${escapeHtml(item.level)}</strong>
          <span class="pill">${escapeHtml(item.source)}</span>
          <span class="meta">${escapeHtml(item.timestamp)}</span>
        </div>
        <div class="muted">${escapeHtml(item.message)}</div>
      </div>
    `;
  }
  if (kind === "audit") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.type)}</h4>
          <span class="pill">${escapeHtml(item.actor)}</span>
        </div>
        <div class="meta">${escapeHtml(item.id)}${item.subjectId ? ` · ${escapeHtml(item.subjectId)}` : ""}</div>
        <div class="muted">${escapeHtml(JSON.stringify(item.data, null, 2))}</div>
      </div>
    `;
  }
  if (kind === "job") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="pill ${item.enabled ? "success" : "danger"}">${item.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(jobSchedule(item))}</div>
        <div class="muted">${escapeHtml(item.stimulus)}</div>
      </div>
    `;
  }
  if (kind === "healing") {
    return `
      <div class="card">
        <div class="row">
          <h4>${escapeHtml(item.fingerprint)}</h4>
          <span class="pill">${item.count}x</span>
        </div>
        <div class="muted">${escapeHtml(item.lastError)}</div>
        <div class="meta">${fmtTime(item.firstSeenAt)} - ${fmtTime(item.lastSeenAt)}</div>
      </div>
    `;
  }
  return `<div class="card muted">${escapeHtml(JSON.stringify(item))}</div>`;
}

function renderSearch() {
  const results = state.searchResults;
  if (!refs.searchSummary) return;
  if (!results) {
    refs.searchSummary.textContent = "Search the runtime to find tasks, sessions, memory, logs, jobs, healing records, and gateways.";
    refs.searchTasksList.innerHTML = "";
    refs.searchPlansList.innerHTML = "";
    refs.searchSessionsList.innerHTML = "";
    refs.searchMemoryList.innerHTML = "";
    refs.searchLogsList.innerHTML = "";
    refs.searchAuditList.innerHTML = "";
    refs.searchJobsList.innerHTML = "";
    refs.searchGatewaysList.innerHTML = "";
    refs.searchHealingList.innerHTML = "";
    return;
  }
  refs.searchSummary.textContent = `Results for "${results.query}"`;
  refs.searchTasksList.innerHTML = (results.tasks || []).map((item) => searchCard(item, "task")).join("") || '<div class="card muted">No tasks matched.</div>';
  refs.searchPlansList.innerHTML = (results.plans || []).map((item) => searchCard(item, "plan")).join("") || '<div class="card muted">No plans matched.</div>';
  refs.searchSessionsList.innerHTML = (results.sessions || []).map((item) => searchCard(item, "session")).join("") || '<div class="card muted">No sessions matched.</div>';
  refs.searchMemoryList.innerHTML = (results.memory || []).map((item) => searchCard(item, "memory")).join("") || '<div class="card muted">No memory records matched.</div>';
  refs.searchLogsList.innerHTML = (results.logs || []).map((item) => searchCard(item, "log")).join("") || '<div class="card muted">No logs matched.</div>';
  refs.searchAuditList.innerHTML = (results.audit || []).map((item) => searchCard(item, "audit")).join("") || '<div class="card muted">No audit entries matched.</div>';
  refs.searchJobsList.innerHTML = (results.jobs || []).map((item) => searchCard(item, "job")).join("") || '<div class="card muted">No jobs matched.</div>';
  refs.searchGatewaysList.innerHTML = (results.gateways || []).map((item) => searchCard(item, "gateway")).join("") || '<div class="card muted">No gateways matched.</div>';
  refs.searchHealingList.innerHTML = (results.healing || []).map((item) => searchCard(item, "healing")).join("") || '<div class="card muted">No healing records matched.</div>';
}

async function refreshAll() {
  try {
    const [health, diagnostics, usage, config, sessions, tasks, plans, tools, logs, approvals, jobs, audit, healing, gateways] = await Promise.all([
      api("/health"),
      api("/doctor").catch(() => null),
      api("/usage").catch(() => null),
      api("/config").catch(() => null),
      api("/sessions"),
      api(`/tasks${state.sessionId ? `?sessionId=${encodeURIComponent(state.sessionId)}` : ""}`),
      api("/plans").catch(() => []),
      api("/tools").catch(() => []),
      api("/logs").catch(() => []),
      api("/approvals"),
      api("/scheduler/jobs"),
      api("/audit"),
      api("/healing/stats"),
      api("/gateway"),
    ]);
    state.health = health;
    state.diagnostics = diagnostics;
    state.usage = usage;
    state.usageError = usage ? "" : state.usageError;
    state.config = config;
    state.sessions = sessions || [];
    state.tasks = tasks || [];
    state.plans = plans || [];
    state.tools = tools || [];
    state.logs = logs || [];
    state.approvals = approvals || [];
    state.jobs = jobs || [];
    if (state.selectedJobId && !state.jobs.some((job) => job.id === state.selectedJobId)) {
      state.selectedJobId = state.jobs[0]?.id || "";
      saveFilterState();
    }
    state.audit = audit || [];
    state.healing = healing || { failures: [], procedures: [] };
    state.gateways = gateways || [];
    if (!state.sessionId && state.sessions[0]?.id) {
      state.sessionId = state.sessions[0].id;
      localStorage.setItem("agentix.sessionId", state.sessionId);
    }
    if (state.sessionId) {
      state.memory = await api(`/memory?sessionId=${encodeURIComponent(state.sessionId)}`).catch(() => []);
      state.memorySearchResults = null;
    } else {
      state.memory = [];
      state.memorySearchResults = null;
    }
    if (state.searchQuery) {
      state.searchResults = await api(`/search?q=${encodeURIComponent(state.searchQuery)}`).catch(() => null);
    } else {
      state.searchResults = null;
    }
    if (state.selectedTaskId) {
      await loadTaskDetail(state.selectedTaskId);
    } else {
      state.taskDetail = null;
    }
    if (state.selectedPlanId) {
      await loadPlanDetail(state.selectedPlanId);
    } else {
      state.planDetail = null;
    }
    if (state.selectedJobId) {
      await loadJobDetail(state.selectedJobId);
    } else {
      state.jobDetail = null;
    }
    if (!state.selectedGatewayId && state.gateways[0]?.id) {
      state.selectedGatewayId = state.gateways[0].id;
      saveFilterState();
    }
    if (state.selectedGatewayId && (!state.gatewayDetail || state.gatewayDetail.gateway.id !== state.selectedGatewayId) && !state.gatewayDetailLoading) {
      await loadGatewayDetail(state.selectedGatewayId);
    } else if (!state.selectedGatewayId) {
      state.gatewayDetail = null;
    }
    state.lastError = "";
    appendEvent("refreshed", "Pulled live state from the backend", "success");
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    appendEvent("refresh failed", state.lastError, "danger");
  }
  render();
}

async function runSearch(query) {
  const text = String(query || "").trim();
  state.searchQuery = text;
  saveFilterState();
  if (!text) {
    state.searchResults = null;
    renderSearch();
    return;
  }
  state.searchResults = await api(`/search?q=${encodeURIComponent(text)}`);
  setView("search");
  renderSearch();
}

async function loadDiagnostics() {
  try {
    state.diagnostics = await api("/doctor");
    appendEvent("doctor", `Backend diagnostics: ${state.diagnostics.status || "unknown"}`, state.diagnostics.status === "fail" ? "danger" : state.diagnostics.status === "warn" ? "warn" : "success");
  } catch (err) {
    state.diagnostics = null;
    appendEvent("doctor failed", err instanceof Error ? err.message : String(err), "danger");
  }
  render();
}

async function loadUsage() {
  state.usageLoading = true;
  state.usageError = "";
  renderUsage();
  try {
    state.usage = await api("/usage");
    appendEvent("usage", "Loaded current runtime usage.", "success");
  } catch (err) {
    state.usageError = err instanceof Error ? err.message : String(err);
    appendEvent("usage failed", state.usageError, "danger");
  } finally {
    state.usageLoading = false;
    renderUsage();
  }
}

async function loadConfigPanel() {
  state.configLoading = true;
  state.configFeedback = "";
  renderConfigPanel();
  try {
    state.config = await api("/config");
    state.configFeedback = "Backend config loaded.";
    appendEvent("config", "Loaded backend config.", "success");
  } catch (err) {
    state.configFeedback = err instanceof Error ? err.message : String(err);
    appendEvent("config failed", state.configFeedback, "danger");
  } finally {
    state.configLoading = false;
    renderConfigPanel();
  }
}

async function saveConfigPanel(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const keys = ["provider", "model", "baseUrl", "inboxPort", "bridgePort", "sessionTtlMs", "approvalTimeoutMs"];
  const updates = [];
  for (const key of keys) {
    const input = form.elements[key];
    if (!input) continue;
    const next = String(input.value ?? "").trim();
    const current = configValue(key);
    if (next !== current) {
      updates.push([key, input.type === "number" ? Number(next) : next]);
    }
  }
  if (updates.length === 0) {
    state.configFeedback = "No config changes to save.";
    renderConfigPanel();
    return;
  }
  state.configLoading = true;
  state.configFeedback = `Saving ${updates.length} setting(s)...`;
  renderConfigPanel();
  try {
    for (const [key, value] of updates) {
      const result = await api("/config", {
        method: "POST",
        body: JSON.stringify({ key, value }),
      });
      state.config = result.config || state.config;
    }
    state.configFeedback = "Config saved. Restart server if port changes should take effect.";
    appendEvent("config saved", updates.map(([key]) => key).join(", "), "success");
    await refreshAll();
  } catch (err) {
    state.configFeedback = err instanceof Error ? err.message : String(err);
    appendEvent("config save failed", state.configFeedback, "danger");
  } finally {
    state.configLoading = false;
    renderConfigPanel();
  }
}

async function loadTaskDetail(taskId) {
  if (!taskId) {
    state.taskDetail = null;
    state.taskDetailLoading = false;
    return;
  }
  state.taskDetailLoading = true;
  renderLists();
  try {
    state.taskDetail = await api(`/tasks/${encodeURIComponent(taskId)}`);
  } catch (err) {
    state.taskDetail = null;
    appendEvent("task detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.taskDetailLoading = false;
    renderLists();
  }
}

async function loadPlanDetail(planId) {
  if (!planId) {
    state.planDetail = null;
    state.planDetailLoading = false;
    return;
  }
  state.planDetailLoading = true;
  renderLists();
  try {
    state.planDetail = await api(`/plans/${encodeURIComponent(planId)}`);
  } catch (err) {
    state.planDetail = null;
    appendEvent("plan detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.planDetailLoading = false;
    renderLists();
  }
}

async function loadSessionDetail(sessionId) {
  if (!sessionId) {
    state.sessionDetail = null;
    state.sessionDetailLoading = false;
    return;
  }
  state.sessionDetailLoading = true;
  renderLists();
  try {
    state.sessionDetail = await api(`/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    state.sessionDetail = null;
    appendEvent("session detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.sessionDetailLoading = false;
    renderLists();
  }
}

async function loadJobDetail(jobId) {
  if (!jobId) {
    state.jobDetail = null;
    state.jobDetailLoading = false;
    return;
  }
  state.jobDetailLoading = true;
  renderLists();
  try {
    state.jobDetail = await api(`/scheduler/jobs/${encodeURIComponent(jobId)}`);
  } catch (err) {
    state.jobDetail = null;
    appendEvent("job detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.jobDetailLoading = false;
    renderLists();
  }
}

async function loadGatewayDetail(gatewayId) {
  if (!gatewayId) {
    state.gatewayDetail = null;
    state.gatewayDetailLoading = false;
    return;
  }
  state.gatewayDetailLoading = true;
  renderLists();
  try {
    state.gatewayDetail = await api(`/gateway/${encodeURIComponent(gatewayId)}`);
  } catch (err) {
    state.gatewayDetail = null;
    appendEvent("gateway detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.gatewayDetailLoading = false;
    renderLists();
  }
}

async function loadToolDetail(toolId) {
  if (!toolId) {
    state.toolDetail = null;
    state.toolDetailLoading = false;
    return;
  }
  state.toolDetailLoading = true;
  renderLists();
  try {
    state.toolDetail = await api(`/tools/${encodeURIComponent(toolId)}`);
  } catch (err) {
    state.toolDetail = null;
    appendEvent("tool detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.toolDetailLoading = false;
    renderLists();
  }
}

async function loadApprovalDetail(taskId) {
  if (!taskId) {
    state.approvalDetail = null;
    state.approvalDetailLoading = false;
    return;
  }
  state.approvalDetailLoading = true;
  renderLists();
  try {
    state.approvalDetail = await api(`/approvals/${encodeURIComponent(taskId)}`);
  } catch (err) {
    state.approvalDetail = null;
    appendEvent("approval detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.approvalDetailLoading = false;
    renderLists();
  }
}

async function loadHealingDetail(id) {
  if (!id) {
    state.healingDetail = null;
    state.healingDetailLoading = false;
    return;
  }
  state.healingDetailLoading = true;
  renderLists();
  try {
    state.healingDetail = await api(`/healing/detail/${encodeURIComponent(id)}`);
  } catch (err) {
    state.healingDetail = null;
    appendEvent("healing detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.healingDetailLoading = false;
    renderLists();
  }
}

async function loadLogDetail(index) {
  if (!Number.isInteger(index) || index < 0) {
    state.logDetail = null;
    state.logDetailLoading = false;
    return;
  }
  state.logDetailLoading = true;
  renderLists();
  try {
    state.logDetail = await api(`/logs/${encodeURIComponent(index)}`);
  } catch (err) {
    state.logDetail = null;
    appendEvent("log detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.logDetailLoading = false;
    renderLists();
  }
}

async function loadAuditDetail(id) {
  if (!id) {
    state.auditDetail = null;
    state.auditDetailLoading = false;
    return;
  }
  state.auditDetailLoading = true;
  renderLists();
  try {
    state.auditDetail = await api(`/audit/${encodeURIComponent(id)}`);
  } catch (err) {
    state.auditDetail = null;
    appendEvent("audit detail failed", err instanceof Error ? err.message : String(err), "danger");
  } finally {
    state.auditDetailLoading = false;
    renderLists();
  }
}

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  try {
    const source = new EventSource(eventStreamUrl());
    state.eventSource = source;
    source.onopen = () => appendEvent("events connected", "Live backend event stream is open", "success");
    source.onmessage = (event) => appendEvent("message", event.data);
    source.addEventListener("bridge:hello", (event) => appendEvent("bridge hello", event.data, "success"));
    source.addEventListener("task:queued", (event) => {
      appendEvent("task queued", event.data, "success");
      scheduleRefresh("task queued");
    });
    source.addEventListener("task:running", (event) => {
      appendEvent("task running", event.data);
      scheduleRefresh("task running");
    });
    source.addEventListener("task:complete", (event) => {
      appendEvent("task complete", event.data, "success");
      scheduleRefresh("task complete");
    });
    source.addEventListener("task:failed", (event) => {
      appendEvent("task failed", event.data, "danger");
      scheduleRefresh("task failed");
    });
    source.addEventListener("task:approve", (event) => {
      appendEvent("approval requested", event.data, "warn");
      scheduleRefresh("approval requested");
    });
    source.addEventListener("task:reject", (event) => {
      appendEvent("approval rejected", event.data, "danger");
      scheduleRefresh("approval rejected");
    });
    source.addEventListener("session:create", (event) => {
      appendEvent("session created", event.data, "success");
      scheduleRefresh("session created");
    });
    source.addEventListener("session:close", (event) => {
      appendEvent("session closed", event.data, "warn");
      scheduleRefresh("session closed");
    });
    source.addEventListener("powerhouse:started", (event) => {
      appendEvent("powerhouse started", event.data, "success");
      scheduleRefresh("powerhouse started");
    });
    source.addEventListener("powerhouse:stopped", (event) => {
      appendEvent("powerhouse stopped", event.data, "warn");
      scheduleRefresh("powerhouse stopped");
    });
    source.addEventListener("gateway:message", (event) => {
      appendEvent("gateway message", event.data, "success");
      scheduleRefresh("gateway message");
    });
    source.addEventListener("gateway:enabled", (event) => {
      appendEvent("gateway enabled", event.data, "success");
      scheduleRefresh("gateway enabled");
    });
    source.addEventListener("gateway:disabled", (event) => {
      appendEvent("gateway disabled", event.data, "warn");
      scheduleRefresh("gateway disabled");
    });
    source.addEventListener("task:complete", () => {
      if (state.searchQuery) {
        void runSearch(state.searchQuery);
      }
    });
    source.onerror = () => appendEvent("events error", "Event stream disconnected or token rejected", "danger");
  } catch (err) {
    appendEvent("events failed", err instanceof Error ? err.message : String(err), "danger");
  }
}

async function streamExecute(stimulus) {
  const body = JSON.stringify({ stimulus, sessionId: state.sessionId || undefined });
  const res = await fetch("/execute/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let response = "";

  appendEvent("compose", stimulus, "success");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).replace(/\\n/g, "\n");
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.delta) {
          response += parsed.delta;
          appendEvent("stream", parsed.delta);
        }
      } catch {
        response += payload;
        appendEvent("stream", payload);
      }
    }
  }

  appendEvent("response", response.slice(0, 400) || "(empty)", "success");
  await refreshAll();
}

async function submitCompose(event) {
  event.preventDefault();
  const stimulus = refs.composeInput.value.trim();
  if (!stimulus) return;
  if (state.sessionSelect.value) {
    setSessionId(state.sessionSelect.value);
  }
  if (stimulus.startsWith("/")) {
    appendEvent("command", stimulus);
    await handleSlash(stimulus);
  } else {
    await streamExecute(stimulus);
  }
  refs.composeInput.value = "";
}

async function handleSlash(text) {
  const [command, ...rest] = text.slice(1).split(/\s+/);
  switch ((command || "").toLowerCase()) {
    case "tasks":
      setView("tasks");
      await refreshAll();
      break;
    case "plans":
      setView("plans");
      await refreshAll();
      break;
    case "tools":
      setView("tools");
      await refreshAll();
      break;
    case "search": {
      const query = rest.join(" ").trim();
      if (!query) {
        setView("search");
        renderSearch();
        break;
      }
      await runSearch(query);
      break;
    }
    case "approvals":
      setView("approvals");
      await refreshAll();
      break;
    case "scheduler":
      setView("scheduler");
      await refreshAll();
      break;
    case "gateway":
      setView("gateway");
      await refreshAll();
      break;
    case "memory":
      setView("memory");
      await refreshAll();
      break;
    case "healing":
      setView("healing");
      await refreshAll();
      break;
    case "audit":
      setView("audit");
      await refreshAll();
      break;
    case "logs":
      setView("logs");
      await refreshAll();
      break;
    case "usage":
      setView("usage");
      await loadUsage();
      break;
    case "config":
      setView("config");
      await loadConfigPanel();
      break;
    case "doctor":
    case "diagnostics":
      setView("diagnostics");
      await loadDiagnostics();
      break;
    case "support":
      setView("support");
      state.supportBundle = await api("/support/bundle", { method: "POST" });
      appendEvent("support bundle", `Created bundle at ${state.supportBundle.bundleDir}`, "success");
      render();
      break;
    case "sessions":
      setView("sessions");
      await refreshAll();
      break;
    case "help":
      appendEvent("help", "Use the sidebar to explore live backend state.", "success");
      break;
    default:
      appendEvent("unknown command", `/${command} ${rest.join(" ")}`, "danger");
      break;
  }
}

async function createJob(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const job = await api("/scheduler/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") || "").trim(),
        stimulus: String(form.get("stimulus") || "").trim(),
        schedule: String(form.get("schedule") || "").trim(),
        script: String(form.get("script") || "").trim(),
        noAgent: form.get("noAgent") === "on",
        workdir: String(form.get("workdir") || "").trim(),
        skills: parseSkills(form.get("skills")),
        enabled: true,
      }),
    });
    event.currentTarget.reset();
    event.currentTarget.elements.schedule.value = "every 1m";
    state.selectedJobId = job.id || "";
    saveFilterState();
    const message = `Created scheduled job ${job.name || job.id}.`;
    setSchedulerFeedback(message);
    appendEvent("scheduler job created", message, "success");
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSchedulerFeedback(`Create failed: ${message}`, "danger");
    appendEvent("scheduler create failed", message, "danger");
  }
}

async function updateJob(event) {
  const formElement = event.target.closest("[data-job-edit]");
  if (!formElement) return;
  event.preventDefault();
  const id = formElement.dataset.jobEdit;
  const form = new FormData(formElement);
  try {
    await api(`/scheduler/jobs/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: String(form.get("name") || "").trim(),
        stimulus: String(form.get("stimulus") || "").trim(),
        schedule: String(form.get("schedule") || "").trim(),
        script: String(form.get("script") || "").trim(),
        noAgent: form.get("noAgent") === "on",
        workdir: String(form.get("workdir") || "").trim(),
        skills: parseSkills(form.get("skills")),
      }),
    });
    const message = `Saved changes to ${String(form.get("name") || id).trim()}.`;
    setSchedulerFeedback(message);
    appendEvent("scheduler job updated", message, "success");
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSchedulerFeedback(`Update failed: ${message}`, "danger");
    appendEvent("scheduler update failed", message, "danger");
  }
}

async function runDueJobs() {
  try {
    const result = await api("/scheduler/run-due", { method: "POST", body: "{}" });
    const count = Number(result?.count || 0);
    const message = count === 1 ? "Ran 1 due scheduled job." : `Ran ${count} due scheduled jobs.`;
    setSchedulerFeedback(message, count ? "success" : "warn");
    appendEvent("scheduler due run", message, count ? "success" : "warn");
    await refreshAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSchedulerFeedback(`Run due failed: ${message}`, "danger");
    appendEvent("scheduler due run failed", message, "danger");
  }
}

async function searchMemory(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const query = String(form.get("query") || "");
  state.memorySearchResults = await api(`/memory/search?q=${encodeURIComponent(query)}`);
  setView("memory");
  render();
}

async function consolidateMemory() {
  await api("/memory/consolidate", {
    method: "POST",
    body: JSON.stringify({ sessionId: state.sessionId || undefined }),
  });
  await refreshAll();
}

async function clickAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "approve") {
      await api(`/approvals/${encodeURIComponent(id)}/approve`, { method: "POST" });
    } else if (action === "reject") {
      await api(`/approvals/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "rejected from dashboard" }),
      });
    } else if (action === "run-job") {
      const result = await api(`/scheduler/jobs/${encodeURIComponent(id)}/run`, {
        method: "POST",
        body: "{}",
      });
      const job = state.jobs.find((item) => item.id === id);
      const message = result?.ok === false
        ? `Run failed for ${job?.name || id}: ${result.error || "unknown error"}`
        : `Ran scheduled job ${job?.name || id}.`;
      setSchedulerFeedback(message, result?.ok === false ? "danger" : "success");
      appendEvent("scheduler job run", message, result?.ok === false ? "danger" : "success");
    } else if (action === "toggle-job") {
      const job = state.jobs.find((item) => item.id === id);
      await api(`/scheduler/jobs/${encodeURIComponent(id)}/${job?.enabled ? "disable" : "enable"}`, {
        method: "POST",
        body: "{}",
      });
      const message = `${job?.enabled ? "Disabled" : "Enabled"} scheduled job ${job?.name || id}.`;
      setSchedulerFeedback(message);
      appendEvent("scheduler job toggled", message, "success");
    } else if (action === "inspect-job") {
      state.selectedJobId = id;
      saveFilterState();
      setView("scheduler");
      await loadJobDetail(id);
    } else if (action === "inspect-gateway") {
      state.selectedGatewayId = id;
      saveFilterState();
      setView("gateway");
      await loadGatewayDetail(id);
    } else if (action === "toggle-gateway") {
      const gateway = state.gateways.find((item) => item.id === id);
      await api(`/gateway/${encodeURIComponent(id)}/${gateway?.enabled ? "disable" : "enable"}`, {
        method: "POST",
        body: "{}",
      });
      await refreshAll();
    } else if (action === "gateway-test") {
      const gateway = state.gatewayDetail?.gateway || state.gateways.find((item) => item.id === id);
      const gatewayName = gateway?.name || "gateway";
      await api(`/gateway/${encodeURIComponent(id)}/message`, {
        method: "POST",
        body: JSON.stringify({
          stimulus: `Test message from Agentix dashboard for ${gatewayName}`,
          metadata: { test: true },
        }),
      });
      await refreshAll();
    } else if (action === "inspect-tool") {
      state.selectedToolId = id;
      saveFilterState();
      setView("tools");
      await loadToolDetail(id);
    } else if (action === "inspect-plan") {
      state.selectedPlanId = id;
      saveFilterState();
      setView("plans");
      await loadPlanDetail(id);
    } else if (action === "delete-job") {
      const job = state.jobs.find((item) => item.id === id);
      await api(`/scheduler/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (state.selectedJobId === id) {
        state.selectedJobId = "";
        state.jobDetail = null;
        saveFilterState();
      }
      const message = `Deleted scheduled job ${job?.name || id}.`;
      setSchedulerFeedback(message);
      appendEvent("scheduler job deleted", message, "success");
    } else if (action === "promote-proc") {
      await api(`/healing/procedures/${encodeURIComponent(id)}/promote`, { method: "POST", body: "{}" });
    } else if (action === "deprecate-proc") {
      await api(`/healing/procedures/${encodeURIComponent(id)}/deprecate`, { method: "POST", body: "{}" });
    } else if (action === "inspect-healing") {
      state.selectedHealingId = id;
      saveFilterState();
      setView("healing");
      await loadHealingDetail(id);
    } else if (action === "inspect-log") {
      state.selectedLogIndex = id;
      saveFilterState();
      setView("logs");
      await loadLogDetail(Number(id));
    } else if (action === "inspect-audit") {
      state.selectedAuditId = id;
      saveFilterState();
      setView("audit");
      await loadAuditDetail(id);
    } else if (action === "select-session") {
      setSessionId(id);
      setView("compose");
    } else if (action === "inspect-session") {
      state.selectedSessionId = id;
      saveFilterState();
      setView("sessions");
      await loadSessionDetail(id);
    } else if (action === "select-task") {
      state.selectedTaskId = id;
      saveFilterState();
      setView("tasks");
      await loadTaskDetail(id);
    } else if (action === "inspect-task") {
      state.selectedTaskId = id;
      saveFilterState();
      setView("tasks");
      await loadTaskDetail(id);
    } else if (action === "search-open-task") {
      state.selectedTaskId = id;
      saveFilterState();
      setView("tasks");
      await loadTaskDetail(id);
    } else if (action === "search-open-plan") {
      state.selectedPlanId = id;
      saveFilterState();
      setView("plans");
      await loadPlanDetail(id);
    } else if (action === "search-open-session") {
      setSessionId(id);
      setView("sessions");
    } else if (action === "search-open-gateway") {
      state.selectedGatewayId = id;
      saveFilterState();
      setView("gateway");
      await loadGatewayDetail(id);
    } else if (action === "inspect-approval") {
      state.selectedApprovalId = id;
      saveFilterState();
      setView("approvals");
      await loadApprovalDetail(id);
    } else if (action === "approve-task-detail") {
      await api(`/approvals/${encodeURIComponent(id)}/approve`, { method: "POST" });
      await loadTaskDetail(id);
    } else if (action === "reject-task-detail") {
      await api(`/approvals/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "rejected from task detail" }),
      });
      await loadTaskDetail(id);
    } else if (action === "cancel-task-detail") {
      await api(`/tasks/${encodeURIComponent(id)}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      });
      await loadTaskDetail(id);
      await refreshAll();
    } else if (action === "retry-task-detail") {
      await api(`/tasks/${encodeURIComponent(id)}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "retry" }),
      });
      await loadTaskDetail(id);
      await refreshAll();
    } else if (action === "restart-task-detail") {
      await api(`/tasks/${encodeURIComponent(id)}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "restart" }),
      });
      await loadTaskDetail(id);
      await refreshAll();
    } else if (action === "copy-task-json") {
      const task = state.taskDetail?.task;
      if (task && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(JSON.stringify(task, null, 2));
        appendEvent("task copied", `Copied ${id} JSON to clipboard`, "success");
      }
    } else if (action === "rename-session") {
      const current = state.sessions.find((session) => session.id === id) || state.sessionDetail?.session;
      const previous = current?.metadata?.title || "";
      const title = prompt("Session title", previous);
      if (title === null) return;
      const trimmed = title.trim();
      if (!trimmed) {
        appendEvent("rename skipped", "Session title cannot be empty.", "warn");
        return;
      }
      await api(`/sessions/${encodeURIComponent(id)}/rename`, {
        method: "POST",
        body: JSON.stringify({ title: trimmed }),
      });
      appendEvent("session renamed", `${id} -> ${trimmed}`, "success");
      await loadSessionDetail(id);
    } else if (action === "delete-session") {
      await api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (state.sessionId === id) setSessionId("");
      if (state.selectedSessionId === id) state.selectedSessionId = "";
      state.sessionDetail = null;
    }
    await refreshAll();
  } catch (err) {
    appendEvent("action failed", err instanceof Error ? err.message : String(err), "danger");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function boot() {
  refs.tokenInput.value = state.sessionToken;
  renderPalette();
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.dataset.quick || "";
      if (!command) return;
      refs.composeInput.value = command;
      appendEvent("command", command);
      try {
        await handleSlash(command);
        refs.composeInput.value = "";
      } catch (err) {
        appendEvent("command failed", err instanceof Error ? err.message : String(err), "danger");
      }
    });
  });
  refs.saveTokenButton.addEventListener("click", async () => {
    state.sessionToken = refs.tokenInput.value.trim();
    saveToken();
    appendEvent("token saved", state.sessionToken ? "Stored event token locally." : "Cleared event token.", "success");
    await refreshAll();
    connectEvents();
  });
  refs.refreshButton.addEventListener("click", refreshAll);
  refs.connectEventsButton.addEventListener("click", connectEvents);
  refs.clearEventsButton.addEventListener("click", () => {
    state.events = [];
    renderEvents();
    renderHistory();
  });
  refs.reloadTasksButton.addEventListener("click", refreshAll);
  refs.reloadPlansButton.addEventListener("click", refreshAll);
  refs.reloadSearchButton.addEventListener("click", refreshAll);
  refs.reloadToolsButton.addEventListener("click", refreshAll);
  refs.reloadApprovalsButton.addEventListener("click", refreshAll);
  refs.reloadJobsButton.addEventListener("click", refreshAll);
  refs.runDueJobsButton.addEventListener("click", runDueJobs);
  refs.reloadGatewayButton.addEventListener("click", refreshAll);
  refs.reloadHealingButton.addEventListener("click", refreshAll);
  refs.reloadAuditButton.addEventListener("click", refreshAll);
  refs.reloadLogsButton.addEventListener("click", refreshAll);
  refs.reloadUsageButton.addEventListener("click", loadUsage);
  refs.reloadConfigButton.addEventListener("click", loadConfigPanel);
  refs.configForm.addEventListener("submit", saveConfigPanel);
  refs.reloadDiagnosticsButton.addEventListener("click", loadDiagnostics);
  refs.pruneSessionsButton.addEventListener("click", async () => {
    const daysText = prompt("Prune sessions older than how many days?", "90");
    if (daysText === null) return;
    const olderThanDays = Number(daysText);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      appendEvent("prune skipped", "Enter a non-negative number of days.", "warn");
      return;
    }
    const result = await api("/sessions/prune", {
      method: "POST",
      body: JSON.stringify({ olderThanDays }),
    });
    appendEvent("sessions pruned", `Closed ${result.count || 0} session(s).`, "success");
    state.selectedSessionId = "";
    state.sessionDetail = null;
    await refreshAll();
  });
  refs.optimizeSessionsButton.addEventListener("click", async () => {
    const result = await api("/sessions/optimize", { method: "POST", body: "{}" });
    appendEvent("sessions optimized", result.detail || `Checked ${result.sessions || 0} session(s).`, "success");
    await refreshAll();
  });
  refs.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runSearch(refs.searchInput.value);
  });
  refs.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setView("live");
    }
  });
  refs.searchInput.addEventListener("input", () => {
    state.searchQuery = refs.searchInput.value;
    saveFilterState();
  });
  refs.createSupportButton.addEventListener("click", async () => {
    state.supportBundle = await api("/support/bundle", { method: "POST" });
    appendEvent("support bundle", `Created bundle at ${state.supportBundle.bundleDir}`, "success");
    setView("support");
    render();
  });
  refs.openPaletteButton.addEventListener("click", () => openPalette());
  refs.closePaletteButton.addEventListener("click", closePalette);
  refs.paletteBackdrop.addEventListener("click", (event) => {
    if (event.target === refs.paletteBackdrop) closePalette();
  });
  refs.paletteInput.addEventListener("input", () => {
    state.paletteQuery = refs.paletteInput.value;
    state.paletteIndex = 0;
    renderPalette();
  });
  refs.paletteInput.addEventListener("keydown", async (event) => {
    const items = filteredPaletteItems();
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      state.paletteIndex = Math.min(state.paletteIndex + 1, Math.max(0, items.length - 1));
      renderPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.paletteIndex = Math.max(state.paletteIndex - 1, 0);
      renderPalette();
    } else if (event.key === "Enter") {
      event.preventDefault();
      await runPaletteSelection();
    }
  });
  refs.paletteResults.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-palette-index]");
    if (!button) return;
    state.paletteIndex = Number(button.dataset.paletteIndex || 0);
    renderPalette();
    await runPaletteSelection();
  });
  refs.reloadSessionsButton.addEventListener("click", refreshAll);
  refs.consolidateButton.addEventListener("click", consolidateMemory);
  refs.toolDetail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='inspect-tool']");
    if (!button) return;
    state.selectedToolId = button.dataset.id || "";
    saveFilterState();
    void loadToolDetail(state.selectedToolId);
  });
  refs.newSessionButton.addEventListener("click", async () => {
    const session = await api("/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setSessionId(session.id);
    state.selectedSessionId = session.id;
    saveFilterState();
    await refreshAll();
    setView("compose");
  });
  refs.memoryForm.addEventListener("submit", searchMemory);
  refs.jobForm.addEventListener("submit", createJob);
  refs.jobDetail.addEventListener("submit", updateJob);
  refs.composeForm.addEventListener("submit", submitCompose);
  refs.sessionSelect.addEventListener("change", () => setSessionId(refs.sessionSelect.value));
  refs.taskFilterInput.addEventListener("input", () => {
    state.taskFilter = refs.taskFilterInput.value.trim();
    saveFilterState();
    render();
  });
  refs.taskStatusFilter.addEventListener("change", () => {
    state.taskStatusFilter = refs.taskStatusFilter.value;
    saveFilterState();
    render();
  });
  refs.gatewayFilterInput.addEventListener("input", () => {
    state.gatewayFilter = refs.gatewayFilterInput.value.trim();
    saveFilterState();
    render();
  });
  refs.approvalFilterInput.addEventListener("input", () => {
    state.approvalFilter = refs.approvalFilterInput.value.trim();
    saveFilterState();
    render();
  });
  document.addEventListener("click", clickAction);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (state.paletteOpen) {
      return;
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      const map = {
        "1": "live",
        "2": "search",
        "3": "tasks",
        "4": "plans",
        "5": "tools",
        "6": "approvals",
        "7": "scheduler",
        "8": "gateway",
        "9": "healing",
        "0": "compose",
      };
      const view = map[event.key];
      if (view) {
        event.preventDefault();
        setView(view);
      }
    }
  });
  setView("live");
  if (state.searchQuery) {
    void runSearch(state.searchQuery);
  }
  refreshAll().then(connectEvents);
}

boot();
