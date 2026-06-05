const state = {
  view: "live",
  sessionToken: localStorage.getItem("agentix.sessionToken") || "",
  sessionId: localStorage.getItem("agentix.sessionId") || "",
  selectedTaskId: localStorage.getItem("agentix.selectedTaskId") || "",
  taskFilter: localStorage.getItem("agentix.taskFilter") || "",
  taskStatusFilter: localStorage.getItem("agentix.taskStatusFilter") || "",
  approvalFilter: localStorage.getItem("agentix.approvalFilter") || "",
  sessions: [],
  tasks: [],
  tools: [],
  approvals: [],
  jobs: [],
  memory: [],
  healing: { failures: [], procedures: [] },
  audit: [],
  events: [],
  health: null,
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
  reloadToolsButton: el("reloadToolsButton"),
  reloadApprovalsButton: el("reloadApprovalsButton"),
  reloadJobsButton: el("reloadJobsButton"),
  reloadHealingButton: el("reloadHealingButton"),
  reloadAuditButton: el("reloadAuditButton"),
  reloadSessionsButton: el("reloadSessionsButton"),
  consolidateButton: el("consolidateButton"),
  newSessionButton: el("newSessionButton"),
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
  toolsList: el("toolsList"),
  approvalsList: el("approvalsList"),
  jobsList: el("jobsList"),
  memoryList: el("memoryList"),
  healingList: el("healingList"),
  auditList: el("auditList"),
  sessionsList: el("sessionsList"),
  composeHistory: el("composeHistory"),
};

const viewTitles = {
  live: "Live activity",
  tasks: "Tasks and state",
  tools: "Tools and capabilities",
  approvals: "Approval queue",
  scheduler: "Scheduler and jobs",
  memory: "Memory search and consolidation",
  healing: "Healing and procedures",
  audit: "Audit trail",
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
  localStorage.setItem("agentix.taskFilter", state.taskFilter || "");
  localStorage.setItem("agentix.taskStatusFilter", state.taskStatusFilter || "");
  localStorage.setItem("agentix.approvalFilter", state.approvalFilter || "");
}

async function api(path, opts = {}) {
  const init = {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
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
    ["Approvals", String(state.approvals.length), "awaiting decisions"],
    ["Scheduler", String(state.jobs.length), `${state.jobs.filter((job) => job.enabled).length} enabled`],
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

function taskCard(task) {
  return `
    <div class="card ${state.selectedTaskId === task.id ? "selected" : ""}">
      <div class="row">
        <h4>${escapeHtml(task.kind)}</h4>
        <span class="pill">${escapeHtml(task.status)}</span>
        ${task.requiresApproval ? '<span class="pill danger">approval</span>' : ""}
      </div>
      <div class="meta">${escapeHtml(task.id)} / ${escapeHtml(task.sessionId)}</div>
      <div class="muted">${escapeHtml(JSON.stringify(task.payload, null, 2))}</div>
      <div class="meta">created ${fmtTime(task.createdAt)}${task.finishedAt ? ` · finished ${fmtTime(task.finishedAt)}` : ""}</div>
      <div class="row">
        <button class="ghost" data-action="select-task" data-id="${escapeHtml(task.id)}">Focus</button>
      </div>
    </div>
  `;
}

function toolCard(tool) {
  return `
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(tool.name)}</h4>
        <span class="pill success">ready</span>
      </div>
      <div class="muted">${escapeHtml(tool.description || "No description")}</div>
    </div>
  `;
}

function taskDetailCard() {
  const task = state.tasks.find((item) => item.id === state.selectedTaskId);
  if (!task) {
    return '<div class="card muted">Select a task to inspect details and recent activity.</div>';
  }
  const relatedEvents = state.events
    .filter((event) => String(event.detail || "").includes(task.id))
    .slice(0, 6);
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
      </div>
      <div class="panel-section">
        <div class="eyebrow">Recent related events</div>
        <div class="list">
          ${
            relatedEvents.length
              ? relatedEvents
                  .map(
                    (event) => `
                      <div class="card">
                        <div class="row">
                          <strong>${escapeHtml(event.title)}</strong>
                          <span class="meta">${fmtTime(event.createdAt)}</span>
                        </div>
                        <div class="muted">${escapeHtml(event.detail)}</div>
                      </div>
                    `,
                  )
                  .join("")
              : '<div class="card muted">No direct event matches yet.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function approvalCard(task) {
  return `
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(task.kind)}</h4>
        <span class="pill danger">pending</span>
      </div>
      <div class="meta">${escapeHtml(task.id)} / ${escapeHtml(task.sessionId)}</div>
      <div class="muted">${escapeHtml(JSON.stringify(task.payload, null, 2))}</div>
      <div class="row">
        <button class="primary" data-action="approve" data-id="${escapeHtml(task.id)}">Approve</button>
        <button class="ghost" data-action="reject" data-id="${escapeHtml(task.id)}">Reject</button>
        <button class="ghost" data-action="select-task" data-id="${escapeHtml(task.id)}">Inspect</button>
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

function jobCard(job) {
  return `
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(job.name)}</h4>
        <span class="pill ${job.enabled ? "success" : "danger"}">${job.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div class="meta">${escapeHtml(job.id)} · every ${Math.round(job.intervalMs / 1000)}s</div>
      <div class="muted">${escapeHtml(job.stimulus)}</div>
      <div class="meta">next ${fmtTime(job.nextRunAt)} · last ${fmtTime(job.lastRunAt)}</div>
      <div class="row">
        <button class="primary" data-action="run-job" data-id="${escapeHtml(job.id)}">Run now</button>
        <button class="ghost" data-action="toggle-job" data-id="${escapeHtml(job.id)}">${job.enabled ? "Disable" : "Enable"}</button>
        <button class="ghost danger" data-action="delete-job" data-id="${escapeHtml(job.id)}">Delete</button>
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

function healingView() {
  const failureList = (state.healing.failures || [])
    .map(
      (failure) => `
        <div class="card">
          <div class="row">
            <h4>${escapeHtml(failure.fingerprint)}</h4>
            <span class="pill">${failure.count}x</span>
          </div>
          <div class="muted">${escapeHtml(failure.lastError)}</div>
          <div class="meta">${fmtTime(failure.firstSeenAt)} - ${fmtTime(failure.lastSeenAt)}</div>
        </div>
      `,
    )
    .join("");

  const procList = (state.healing.procedures || [])
    .map(
      (procedure) => `
        <div class="card">
          <div class="row">
            <h4>${escapeHtml(procedure.status)}</h4>
            <span class="pill">${escapeHtml(procedure.id)}</span>
          </div>
          <div class="muted">${escapeHtml(procedure.summary)}</div>
          <div class="meta">${escapeHtml(procedure.fingerprint)} · uses ${procedure.uses || 0}</div>
          <div class="row">
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
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(entry.type)}</h4>
        <span class="pill">${escapeHtml(entry.actor)}</span>
      </div>
      <div class="meta">${escapeHtml(entry.id)}${entry.subjectId ? ` · ${escapeHtml(entry.subjectId)}` : ""}</div>
      <div class="muted">${escapeHtml(JSON.stringify(entry.data, null, 2))}</div>
      <div class="meta">${fmtTime(entry.createdAt)}</div>
    </div>
  `;
}

function sessionCard(session) {
  return `
    <div class="card">
      <div class="row">
        <h4>${escapeHtml(session.id)}</h4>
        <span class="pill">${escapeHtml(session.status || "active")}</span>
      </div>
      <div class="meta">created ${fmtTime(session.createdAt)}</div>
      <div class="row">
        <button class="primary" data-action="select-session" data-id="${escapeHtml(session.id)}">Open</button>
        <button class="ghost" data-action="delete-session" data-id="${escapeHtml(session.id)}">Close</button>
      </div>
    </div>
  `;
}

function renderLists() {
  const visibleTasks = filteredTasks();
  const visibleApprovals = filteredApprovals();
  if (!visibleTasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = visibleTasks[0]?.id || state.tasks[0]?.id || "";
    saveFilterState();
  }
  refs.taskDetail.innerHTML = taskDetailCard();
  refs.tasksList.innerHTML = visibleTasks.map(taskCard).join("") || '<div class="card muted">No tasks match the current filters.</div>';
  refs.toolsList.innerHTML = state.tools.map(toolCard).join("") || '<div class="card muted">No tools loaded yet.</div>';
  refs.approvalsList.innerHTML = visibleApprovals.map(approvalCard).join("") || '<div class="card muted">No approvals match the current filter.</div>';
  refs.jobsList.innerHTML = state.jobs.map(jobCard).join("") || '<div class="card muted">No scheduler jobs yet.</div>';
  refs.memoryList.innerHTML = state.memory.map(memoryCard).join("") || '<div class="card muted">Search memory to see results.</div>';
  refs.healingList.innerHTML = healingView();
  refs.auditList.innerHTML = state.audit.map(auditCard).join("") || '<div class="card muted">No audit entries yet.</div>';
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
  refs.healthChip.className = `chip ${state.health.status === "ok" ? "ok" : "warn"}`;
  refs.backendChip.textContent = `Backend: ${state.health.backend || "agentix"}`;
  refs.sessionChip.textContent = `Session: ${state.sessionId || "none"}`;
}

function renderFilters() {
  refs.taskFilterInput.value = state.taskFilter;
  refs.taskStatusFilter.value = state.taskStatusFilter;
  refs.approvalFilterInput.value = state.approvalFilter;
}

function renderToken() {
  refs.tokenInput.value = state.sessionToken;
}

function render() {
  renderFilters();
  renderToken();
  renderHealth();
  renderStats();
  renderLists();
  renderHistory();
  renderSessionSelect();
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === state.view);
  });
  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

async function refreshAll() {
  try {
    const [health, sessions, tasks, tools, approvals, jobs, audit, healing] = await Promise.all([
      api("/health"),
      api("/sessions"),
      api(`/tasks${state.sessionId ? `?sessionId=${encodeURIComponent(state.sessionId)}` : ""}`),
      api("/tools").catch(() => []),
      api("/approvals"),
      api("/scheduler/jobs"),
      api("/audit"),
      api("/healing/stats"),
    ]);
    state.health = health;
    state.sessions = sessions || [];
    state.tasks = tasks || [];
    state.tools = tools || [];
    state.approvals = approvals || [];
    state.jobs = jobs || [];
    state.audit = audit || [];
    state.healing = healing || { failures: [], procedures: [] };
    if (!state.sessionId && state.sessions[0]?.id) {
      state.sessionId = state.sessions[0].id;
      localStorage.setItem("agentix.sessionId", state.sessionId);
    }
    if (state.sessionId) {
      state.memory = await api(`/memory/search?q=${encodeURIComponent(state.sessionId)}`).catch(() => []);
    }
    state.lastError = "";
    appendEvent("refreshed", "Pulled live state from the backend", "success");
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    appendEvent("refresh failed", state.lastError, "danger");
  }
  render();
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
    source.addEventListener("task:queued", (event) => appendEvent("task queued", event.data, "success"));
    source.addEventListener("task:running", (event) => appendEvent("task running", event.data));
    source.addEventListener("task:complete", (event) => appendEvent("task complete", event.data, "success"));
    source.addEventListener("task:failed", (event) => appendEvent("task failed", event.data, "danger"));
    source.addEventListener("task:approve", (event) => appendEvent("approval requested", event.data, "warn"));
    source.addEventListener("task:reject", (event) => appendEvent("approval rejected", event.data, "danger"));
    source.onerror = () => appendEvent("events error", "Event stream disconnected or token rejected", "danger");
  } catch (err) {
    appendEvent("events failed", err instanceof Error ? err.message : String(err), "danger");
  }
}

async function streamExecute(stimulus) {
  const body = JSON.stringify({ stimulus, sessionId: state.sessionId || undefined });
  const res = await fetch("/execute/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    case "tools":
      setView("tools");
      await refreshAll();
      break;
    case "approvals":
      setView("approvals");
      await refreshAll();
      break;
    case "scheduler":
      setView("scheduler");
      await refreshAll();
      break;
    case "memory":
      setView("memory");
      await refreshAll();
      break;
    case "audit":
      setView("audit");
      await refreshAll();
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
  await api("/scheduler/jobs", {
    method: "POST",
    body: JSON.stringify({
      name: form.get("name"),
      stimulus: form.get("stimulus"),
      intervalMs: Number(form.get("intervalMs")),
      enabled: true,
    }),
  });
  event.currentTarget.reset();
  await refreshAll();
}

async function searchMemory(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const query = String(form.get("query") || "");
  state.memory = await api(`/memory/search?q=${encodeURIComponent(query)}`);
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
      await api(`/scheduler/jobs/${encodeURIComponent(id)}/run`, {
        method: "POST",
        body: "{}",
      });
    } else if (action === "toggle-job") {
      const job = state.jobs.find((item) => item.id === id);
      await api(`/scheduler/jobs/${encodeURIComponent(id)}/${job?.enabled ? "disable" : "enable"}`, {
        method: "POST",
        body: "{}",
      });
    } else if (action === "delete-job") {
      await api(`/scheduler/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else if (action === "promote-proc") {
      await api(`/healing/procedures/${encodeURIComponent(id)}/promote`, { method: "POST", body: "{}" });
    } else if (action === "deprecate-proc") {
      await api(`/healing/procedures/${encodeURIComponent(id)}/deprecate`, { method: "POST", body: "{}" });
    } else if (action === "select-session") {
      setSessionId(id);
      setView("compose");
    } else if (action === "select-task") {
      state.selectedTaskId = id;
      saveFilterState();
      setView("tasks");
    } else if (action === "delete-session") {
      await api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (state.sessionId === id) setSessionId("");
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
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      refs.composeInput.value = button.dataset.quick;
      setView("compose");
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
  refs.reloadToolsButton.addEventListener("click", refreshAll);
  refs.reloadApprovalsButton.addEventListener("click", refreshAll);
  refs.reloadJobsButton.addEventListener("click", refreshAll);
  refs.reloadHealingButton.addEventListener("click", refreshAll);
  refs.reloadAuditButton.addEventListener("click", refreshAll);
  refs.reloadSessionsButton.addEventListener("click", refreshAll);
  refs.consolidateButton.addEventListener("click", consolidateMemory);
  refs.newSessionButton.addEventListener("click", async () => {
    const session = await api("/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setSessionId(session.id);
    await refreshAll();
    setView("compose");
  });
  refs.memoryForm.addEventListener("submit", searchMemory);
  refs.jobForm.addEventListener("submit", createJob);
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
  refs.approvalFilterInput.addEventListener("input", () => {
    state.approvalFilter = refs.approvalFilterInput.value.trim();
    saveFilterState();
    render();
  });
  document.addEventListener("click", clickAction);
  document.addEventListener("keydown", (event) => {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      const map = {
        "1": "live",
        "2": "tasks",
        "3": "tools",
        "4": "approvals",
        "5": "scheduler",
        "6": "memory",
        "7": "healing",
        "8": "audit",
        "9": "sessions",
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
  refreshAll().then(connectEvents);
}

boot();
