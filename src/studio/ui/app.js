/* WorldSim Studio — Vanilla JS SPA */
/* global io */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    page: "dashboard",
    agentDetailId: null,
    world: null,
    agents: [],
    events: [],
    capabilities: null,
    connected: false,
    // Graph data
    graph: null,
    // Report data
    report: null,
    // Scenario data
    scenarios: null,
    scenarioStarting: false,
    worlds: [],
    selectedWorldId: "",
    worldRuns: [],
    compare: null,
    selectedCompareRuns: [],
    topics: null,
    topicsLoading: false,
    narrative: null,
    narrativeLoading: false,
    reportSubTab: "overview",
    reportRunId: null,
    tuningAgents: [],
    // Filters
    eventTypeFilter: "",
    eventAgentFilter: "",
  };

  // ── Socket.IO ──────────────────────────────────────────────────────
  const socket = io({ transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    state.connected = true;
    render();
  });

  socket.on("disconnect", () => {
    state.connected = false;
    render();
  });

  socket.on("world:snapshot", (data) => {
    if (state.selectedWorldId && data.worldId !== state.selectedWorldId) return;
    if (!state.selectedWorldId) state.selectedWorldId = data.worldId;
    state.world = {
      worldId: data.worldId,
      status: data.status,
      tick: data.tick,
      agentCount: data.agents.length,
    };
    state.agents = data.agents;
    render();
  });

  socket.on("world:tick", (data) => {
    if (state.selectedWorldId && data.worldId && data.worldId !== state.selectedWorldId) return;
    if (state.world) {
      state.world.tick = data.tick;
      state.world.activeAgents = data.activeAgents;
    }
    render();
  });

  socket.on("world:status", (data) => {
    if (state.world) state.world.status = data.status;
    loadWorlds();
    render();
  });

  socket.on("agent:action", (data) => {
    if (state.selectedWorldId && data.worldId && data.worldId !== state.selectedWorldId) return;
    state.events.unshift({
      type: "agent:action:" + data.action.actionType,
      tick: data.tick,
      agentId: data.agentId,
      agentName: data.agentName,
      payload: data.action.payload,
      timestamp: data.timestamp,
      metadata: data.action.metadata,
    });
    sortEventsNewestFirst(state.events);
    if (state.events.length > 500) state.events.length = 500;
    if (state.page === "events") render();
  });

  socket.on("agent:status", (data) => {
    if (state.selectedWorldId && data.worldId && data.worldId !== state.selectedWorldId) return;
    // Update agent status in local state
    const agent = state.agents.find((a) => a.id === data.agentId);
    if (agent) agent.status = data.newStatus;

    state.events.unshift({
      type: data.event.type,
      tick: data.event.tick,
      agentId: data.agentId,
      agentName: data.agentName,
      payload: { oldStatus: data.oldStatus, newStatus: data.newStatus, reason: data.event.reason },
      timestamp: data.timestamp,
      metadata: data.event.metadata,
    });
    sortEventsNewestFirst(state.events);
    if (state.events.length > 500) state.events.length = 500;
    render();
  });

  // ── API helpers ────────────────────────────────────────────────────
  async function api(path, options) {
    const res = await fetch("/api" + path, options);
    return res.json();
  }

  function withWorld(path) {
    if (!state.selectedWorldId) return path;
    const hasQuery = path.includes("?");
    return `${path}${hasQuery ? "&" : "?"}worldId=${encodeURIComponent(state.selectedWorldId)}`;
  }

  async function loadCapabilities() {
    state.capabilities = await api("/stores");
    render();
  }

  async function loadWorlds() {
    try {
      const data = await api("/worlds");
      state.worlds = data.worlds || [];
      state.worldRuns = data.runs || [];
      if (!state.selectedWorldId && state.worlds.length > 0) {
        const running = state.worlds.find((w) => w.status === "running");
        state.selectedWorldId = running?.worldId || state.worlds[0].worldId || "";
      }
    } catch {
      state.worlds = [];
      state.worldRuns = [];
    }
    render();
  }

  async function loadEvents() {
    const params = new URLSearchParams({ limit: "200" });
    if (state.eventTypeFilter) params.set("type", state.eventTypeFilter);
    if (state.eventAgentFilter) params.set("agent", state.eventAgentFilter);
    if (state.selectedWorldId) params.set("worldId", state.selectedWorldId);
    const data = await api("/events?" + params);
    state.events = data.events || [];
    sortEventsNewestFirst(state.events);
    render();
  }

  async function loadWorld() {
    const data = await api(withWorld("/world"));
    if (!data.error) {
      state.world = data;
    }
    render();
  }

  async function loadAgents() {
    const data = await api(withWorld("/agents"));
    if (data.agents) state.agents = data.agents;
    render();
  }

  async function loadTuning() {
    try {
      const data = await api(withWorld("/tuning/agents"));
      state.tuningAgents = data.agents || [];
    } catch {
      state.tuningAgents = [];
    }
    render();
  }

  // ── Navigation ─────────────────────────────────────────────────────
  function navigate(page, detail) {
    state.page = page;
    state.agentDetailId = detail || null;
    render();

    // Load data for specific pages
    if (page === "events") loadEvents();
    if (page === "graph") loadGraph();
    if (page === "report") loadReport();
    if (page === "worlds") loadWorlds();
    if (page === "scenarios") loadScenarios();
    if (page === "agentDetail") loadAgentDetail(detail);
    if (page === "dashboard") loadTuning();
  }

  // ── Graph loading ──────────────────────────────────────────────────
  async function loadGraph() {
    if (!state.capabilities?.stores?.graph?.connected) return;
    const data = await api(withWorld("/graph"));
    state.graph = data;
    render();
    renderGraph();
  }

  function renderGraph() {
    const container = document.getElementById("graph-canvas");
    if (!container || !state.graph) return;

    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    container.innerHTML = "";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const nodes = state.graph.nodes.map((n, i) => ({
      ...n,
      x: rect.width / 2 + Math.cos((i / state.graph.nodes.length) * Math.PI * 2) * 180,
      y: rect.height / 2 + Math.sin((i / state.graph.nodes.length) * Math.PI * 2) * 180,
      vx: 0,
      vy: 0,
    }));
    const edges = state.graph.relationships;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Simple force simulation
    function simulate() {
      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = nodeMap.get(edge.from);
        const b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.005 * (edge.strength || 0.5);
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }

      // Center gravity
      for (const node of nodes) {
        node.vx += (rect.width / 2 - node.x) * 0.001;
        node.vy += (rect.height / 2 - node.y) * 0.001;
        node.vx *= 0.9;
        node.vy *= 0.9;
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw edges
      for (const edge of edges) {
        const a = nodeMap.get(edge.from);
        const b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(88, 166, 255, ${(edge.strength || 0.5) * 0.6})`;
        ctx.lineWidth = Math.max(1, (edge.strength || 0.5) * 3);
        ctx.stroke();

        // Edge label
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = "#8b949e";
        ctx.font = "10px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(edge.type, mx, my - 4);
      }

      // Draw nodes
      for (const node of nodes) {
        const color = node.role === "control" ? "#bc8cff" : "#58a6ff";
        const statusColor = node.status === "running" ? "#3fb950" :
          node.status === "paused" ? "#d29922" :
          node.status === "stopped" ? "#f85149" : "#8b949e";

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, 18, 0, Math.PI * 2);
        ctx.fillStyle = "#161b22";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Status dot
        ctx.beginPath();
        ctx.arc(node.x + 12, node.y - 12, 5, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        // Label
        ctx.fillStyle = "#e6edf3";
        ctx.font = "12px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y + 32);
      }
    }

    let frame = 0;
    function loop() {
      simulate();
      draw();
      frame++;
      if (frame < 200) requestAnimationFrame(loop);
    }
    loop();
  }

  // ── Agent detail ───────────────────────────────────────────────────
  let agentDetail = null;
  let agentMemories = null;
  let agentRelationships = null;
  let agentSnapshots = null;
  let agentObservability = null;

  async function loadAgentDetail(id) {
    agentDetail = await api(withWorld("/agents/" + id));
    agentObservability = await api(withWorld("/agents/" + id + "/observability")).catch(() => null);

    if (state.capabilities?.stores?.memory?.connected) {
      const memData = await api(withWorld("/agents/" + id + "/memories?limit=50"));
      agentMemories = memData.memories || [];
    } else {
      agentMemories = null;
    }

    if (state.capabilities?.stores?.graph?.connected) {
      const relData = await api(withWorld("/agents/" + id + "/relationships"));
      agentRelationships = relData.relationships || [];
    } else {
      agentRelationships = null;
    }

    if (state.capabilities?.stores?.persistence?.connected) {
      const snapData = await api(withWorld("/agents/" + id + "/snapshots?limit=10"));
      agentSnapshots = snapData.snapshots || [];
    } else {
      agentSnapshots = null;
    }

    render();
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="app">
        ${renderSidebar()}
        <div class="main">
          ${renderPage()}
        </div>
      </div>
    `;
    attachHandlers();

    // Redraw canvases after render if on those pages
    if (state.page === "graph" && state.graph) {
      setTimeout(renderGraph, 20);
    }
    if (state.page === "report" && state.report) {
      setTimeout(() => { drawMoodHeatmap(); drawEnergyChart(); drawActionBars(); }, 20);
    }
  }

  function renderSidebar() {
    const cap = state.capabilities;
    const hasGraph = cap?.stores?.graph?.connected;
    const hasMemory = cap?.stores?.memory?.connected;
    const hasPersistence = cap?.stores?.persistence?.connected;
    const hasVector = cap?.stores?.vector?.connected;

    const connStatus = state.connected ? "Connected" : "Disconnected";
    const worldStatus = state.world?.status ?? "unknown";

    return `
      <div class="sidebar">
        <div class="sidebar-header">
          <span class="logo">&#x1F30D;</span> WorldSim Studio
        </div>
        <div class="sidebar-nav">
          ${navItem("dashboard", "Dashboard")}
          ${navItem("agents", "Agents")}
          ${navItem("events", "Event Log")}
          ${navItem("graph", "Relationships", !hasGraph)}
          ${navItem("scenarios", "Scenarios")}
          ${navItem("report", "Report")}
          ${navItem("worlds", "World Runs")}
          ${navItem("conversations", "Conversations", !hasPersistence)}
          ${navItem("search", "Semantic Search", !hasVector)}
          ${navItem("setup", "Store Setup")}
        </div>
        <div class="sidebar-status">
          <div style="margin-bottom:8px">
            <select id="world-selector" class="filter-select" style="width:100%">
              <option value="">All worlds</option>
              ${state.worlds.map((w) => `<option value="${esc(w.worldId)}" ${state.selectedWorldId === w.worldId ? "selected" : ""}>${esc(w.worldId)} (${w.status})</option>`).join("")}
            </select>
          </div>
          <div>WS: ${connStatus}</div>
          <div>World: <span class="status status-${worldStatus}">${worldStatus}</span></div>
          ${state.world ? `<div>Tick: ${state.world.tick ?? 0}</div>` : ""}
        </div>
      </div>
    `;
  }

  function navItem(page, label, disabled) {
    const active = state.page === page ? "active" : "";
    const cls = disabled ? "disabled" : "";
    return `<div class="nav-item ${active} ${cls}" data-nav="${disabled ? "" : page}">
      ${label}
      ${disabled ? '<span class="badge">N/A</span>' : ""}
    </div>`;
  }

  function renderPage() {
    switch (state.page) {
      case "dashboard": return renderDashboard();
      case "agents": return renderAgents();
      case "agentDetail": return renderAgentDetail();
      case "events": return renderEvents();
      case "graph": return renderGraphPage();
      case "scenarios": return renderScenariosPage();
      case "report": return renderReportPage();
      case "worlds": return renderWorldRunsPage();
      case "conversations": return renderConversations();
      case "search": return renderSearch();
      case "setup": return renderSetup();
      default: return renderDashboard();
    }
  }

  // ── Pages ──────────────────────────────────────────────────────────

  function renderDashboard() {
    const w = state.world;
    const agentCount = state.agents.length || w?.agents?.total || 0;
    const activeCount = w?.activeAgents ?? w?.agents?.active ?? 0;
    const tick = w?.tick ?? 0;
    const status = w?.status ?? "unknown";
    const eventCount = w?.eventCount ?? state.events.length;
    const tuningOutliers = (state.tuningAgents || []).filter((a) => (a.warnings || []).length > 0);

    return `
      <div class="section-title">Dashboard</div>
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${tick}</div>
          <div class="stat-label">Current Tick</div>
        </div>
        <div class="stat-card">
          <div class="stat-value"><span class="status status-${status}">${status}</span></div>
          <div class="stat-label">World Status</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${agentCount}</div>
          <div class="stat-label">Total Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${activeCount}</div>
          <div class="stat-label">Active Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${eventCount}</div>
          <div class="stat-label">Events Logged</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Activity</span>
        </div>
        <div class="event-list">
          ${state.events.slice(0, 10).map(renderEventRow).join("")}
          ${state.events.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No events yet. Start the simulation to see activity.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Connected Stores</span>
        </div>
        ${renderStoresSummary()}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Cost & Latency Tuning</span>
          <span class="badge">${tuningOutliers.length} outliers</span>
        </div>
        <div class="event-list">
          ${tuningOutliers.slice(0, 8).map((t) => `
            <div class="event-row">
              <span class="event-type">${esc(t.agentId)}</span>
              <span class="event-agent">${(t.warnings || []).join(", ") || "ok"}</span>
              <span class="event-payload">avgLatency=${Number(t.avgLatencyMs || 0).toFixed(1)}ms · tokens=${t.usage?.lifetimeTokens ?? 0}</span>
            </div>
          `).join("")}
          ${tuningOutliers.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No outliers detected with current thresholds.</div></div>' : ""}
        </div>
      </div>
    `;
  }

  function renderStoresSummary() {
    if (!state.capabilities) return "<div>Loading...</div>";
    const stores = state.capabilities.stores;
    return Object.entries(stores).map(([name, info]) => {
      const statusClass = info.connected ? "connected" : "disconnected";
      const statusText = info.connected ? "Connected" : "Not connected";
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="text-transform:capitalize">${name}</span>
        <span class="store-guide-status ${statusClass}">${statusText}</span>
      </div>`;
    }).join("");
  }

  function renderAgents() {
    return `
      <div class="section-title">Agents</div>
      <div class="section-subtitle">${state.agents.length} agents registered</div>
      <div class="agent-grid">
        ${state.agents.map((agent) => `
          <div class="agent-card" data-agent-detail="${agent.id}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div class="agent-name">${esc(agent.name || agent.id)}</div>
              <span class="status status-${agent.status}">${agent.status}</span>
            </div>
            <div class="agent-role">${agent.role}</div>
            ${agent.state ? `
              <div class="agent-state">
                <div class="agent-state-item">
                  <span class="agent-state-label">Mood:</span> ${esc(agent.state.mood || "—")}
                </div>
                <div class="agent-state-item">
                  <span class="agent-state-label">Energy:</span> ${agent.state.energy ?? "—"}
                </div>
              </div>
              ${agent.state.goals?.length ? `
                <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">
                  Goals: ${agent.state.goals.map((g) => esc(g)).join(", ")}
                </div>
              ` : ""}
            ` : ""}
            ${agent.profile?.profession ? `<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">${esc(agent.profile.profession)}</div>` : ""}
          </div>
        `).join("")}
        ${state.agents.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No agents registered yet.</div></div>' : ""}
      </div>
    `;
  }

  function renderAgentDetail() {
    if (!agentDetail) return "<div>Loading...</div>";
    const a = agentDetail;

    return `
      <div class="back-link" data-nav="agents">&larr; Back to Agents</div>
      <div class="section-title">${esc(a.profile?.name || a.id)}</div>
      <div class="section-subtitle">${a.role} &middot; <span class="status status-${a.status}">${a.status}</span></div>

      ${a.profile ? `
        <div class="card">
          <div class="card-title">Profile</div>
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
            ${a.profile.age ? `<div><span class="agent-state-label">Age:</span> ${a.profile.age}</div>` : ""}
            ${a.profile.profession ? `<div><span class="agent-state-label">Profession:</span> ${esc(a.profile.profession)}</div>` : ""}
            ${a.profile.personality?.length ? `<div style="grid-column:1/-1"><span class="agent-state-label">Personality:</span> ${a.profile.personality.map((p) => esc(p)).join(", ")}</div>` : ""}
            ${a.profile.goals?.length ? `<div style="grid-column:1/-1"><span class="agent-state-label">Goals:</span> ${a.profile.goals.map((g) => esc(g)).join(", ")}</div>` : ""}
            ${a.profile.backstory ? `<div style="grid-column:1/-1"><span class="agent-state-label">Backstory:</span> ${esc(a.profile.backstory)}</div>` : ""}
          </div>
        </div>
      ` : ""}

      <div class="card">
        <div class="card-title">Internal State</div>
        <div style="margin-top:8px;font-size:13px">
          <div><span class="agent-state-label">Mood:</span> ${esc(a.state?.mood || "—")}</div>
          <div><span class="agent-state-label">Energy:</span> ${a.state?.energy ?? "—"}</div>
          <div><span class="agent-state-label">Goals:</span> ${(a.state?.goals || []).map((g) => esc(g)).join(", ") || "—"}</div>
        </div>
      </div>

      ${agentObservability ? `
        <div class="card">
          <div class="card-title">Observability</div>
          <div style="margin-top:8px;font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><span class="agent-state-label">Tick tokens:</span> ${agentObservability.tokenUsage?.tickTokens ?? 0}</div>
            <div><span class="agent-state-label">Hour tokens:</span> ${agentObservability.tokenUsage?.hourTokens ?? 0}</div>
            <div><span class="agent-state-label">Lifetime tokens:</span> ${agentObservability.tokenUsage?.lifetimeTokens ?? 0}</div>
            <div><span class="agent-state-label">Requests:</span> ${agentObservability.tokenUsage?.lifetimeRequests ?? 0}</div>
            <div><span class="agent-state-label">Avg latency:</span> ${Number(agentObservability.latency?.avgMs ?? 0).toFixed(1)}ms</div>
            <div><span class="agent-state-label">Max latency:</span> ${Number(agentObservability.latency?.maxMs ?? 0).toFixed(1)}ms</div>
            ${agentObservability.storage ? `<div><span class="agent-state-label">Storage:</span> ${agentObservability.storage.estimatedBytes} bytes</div>` : ""}
            ${agentObservability.graph ? `<div><span class="agent-state-label">Relationships:</span> ${agentObservability.graph.relationships} (avg ${agentObservability.graph.averageStrength})</div>` : ""}
          </div>
        </div>
      ` : ""}

      ${agentMemories !== null ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Memories</span>
            <span class="badge">${agentMemories.length}</span>
          </div>
          ${agentMemories.map((m) => `
            <div class="memory-item" data-type="${m.type}">
              <div class="memory-meta">Tick ${m.tick} &middot; ${m.type}${m.importance ? ` &middot; importance: ${m.importance}` : ""}</div>
              <div class="memory-content">${esc(m.content)}</div>
            </div>
          `).join("")}
          ${agentMemories.length === 0 ? "<div class='empty-state'><div class='empty-state-text'>No memories stored.</div></div>" : ""}
        </div>
      ` : ""}

      ${agentRelationships !== null ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Relationships</span>
            <span class="badge">${agentRelationships.length}</span>
          </div>
          ${agentRelationships.map((r) => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
              <span>${esc(r.from === a.id ? r.to : r.from)}</span>
              <span style="color:var(--text-muted)">${esc(r.type)}</span>
              <span>strength: ${r.strength.toFixed(2)}</span>
            </div>
          `).join("")}
          ${agentRelationships.length === 0 ? "<div class='empty-state'><div class='empty-state-text'>No relationships.</div></div>" : ""}
        </div>
      ` : ""}

      ${agentSnapshots !== null ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title">State History</span>
            <span class="badge">${agentSnapshots.length}</span>
          </div>
          ${agentSnapshots.map((s) => `
            <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
              <div class="memory-meta">Tick ${s.tick} &middot; ${new Date(s.timestamp).toLocaleString()}</div>
              <div>Mood: ${esc(s.state.mood)} &middot; Energy: ${s.state.energy}</div>
            </div>
          `).join("")}
          ${agentSnapshots.length === 0 ? "<div class='empty-state'><div class='empty-state-text'>No snapshots.</div></div>" : ""}
        </div>
      ` : ""}
    `;
  }

  function renderEvents() {
    return `
      <div class="section-title">Event Log</div>
      <div class="filters">
        <input class="filter-input" id="filter-type" placeholder="Filter by type..." value="${esc(state.eventTypeFilter)}">
        <input class="filter-input" id="filter-agent" placeholder="Filter by agent ID..." value="${esc(state.eventAgentFilter)}">
        <button class="btn btn-sm" id="filter-apply">Apply</button>
        <button class="btn btn-sm" id="filter-clear" style="background:var(--border)">Clear</button>
      </div>
      <div class="card">
        <div class="event-list">
          ${state.events.map(renderEventRow).join("")}
          ${state.events.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No events match the current filters.</div></div>' : ""}
        </div>
      </div>
    `;
  }

  function renderEventRow(event) {
    const payload = typeof event.payload === "string"
      ? event.payload
      : event.payload ? JSON.stringify(event.payload).slice(0, 120) : "";
    return `
      <div class="event-row">
        <span class="event-tick">${formatSimTime(event)}</span>
        <span class="event-type">${esc(event.type)}</span>
        <span class="event-agent">${esc(event.agentName || event.agentId || "—")}</span>
        <span class="event-payload">${esc(payload)}</span>
      </div>
    `;
  }

  function sortEventsNewestFirst(events) {
    events.sort((a, b) => compareTimelineEvent(b, a));
  }

  function compareTimelineEvent(a, b) {
    const tickDiff = (a.tick || 0) - (b.tick || 0);
    if (tickDiff !== 0) return tickDiff;

    const offsetDiff = timelineOffset(a.metadata) - timelineOffset(b.metadata);
    if (offsetDiff !== 0) return offsetDiff;

    const seqDiff = ((a.metadata && a.metadata.tickSequence) || 0) - ((b.metadata && b.metadata.tickSequence) || 0);
    if (seqDiff !== 0) return seqDiff;

    return String(a.timestamp || "").localeCompare(String(b.timestamp || ""));
  }

  function timelineOffset(metadata) {
    if (!metadata) return 0;
    if (typeof metadata.actionAtOffsetMs === "number") return metadata.actionAtOffsetMs;
    if (typeof metadata.simulatedAtOffsetMs === "number") return metadata.simulatedAtOffsetMs;
    if (typeof metadata.intraTickMs === "number") return metadata.intraTickMs;
    return 0;
  }

  function formatSimTime(event) {
    const offset = timelineOffset(event.metadata);
    return offset > 0 ? `T${event.tick}+${Math.round(offset)}ms` : `T${event.tick}`;
  }

  function renderGraphPage() {
    if (!state.capabilities?.stores?.graph?.connected) {
      return renderStoreRequired("graph", "Relationships");
    }
    return `
      <div class="section-title">Relationship Graph</div>
      <div class="section-subtitle">Force-directed visualization of agent relationships</div>
      <div class="graph-container" id="graph-canvas">
        ${!state.graph ? '<div class="empty-state"><div class="empty-state-text">Loading graph...</div></div>' : ""}
      </div>
      ${state.graph ? `<div style="margin-top:12px;font-size:13px;color:var(--text-muted)">${state.graph.nodes.length} nodes &middot; ${state.graph.relationships.length} edges</div>` : ""}
    `;
  }

  function renderConversations() {
    if (!state.capabilities?.stores?.persistence?.connected) {
      return renderStoreRequired("persistence", "Conversations");
    }
    return `
      <div class="section-title">Conversations</div>
      <div class="section-subtitle">Recorded agent conversations from PersistenceStore</div>
      <div id="conversations-container">
        <div class="empty-state"><div class="empty-state-text">Loading conversations...</div></div>
      </div>
    `;
  }

  function renderSearch() {
    if (!state.capabilities?.stores?.vector?.connected) {
      return renderStoreRequired("vector", "Semantic Search");
    }
    return `
      <div class="section-title">Semantic Search</div>
      <div class="section-subtitle">Search agent memories by meaning using vector similarity</div>
      <div class="filters">
        <input class="filter-input" id="search-query" placeholder="Enter search query..." style="flex:1">
        <input class="filter-input" id="search-agent" placeholder="Agent ID (optional)" style="width:200px">
        <button class="btn" id="search-btn">Search</button>
      </div>
      <div id="search-results"></div>
    `;
  }

  function renderWorldRunsPage() {
    const runs = state.worldRuns || [];
    return `
      <div class="section-title">World Runs</div>
      <div class="section-subtitle">Storico run per mondo e confronto rapido tra due run</div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Recent Runs</span>
          <button class="btn btn-sm" id="worlds-refresh">Refresh</button>
        </div>
        <div class="event-list">
          ${runs.map((r) => `
            <div class="event-row">
              <span class="event-type">${esc(r.worldId)}</span>
              <span class="event-agent">${esc(r.runId.slice(0, 8))}</span>
              <span class="event-payload">tick ${r.tick} · actions ${r.totalActions} · ${r.status}</span>
              <button class="btn btn-sm" data-compare-run="${esc(r.runId)}">Select</button>
            </div>
          `).join("")}
          ${runs.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No run history available yet.</div></div>' : ""}
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Compare Runs</span>
          <button class="btn btn-sm" id="compare-clear">Clear</button>
        </div>
        <div id="compare-results">
          ${state.compare ? `
            <div style="font-family:var(--font-mono);font-size:13px;line-height:1.7">
              <div>Runs: ${esc(state.compare.runIds.join(" vs "))}</div>
              <div>Worlds: ${esc(state.compare.worlds.join(" vs "))}</div>
              <div>Δ totalActions: ${state.compare.metrics.totalActionsDelta}</div>
              <div>Δ totalToolCalls: ${state.compare.metrics.totalToolCallsDelta}</div>
              <div>Δ totalSpeaks: ${state.compare.metrics.totalSpeaksDelta}</div>
              <div>Δ averageEnergy: ${state.compare.metrics.averageEnergyDelta}</div>
              <div>Δ ruleViolations: ${state.compare.metrics.ruleViolationsDelta}</div>
              <div>Δ totalTokens: ${state.compare.metrics.totalTokensDelta}</div>
              <div>Δ avgLatencyMs: ${state.compare.metrics.avgLatencyDelta}</div>
              <div>Δ estimatedCost: ${state.compare.metrics.estimatedCostDelta}</div>
            </div>
          ` : '<div class="empty-state"><div class="empty-state-text">Select two runs to compare.</div></div>'}
        </div>
      </div>
    `;
  }

  // ── Scenarios ──────────────────────────────────────────────────────
  async function loadScenarios() {
    try {
      state.scenarios = await api("/scenarios");
    } catch {
      state.scenarios = { presets: [], hasApiKey: false };
    }
    render();
  }

  function renderScenariosPage() {
    const data = state.scenarios;
    if (!data) return '<div class="section-title">Scenarios</div><div>Loading...</div>';

    const presets = data.presets || [];
    const isRunning = state.world?.status === "running" || state.world?.status === "bootstrapping";

    return `
      <div class="section-title">Scenarios</div>
      <div class="section-subtitle">Select a preset scenario or upload your own to start a simulation</div>

      ${!data.hasApiKey ? `
        <div class="card" style="border-color:var(--yellow)">
          <div class="card-title">LLM Configuration Required</div>
          <div style="margin-top:8px;font-size:13px;color:var(--text-muted)">
            Set the <code>OPENAI_API_KEY</code> environment variable to start simulations.
          </div>
        </div>
      ` : ""}

      ${isRunning ? `
        <div class="card" style="border-color:var(--green)">
          <div style="font-size:13px;color:var(--green)">A simulation is currently running. Wait for it to finish or stop it before starting a new one.</div>
        </div>
      ` : ""}

      <div class="agent-grid">
        ${presets.map((p) => `
          <div class="agent-card scenario-card">
            <div class="agent-name">${esc(p.name)}</div>
            <div style="font-size:13px;color:var(--text-muted);margin:8px 0">${esc(p.description)}</div>
            <div class="agent-state">
              <div class="agent-state-item"><span class="agent-state-label">Agents:</span> ${p.agentCount}</div>
              <div class="agent-state-item"><span class="agent-state-label">Ticks:</span> ${p.maxTicks}</div>
            </div>
            ${!isRunning && data.hasApiKey ? `<button class="btn" style="margin-top:12px;width:100%" data-start-scenario="${esc(p.id)}">Start Simulation</button>` : ""}
          </div>
        `).join("")}
        ${presets.length === 0 ? `
          <div class="empty-state" style="grid-column:1/-1;padding:40px">
            <div class="empty-state-text">No preset scenarios available. Use the upload area to load a custom scenario JSON file.</div>
          </div>
        ` : ""}
      </div>

      ${!isRunning ? `
        <div class="card" style="margin-top:20px">
          <div class="card-title">Upload Custom Scenario</div>
          <div class="scenario-upload" id="scenario-dropzone">
            <div style="font-size:14px;color:var(--text-muted);text-align:center;padding:30px;cursor:pointer">
              Drop a <strong>scenario.json</strong> file here or click to select
            </div>
            <input type="file" id="scenario-file" accept=".json" style="display:none">
          </div>
          <div id="scenario-preview"></div>
        </div>
      ` : ""}
    `;
  }

  async function startScenario(presetId) {
    if (state.scenarioStarting) return;
    state.scenarioStarting = true;
    render();

    try {
      const result = await fetch("/api/scenario/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      }).then((r) => r.json());

      if (result.started) {
        navigate("dashboard");
        // Request fresh snapshot
        setTimeout(() => socket.emit("request:snapshot"), 500);
      } else {
        alert("Failed to start: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error starting scenario: " + err.message);
    } finally {
      state.scenarioStarting = false;
    }
  }

  async function startCustomScenario(scenario) {
    if (state.scenarioStarting) return;
    state.scenarioStarting = true;

    try {
      const result = await fetch("/api/scenario/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      }).then((r) => r.json());

      if (result.started) {
        navigate("dashboard");
        setTimeout(() => socket.emit("request:snapshot"), 500);
      } else {
        alert("Failed to start: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      state.scenarioStarting = false;
    }
  }

  // ── Report ─────────────────────────────────────────────────────────
  async function loadReport() {
    try {
      if (state.selectedWorldId) {
        const data = await api(`/worlds/${encodeURIComponent(state.selectedWorldId)}/report/live`);
        state.report = data.report || null;
        const runId = data.runId;
        state.reportRunId = runId || null;
        if (runId) {
          const runData = await fetch(`/api/reports/${encodeURIComponent(runId)}`)
            .then((r) => r.json())
            .catch(() => null);
          state.topics = runData?.topics || null;
        }
      } else {
        const data = await api("/report");
        if (data.ready === false) {
          state.report = null;
        } else {
          state.report = data;
        }
        state.reportRunId = null;
      }
    } catch {
      state.report = null;
    }
    render();
    if (state.report) {
      setTimeout(() => {
        if (state.reportSubTab === "overview") {
          drawMoodHeatmap();
          drawEnergyChart();
          drawActionBars();
        }
        if (state.reportSubTab === "network") drawNetworkViews();
        if (state.reportSubTab === "dialogue") drawDialogueViews();
        if (state.reportSubTab === "archetypes") drawArchetypeViews();
      }, 50);
    }
  }

  function renderReportPage() {
    if (!state.report) {
      return `
        <div class="section-title">Simulation Report</div>
        <div class="empty-state" style="padding:60px">
          <div class="empty-state-text">Report not available yet. The simulation must complete first.</div>
          <div style="margin-top:12px"><button class="btn" id="report-refresh">Refresh</button></div>
        </div>
      `;
    }

    const r = state.report;
    const s = r.summary;
    const subTab = state.reportSubTab || "overview";

    const tabs = [
      { id: "overview", label: "Panoramica" },
      { id: "network", label: "Rete" },
      { id: "dialogue", label: "Dialogica" },
      { id: "shock", label: "Impatto policy" },
      { id: "archetypes", label: "Archetipi" },
      { id: "narrative", label: "Narrativa" },
    ];

    return `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="section-title" style="margin-bottom:0">Simulation Report</div>
        <div style="display:flex;gap:8px">
          <button class="btn" id="report-refresh">Refresh</button>
          <button class="btn" id="report-download">Download JSON</button>
        </div>
      </div>
      <div class="section-subtitle">${esc(s.worldId)} &middot; ${(s.durationMs / 1000).toFixed(1)}s</div>

      <div class="report-subnav" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 16px">
        ${tabs.map((t) => `
          <button class="btn btn-sm ${subTab === t.id ? "btn-primary" : ""}" data-report-subtab="${t.id}">${t.label}</button>
        `).join("")}
      </div>

      ${renderReportSubTab(subTab, r)}
    `;
  }

  function renderReportSubTab(subTab, r) {
    switch (subTab) {
      case "overview": return renderOverviewSubTab(r);
      case "network": return renderNetworkSubTab(r);
      case "dialogue": return renderDialogueSubTab(r);
      case "shock": return renderShockSubTab(r);
      case "archetypes": return renderArchetypesSubTab(r);
      case "narrative": return renderNarrativeSubTab(r);
      default: return renderOverviewSubTab(r);
    }
  }

  function exportButton(dataset, label) {
    if (!state.reportRunId) return "";
    const href = `/api/reports/${encodeURIComponent(state.reportRunId)}/export.csv?dataset=${encodeURIComponent(dataset)}`;
    return `<a class="btn btn-sm" href="${href}" download>Export ${esc(label)} CSV</a>`;
  }

  function renderOverviewSubTab(r) {
    const s = r.summary;
    const topTools = computeTopTools(r);
    return `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${s.totalTicks}</div><div class="stat-label">Ticks</div></div>
        <div class="stat-card"><div class="stat-value">${s.agentCount}</div><div class="stat-label">Agents</div></div>
        <div class="stat-card"><div class="stat-value">${s.totalActions}</div><div class="stat-label">Actions</div></div>
        <div class="stat-card"><div class="stat-value">${r.metrics.totalSpeaks}</div><div class="stat-label">Speaks</div></div>
        <div class="stat-card"><div class="stat-value">${r.metrics.ruleViolations}</div><div class="stat-label">Violations</div></div>
        <div class="stat-card"><div class="stat-value">${r.metrics.totalTokens}</div><div class="stat-label">Tokens</div></div>
        <div class="stat-card"><div class="stat-value">${r.metrics.avgLatencyMs.toFixed(1)}ms</div><div class="stat-label">Avg Latency</div></div>
        <div class="stat-card"><div class="stat-value">${r.metrics.estimatedCost.amount.toFixed(4)} ${esc(r.metrics.estimatedCost.currency)}</div><div class="stat-label">Estimated Cost</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Mood Heatmap</span>
          <span class="badge">agents x ticks</span>
        </div>
        <div class="chart-container" id="mood-heatmap" style="height:${Math.max(200, r.agents.filter(a => a.role !== "control").length * 32 + 60)}px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Energy Over Time</span>
        </div>
        <div class="chart-container" id="energy-chart" style="height:280px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Action Distribution</span>
        </div>
        <div class="chart-container" id="action-bars" style="height:${Math.max(180, r.agents.filter(a => a.role !== "control").length * 36 + 40)}px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Top Tools</span>
          <span class="badge">${topTools.length}</span>
        </div>
        <div class="event-list">
          ${topTools.map((t, i) => `
            <div class="event-row">
              <span class="event-tick">#${i + 1}</span>
              <span class="event-type">${esc(t.name)}</span>
              <span class="event-payload">${t.count} calls</span>
            </div>
          `).join("")}
          ${topTools.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No tool calls recorded.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Tematiche</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" id="topics-refresh">Refresh</button>
          </div>
        </div>
        <div class="event-list">
          ${(state.topics || []).map((t) => `
            <div class="event-row">
              <span class="event-type">${esc(t.topic)}</span>
              <span class="event-agent">${esc(t.trend)}</span>
              <span class="event-payload">${esc(t.evidence)} (conf: ${Number(t.confidence || 0).toFixed(2)})</span>
            </div>
          `).join("")}
          ${!state.topics || state.topics.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Tematiche non ancora analizzate.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Timeline</span>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="badge">${r.timeline.length} events</span>
            ${exportButton("timeline", "timeline")}
          </div>
        </div>
        <div class="report-timeline">
          ${r.timeline.slice(0, 100).map((t) => `
            <div class="timeline-entry timeline-${t.type}">
              <span class="event-tick">${formatSimTime(t)}</span>
              <span class="timeline-desc">${esc(t.description)}</span>
            </div>
          `).join("")}
          ${r.timeline.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No timeline events.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Per-Agent Summary</span>
          ${exportButton("agents", "agents")}
        </div>
        <div class="agent-report-grid">
          ${r.agents.filter(a => a.role !== "control").map((a) => {
            const lastMood = a.moodTrajectory.length ? a.moodTrajectory[a.moodTrajectory.length - 1].mood : "?";
            const lastEnergy = a.energyTrajectory.length ? a.energyTrajectory[a.energyTrajectory.length - 1].energy : 0;
            return `
              <div class="agent-report-card">
                <div class="agent-name">${esc(a.name)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${a.personality.join(", ")}</div>
                <div class="agent-state">
                  <div class="agent-state-item"><span class="agent-state-label">Actions:</span> ${a.totalActions}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Mood:</span> ${esc(lastMood)}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Energy:</span> ${lastEnergy}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Speaks:</span> ${a.actions.speak}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Observes:</span> ${a.actions.observe}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Tools:</span> ${a.actions.tool_call}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Tokens:</span> ${a.observability?.tokenUsage?.lifetimeTokens ?? 0}</div>
                  <div class="agent-state-item"><span class="agent-state-label">Latency:</span> ${Number(a.observability?.latency?.avgMs ?? 0).toFixed(1)}ms</div>
                  <div class="agent-state-item"><span class="agent-state-label">Cost:</span> ${Number(a.observability?.cost?.estimated ?? 0).toFixed(4)} ${esc(a.observability?.cost?.currency ?? "USD")}</div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderNetworkSubTab(r) {
    const net = r.network;
    if (!net) {
      return `<div class="empty-state" style="padding:48px"><div class="empty-state-text">Nessuna analisi di rete disponibile (nessuna relazione tracciata).</div></div>`;
    }
    const topCentrality = [...net.centrality].sort((a, b) => b.eigenvector - a.eigenvector).slice(0, 5);
    const densityLast = net.density.length ? net.density[net.density.length - 1].value : 0;
    const changes = net.relationshipChanges.slice(-20).reverse();
    return `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${(densityLast * 100).toFixed(1)}%</div><div class="stat-label">Densità finale</div></div>
        <div class="stat-card"><div class="stat-value">${(net.reciprocity * 100).toFixed(1)}%</div><div class="stat-label">Reciprocità</div></div>
        <div class="stat-card"><div class="stat-value">${net.communities.length}</div><div class="stat-label">Community</div></div>
        <div class="stat-card"><div class="stat-value">${net.sociogramFinal.edges.length}</div><div class="stat-label">Archi</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Top agenti per centralità (eigenvector)</span>
          ${exportButton("centrality", "centrality")}
        </div>
        <div class="event-list">
          ${topCentrality.map((c, i) => `
            <div class="event-row">
              <span class="event-tick">#${i + 1}</span>
              <span class="event-type">${esc(c.agentId)}</span>
              <span class="event-payload">degree ${c.degree} &middot; between ${c.betweenness.toFixed(3)} &middot; eigen ${c.eigenvector.toFixed(3)}</span>
            </div>
          `).join("")}
          ${topCentrality.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Grafo vuoto.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Community</span></div>
        <div class="event-list">
          ${net.communities.map((c) => `
            <div class="event-row">
              <span class="event-type">${esc(c.id)}</span>
              <span class="event-agent">${c.members.length} membri</span>
              <span class="event-payload">coesione ${c.cohesion.toFixed(3)} &middot; ${c.members.map(esc).join(", ")}</span>
            </div>
          `).join("")}
          ${net.communities.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Nessuna community sopra la soglia.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Homophily</span></div>
        <div class="event-list">
          ${net.homophily.map((h) => `
            <div class="event-row">
              <span class="event-type">${esc(h.attribute)}</span>
              <span class="event-payload">assortatività ${h.assortativity.toFixed(3)}</span>
            </div>
          `).join("")}
          ${net.homophily.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Attributi insufficienti.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Cambiamenti di relazioni</span>
          <span class="badge">${net.relationshipChanges.length}</span>
          ${exportButton("relationships", "relationships")}
        </div>
        <div class="event-list">
          ${changes.map((c) => `
            <div class="event-row">
              <span class="event-tick">T${c.tick}</span>
              <span class="event-type">${esc(c.type)}</span>
              <span class="event-payload">${esc(c.from)} → ${esc(c.to)} ${c.fromType ? `(${esc(c.fromType)})` : ""}${c.toType ? ` → ${esc(c.toType)}` : ""}${c.delta != null ? ` Δ ${c.delta.toFixed(2)}` : ""}</span>
            </div>
          `).join("")}
          ${changes.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Nessun cambiamento registrato.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Densità nel tempo</span></div>
        <div class="chart-container" id="density-chart" style="height:240px"></div>
      </div>
    `;
  }

  function renderDialogueSubTab(r) {
    const d = r.dialogue;
    if (!d) {
      return `<div class="empty-state" style="padding:48px"><div class="empty-state-text">Nessuna analisi dialogica disponibile.</div></div>`;
    }
    const topResponders = [...d.responseRate].sort((a, b) => b.rate - a.rate).slice(0, 8);
    return `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">${d.conversationStats.total}</div><div class="stat-label">Conversazioni</div></div>
        <div class="stat-card"><div class="stat-value">${d.conversationStats.avgTurns.toFixed(1)}</div><div class="stat-label">Turni medi</div></div>
        <div class="stat-card"><div class="stat-value">${d.voiceGini.toFixed(3)}</div><div class="stat-label">Voice Gini</div></div>
        <div class="stat-card"><div class="stat-value">${d.speakMatrix.reduce((s, e) => s + e.count, 0)}</div><div class="stat-label">Messaggi</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Distribuzione dei speak per agente</span>
          ${exportButton("voice", "voice")}
        </div>
        <div class="chart-container" id="voice-chart" style="height:${Math.max(180, d.voiceByAgent.length * 28 + 40)}px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Chi parla a chi (speakMatrix)</span>
          ${exportButton("speakMatrix", "speakMatrix")}
        </div>
        <div class="chart-container" id="speak-heatmap" style="height:${Math.max(220, (new Set(d.speakMatrix.map(e => e.from)).size + 1) * 26 + 80)}px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Response rate</span>
          ${exportButton("responseRate", "responseRate")}
        </div>
        <div class="event-list">
          ${topResponders.map((rr) => `
            <div class="event-row">
              <span class="event-type">${esc(rr.agentId)}</span>
              <span class="event-agent">${rr.speaksOut} speak</span>
              <span class="event-payload">${rr.repliesReceived} risposte &middot; ${(rr.rate * 100).toFixed(1)}%</span>
            </div>
          `).join("")}
          ${topResponders.length === 0 ? '<div class="empty-state"><div class="empty-state-text">Nessun speak diretto tracciato.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Lunghezza media messaggi</span></div>
        <div class="event-list">
          ${d.avgMessageChars.map((m) => `
            <div class="event-row">
              <span class="event-type">${esc(m.agentId)}</span>
              <span class="event-payload">avg ${m.avg.toFixed(1)} char &middot; σ ${m.stddev.toFixed(1)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderShockSubTab(r) {
    const s = r.shock;
    if (!s) {
      return `<div class="empty-state" style="padding:48px"><div class="empty-state-text">Nessun policy trigger registrato. Chiama recordPolicyTrigger(tick, desc) per attivare questa analisi.</div></div>`;
    }
    const rows = [
      { label: "Mood dominante", pre: s.pre.avgMood, post: s.post.avgMood, delta: s.deltas.moodChanged ? "cambiato" : "stabile" },
      { label: "Energia media", pre: s.pre.avgEnergy.toFixed(2), post: s.post.avgEnergy.toFixed(2), delta: formatDelta(s.deltas.avgEnergy) },
      { label: "Speak rate (/tick/agente)", pre: s.pre.speakRate.toFixed(3), post: s.post.speakRate.toFixed(3), delta: formatDelta(s.deltas.speakRate) },
      { label: "Violation rate (/tick)", pre: s.pre.violationRate.toFixed(3), post: s.post.violationRate.toFixed(3), delta: formatDelta(s.deltas.violationRate) },
      { label: "Tool call rate (/tick/agente)", pre: s.pre.toolCallRate.toFixed(3), post: s.post.toolCallRate.toFixed(3), delta: formatDelta(s.deltas.toolCallRate) },
    ];
    return `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-value">T${s.triggerTick}</div><div class="stat-label">Trigger tick</div></div>
        <div class="stat-card"><div class="stat-value">${s.windowTicks}</div><div class="stat-label">Finestra</div></div>
        <div class="stat-card"><div class="stat-value">${s.recoveryTicks == null ? "—" : s.recoveryTicks}</div><div class="stat-label">Recovery ticks</div></div>
      </div>
      ${s.description ? `<div class="section-subtitle">${esc(s.description)}</div>` : ""}
      <div class="card">
        <div class="card-header">
          <span class="card-title">Pre / Post trigger</span>
          ${exportButton("shock", "shock")}
        </div>
        <div class="event-list">
          ${rows.map((r) => `
            <div class="event-row">
              <span class="event-type">${esc(r.label)}</span>
              <span class="event-agent">pre ${esc(String(r.pre))}</span>
              <span class="event-payload">post ${esc(String(r.post))} &middot; Δ ${esc(String(r.delta))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderArchetypesSubTab(r) {
    const arch = r.archetypes;
    if (!arch || arch.perAgent.length === 0) {
      return `<div class="empty-state" style="padding:48px"><div class="empty-state-text">Nessun archetipo calcolato.</div></div>`;
    }
    const grouped = new Map();
    for (const a of arch.perAgent) {
      if (!grouped.has(a.archetype)) grouped.set(a.archetype, []);
      grouped.get(a.archetype).push(a);
    }
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Archetipi per agente</span>
          ${exportButton("archetypes", "archetypes")}
        </div>
        <div class="agent-report-grid">
          ${arch.perAgent.map((a) => `
            <div class="agent-report-card">
              <div class="agent-name">${esc(a.agentId)}</div>
              <div style="margin:6px 0 8px"><span class="badge">${esc(a.archetype)}</span> <span style="color:var(--text-muted)">score ${a.score.toFixed(2)}</span></div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${esc(a.rationale)}</div>
              <div class="agent-state">
                <div class="agent-state-item"><span class="agent-state-label">compliant:</span> ${a.subScores.compliant.toFixed(2)}</div>
                <div class="agent-state-item"><span class="agent-state-label">skeptic:</span> ${a.subScores.skeptic.toFixed(2)}</div>
                <div class="agent-state-item"><span class="agent-state-label">resistant:</span> ${a.subScores.resistant.toFixed(2)}</div>
                <div class="agent-state-item"><span class="agent-state-label">apathetic:</span> ${a.subScores.apathetic.toFixed(2)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Varianza del mood nel tempo</span>
          ${exportButton("moodVariance", "moodVariance")}
        </div>
        <div class="chart-container" id="mood-variance-chart" style="height:240px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Contagio emotivo (correlazione con vicini)</span>
        </div>
        <div class="chart-container" id="contagion-chart" style="height:240px"></div>
      </div>
    `;
  }

  function renderNarrativeSubTab(r) {
    const n = state.narrative;
    const quotes = n?.quotes || (n ? [] : []);
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Narrativa LLM</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" id="narrative-generate" ${!state.reportRunId ? "disabled" : ""}>${state.narrativeLoading ? "Generazione..." : (n ? "Rigenera" : "Genera narrativa")}</button>
          </div>
        </div>
        ${!state.reportRunId ? `<div class="empty-state"><div class="empty-state-text">Seleziona un mondo per generare la narrativa.</div></div>` : ""}
        ${n ? `
          <div class="event-list">
            ${n.arc.map((a) => `
              <div class="event-row">
                <span class="event-type">${esc(a.phase)}</span>
                <span class="event-payload">${esc(a.summary)}</span>
              </div>
            `).join("")}
          </div>
        ` : (state.reportRunId ? `<div class="empty-state"><div class="empty-state-text">Nessuna narrativa generata. Clicca "Genera narrativa".</div></div>` : "")}
      </div>

      ${n && n.perAgentArc?.length ? `
        <div class="card">
          <div class="card-header"><span class="card-title">Archi per agente</span></div>
          <div class="agent-report-grid">
            ${n.perAgentArc.map((p) => `
              <div class="agent-report-card">
                <div class="agent-name">${esc(p.agentId)}</div>
                <div style="font-size:13px;color:var(--text-muted)">${esc(p.arc)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${n && quotes.length ? `
        <div class="card">
          <div class="card-header"><span class="card-title">Citazioni emblematiche</span></div>
          <div class="event-list">
            ${quotes.map((q) => `
              <div class="event-row">
                <span class="event-tick">T${q.tick}</span>
                <span class="event-type">${esc(q.agentId)} · ${esc(q.tag)}</span>
                <span class="event-payload">"${esc(q.content)}"</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `;
  }

  function formatDelta(v) {
    const sign = v > 0 ? "+" : v < 0 ? "" : "";
    return `${sign}${v.toFixed(3)}`;
  }

  // ── Chart drawing ───────────────────────────────────────────────────
  const MOOD_COLORS = {
    neutral: "#8b949e",
    happy: "#3fb950", felice: "#3fb950", contento: "#3fb950",
    sad: "#6e7681", triste: "#6e7681",
    angry: "#f85149", arrabbiato: "#f85149", furioso: "#f85149",
    anxious: "#d29922", ansioso: "#d29922", preoccupato: "#d29922",
    excited: "#58a6ff", eccitato: "#58a6ff", entusiasta: "#58a6ff",
    frustrated: "#f0883e", frustrato: "#f0883e",
    calm: "#56d364", calmo: "#56d364", sereno: "#56d364",
    curious: "#bc8cff", curioso: "#bc8cff",
    worried: "#d29922", preoccupata: "#d29922",
    determined: "#58a6ff", determinato: "#58a6ff", determinata: "#58a6ff",
    hopeful: "#56d364", speranzoso: "#56d364",
    resigned: "#6e7681", rassegnato: "#6e7681",
    irritated: "#f0883e", irritato: "#f0883e", irritata: "#f0883e",
    thoughtful: "#bc8cff", riflessivo: "#bc8cff", riflessiva: "#bc8cff",
    optimistic: "#3fb950", ottimista: "#3fb950",
    pessimistic: "#6e7681", pessimista: "#6e7681",
  };

  function moodColor(mood) {
    const m = (mood || "neutral").toLowerCase();
    return MOOD_COLORS[m] || "#8b949e";
  }

  function drawMoodHeatmap() {
    const container = document.getElementById("mood-heatmap");
    if (!container || !state.report) return;

    const agents = state.report.agents.filter((a) => a.role !== "control");
    if (agents.length === 0) return;

    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    container.innerHTML = "";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const labelWidth = 120;
    const topMargin = 30;
    const cellH = Math.min(28, (canvas.height - topMargin - 10) / agents.length);
    const maxTick = state.report.summary.totalTicks;
    const chartW = canvas.width - labelWidth - 20;
    const cellW = Math.max(4, chartW / maxTick);

    // Header ticks
    ctx.fillStyle = "#8b949e";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    const tickStep = Math.max(1, Math.floor(maxTick / 15));
    for (let t = 0; t <= maxTick; t += tickStep) {
      ctx.fillText("T" + t, labelWidth + t * cellW + cellW / 2, topMargin - 8);
    }

    // Rows
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const y = topMargin + i * cellH;

      // Label
      ctx.fillStyle = "#e6edf3";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(a.name.length > 14 ? a.name.slice(0, 13) + "..." : a.name, labelWidth - 8, y + cellH / 2 + 4);

      // Cells
      const moodMap = new Map(a.moodTrajectory.map((s) => [s.tick, s.mood]));
      for (let t = 0; t < maxTick; t++) {
        const mood = moodMap.get(t + 1) || "neutral";
        ctx.fillStyle = moodColor(mood);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(labelWidth + t * cellW + 1, y + 1, cellW - 2, cellH - 2);
        ctx.globalAlpha = 1.0;
      }
    }
  }

  function drawEnergyChart() {
    const container = document.getElementById("energy-chart");
    if (!container || !state.report) return;

    const agents = state.report.agents.filter((a) => a.role !== "control");
    if (agents.length === 0) return;

    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    container.innerHTML = "";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const leftMargin = 50;
    const bottomMargin = 30;
    const topMargin = 20;
    const chartW = canvas.width - leftMargin - 20;
    const chartH = canvas.height - topMargin - bottomMargin;
    const maxTick = state.report.summary.totalTicks;

    // Axes
    ctx.strokeStyle = "#30363d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftMargin, topMargin);
    ctx.lineTo(leftMargin, topMargin + chartH);
    ctx.lineTo(leftMargin + chartW, topMargin + chartH);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = "#8b949e";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "right";
    for (let v = 0; v <= 100; v += 25) {
      const y = topMargin + chartH - (v / 100) * chartH;
      ctx.fillText(String(v), leftMargin - 6, y + 3);
      ctx.strokeStyle = "#21262d";
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(leftMargin + chartW, y);
      ctx.stroke();
    }

    // X-axis labels
    ctx.textAlign = "center";
    const tickStep = Math.max(1, Math.floor(maxTick / 10));
    for (let t = 0; t <= maxTick; t += tickStep) {
      const x = leftMargin + (t / maxTick) * chartW;
      ctx.fillText("T" + t, x, topMargin + chartH + 16);
    }

    // Lines per agent
    const lineColors = ["#58a6ff", "#3fb950", "#f0883e", "#bc8cff", "#f85149", "#d29922", "#56d364", "#8b949e", "#ff7b72", "#79c0ff"];
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const color = lineColors[i % lineColors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (const snap of a.energyTrajectory) {
        const x = leftMargin + ((snap.tick - 1) / maxTick) * chartW;
        const y = topMargin + chartH - (snap.energy / 100) * chartH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Legend dot
      const legendY = topMargin + 4 + i * 14;
      ctx.fillStyle = color;
      ctx.fillRect(leftMargin + chartW - 130, legendY, 8, 8);
      ctx.fillStyle = "#e6edf3";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(a.name.length > 12 ? a.name.slice(0, 11) + "..." : a.name, leftMargin + chartW - 118, legendY + 8);
    }
  }

  function drawActionBars() {
    const container = document.getElementById("action-bars");
    if (!container || !state.report) return;

    const agents = state.report.agents.filter((a) => a.role !== "control");
    if (agents.length === 0) return;

    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    container.innerHTML = "";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const leftMargin = 120;
    const rightMargin = 100;
    const topMargin = 20;
    const barH = Math.min(24, (canvas.height - topMargin - 10) / agents.length);
    const chartW = canvas.width - leftMargin - rightMargin;

    const categories = ["speak", "observe", "interact", "tool_call", "finish"];
    const catColors = { speak: "#58a6ff", observe: "#8b949e", interact: "#3fb950", tool_call: "#bc8cff", finish: "#6e7681" };
    const maxActions = Math.max(1, ...agents.map((a) => a.totalActions));

    // Legend
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "left";
    let legendX = leftMargin;
    for (const cat of categories) {
      ctx.fillStyle = catColors[cat];
      ctx.fillRect(legendX, 4, 10, 10);
      ctx.fillStyle = "#e6edf3";
      ctx.fillText(cat, legendX + 14, 13);
      legendX += ctx.measureText(cat).width + 28;
    }

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const y = topMargin + i * barH;

      // Label
      ctx.fillStyle = "#e6edf3";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(a.name.length > 14 ? a.name.slice(0, 13) + "..." : a.name, leftMargin - 8, y + barH / 2 + 4);

      // Stacked bar
      let x = leftMargin;
      for (const cat of categories) {
        const count = a.actions[cat] || 0;
        const w = (count / maxActions) * chartW;
        ctx.fillStyle = catColors[cat];
        ctx.fillRect(x, y + 2, w, barH - 4);
        x += w;
      }

      // Total
      ctx.fillStyle = "#8b949e";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(a.totalActions), x + 6, y + barH / 2 + 3);
    }
  }

  function renderStoreRequired(storeName, feature) {
    const cap = state.capabilities?.stores?.[storeName];
    return `
      <div class="section-title">${feature}</div>
      <div class="empty-state" style="padding:60px">
        <div class="empty-state-icon">&#x1F50C;</div>
        <div class="empty-state-text">This feature requires a ${storeName} store.</div>
        <div style="margin-top:16px">
          <button class="btn" data-nav="setup">View Setup Guide</button>
        </div>
      </div>
    `;
  }

  function renderSetup() {
    if (!state.capabilities) return "<div>Loading...</div>";
    const stores = state.capabilities.stores;

    return `
      <div class="section-title">Store Setup</div>
      <div class="section-subtitle">Connect external stores to unlock additional Studio features</div>
      ${Object.entries(stores).map(([name, info]) => `
        <div class="store-guide">
          <div class="store-guide-header">
            <span class="store-guide-title" style="text-transform:capitalize">${name} Store</span>
            <span class="store-guide-status ${info.connected ? "connected" : "disconnected"}">
              ${info.connected ? "Connected" : "Not Connected"}
            </span>
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">${esc(info.description)}</div>
          <div class="store-guide-enables">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px">Enables:</div>
            <ul>${info.enables.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          </div>
          ${!info.connected ? `<div class="code-block">${esc(info.guide)}</div>` : ""}
        </div>
      `).join("")}
    `;
  }

  // ── Event handlers ─────────────────────────────────────────────────
  function attachHandlers() {
    // Navigation
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        const page = el.getAttribute("data-nav");
        if (page) navigate(page);
      });
    });

    const worldSelector = document.getElementById("world-selector");
    if (worldSelector) {
      worldSelector.addEventListener("change", () => {
        const newWorldId = worldSelector.value || "";
        if (state.selectedWorldId) {
          socket.emit("unsubscribe:world", state.selectedWorldId);
        }
        state.selectedWorldId = newWorldId;
        if (state.selectedWorldId) {
          socket.emit("subscribe:world", state.selectedWorldId);
        }
        loadWorld();
        loadAgents();
        if (state.page === "events") loadEvents();
        if (state.page === "report") loadReport();
      });
    }

    // Agent detail click
    document.querySelectorAll("[data-agent-detail]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-agent-detail");
        if (id) navigate("agentDetail", id);
      });
    });

    // Event filters
    const filterApply = document.getElementById("filter-apply");
    if (filterApply) {
      filterApply.addEventListener("click", () => {
        state.eventTypeFilter = document.getElementById("filter-type")?.value || "";
        state.eventAgentFilter = document.getElementById("filter-agent")?.value || "";
        loadEvents();
      });
    }
    const filterClear = document.getElementById("filter-clear");
    if (filterClear) {
      filterClear.addEventListener("click", () => {
        state.eventTypeFilter = "";
        state.eventAgentFilter = "";
        loadEvents();
      });
    }

    // Scenario start buttons
    document.querySelectorAll("[data-start-scenario]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-start-scenario");
        if (id) startScenario(id);
      });
    });

    // Scenario file upload
    const dropzone = document.getElementById("scenario-dropzone");
    const fileInput = document.getElementById("scenario-file");
    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.style.borderColor = "var(--accent)"; });
      dropzone.addEventListener("dragleave", () => { dropzone.style.borderColor = ""; });
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.style.borderColor = "";
        const file = e.dataTransfer?.files?.[0];
        if (file) handleScenarioFile(file);
      });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) handleScenarioFile(file);
      });
    }

    // Report refresh & download
    const reportRefresh = document.getElementById("report-refresh");
    if (reportRefresh) {
      reportRefresh.addEventListener("click", loadReport);
    }
    const reportDownload = document.getElementById("report-download");
    if (reportDownload) {
      reportDownload.addEventListener("click", () => {
        if (!state.report) return;
        const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `worldsim-report-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    const topicsRefresh = document.getElementById("topics-refresh");
    if (topicsRefresh && state.selectedWorldId) {
      topicsRefresh.addEventListener("click", async () => {
        const live = await api(`/worlds/${encodeURIComponent(state.selectedWorldId)}/report/live`);
        if (!live?.runId) return;
        await fetch(`/api/reports/${encodeURIComponent(live.runId)}/topics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forceRefresh: true }),
        });
        await loadReport();
      });
    }

    document.querySelectorAll("[data-report-subtab]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-report-subtab");
        if (!id || state.reportSubTab === id) return;
        state.reportSubTab = id;
        render();
        setTimeout(() => {
          if (id === "overview") {
            drawMoodHeatmap();
            drawEnergyChart();
            drawActionBars();
          }
          if (id === "network") drawNetworkViews();
          if (id === "dialogue") drawDialogueViews();
          if (id === "archetypes") drawArchetypeViews();
        }, 50);
      });
    });

    const narrativeGen = document.getElementById("narrative-generate");
    if (narrativeGen && state.reportRunId) {
      narrativeGen.addEventListener("click", async () => {
        state.narrativeLoading = true;
        render();
        try {
          const res = await fetch(`/api/reports/${encodeURIComponent(state.reportRunId)}/narrative`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ forceRefresh: !!state.narrative }),
          });
          const data = await res.json();
          state.narrative = data?.narrative || null;
        } catch {
          state.narrative = null;
        } finally {
          state.narrativeLoading = false;
          render();
        }
      });
    }

    const worldsRefresh = document.getElementById("worlds-refresh");
    if (worldsRefresh) {
      worldsRefresh.addEventListener("click", loadWorlds);
    }
    const compareClear = document.getElementById("compare-clear");
    if (compareClear) {
      compareClear.addEventListener("click", () => {
        state.selectedCompareRuns = [];
        state.compare = null;
        render();
      });
    }
    document.querySelectorAll("[data-compare-run]").forEach((el) => {
      el.addEventListener("click", async () => {
        const runId = el.getAttribute("data-compare-run");
        if (!runId) return;
        if (!state.selectedCompareRuns.includes(runId)) {
          state.selectedCompareRuns.push(runId);
        }
        if (state.selectedCompareRuns.length > 2) {
          state.selectedCompareRuns.shift();
        }
        if (state.selectedCompareRuns.length === 2) {
          const data = await api(`/reports/compare?runId=${encodeURIComponent(state.selectedCompareRuns.join(","))}`);
          if (!data.error) state.compare = data;
        }
        render();
      });
    });

    // Search
    const searchBtn = document.getElementById("search-btn");
    if (searchBtn) {
      searchBtn.addEventListener("click", doSearch);
    }

    // Load conversations if on that page
    if (state.page === "conversations") loadConversations();
  }

  async function doSearch() {
    const query = document.getElementById("search-query")?.value;
    const agentId = document.getElementById("search-agent")?.value;
    const container = document.getElementById("search-results");
    if (!query || !container) return;

    container.innerHTML = "<div>Searching...</div>";
    try {
      const data = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, agentId: agentId || undefined, worldId: state.selectedWorldId || undefined, topK: 20 }),
      }).then((r) => r.json());

      if (data.error) {
        container.innerHTML = `<div class="card">${esc(data.error)}</div>`;
        return;
      }

      container.innerHTML = (data.results || []).map((r) => `
        <div class="memory-item" style="border-color:var(--accent)">
          <div class="memory-meta">Agent: ${esc(r.agentId)} &middot; Score: ${r.score.toFixed(3)}</div>
          <div class="memory-content">${esc(r.content)}</div>
        </div>
      `).join("") || '<div class="empty-state"><div class="empty-state-text">No results found.</div></div>';
    } catch (err) {
      container.innerHTML = `<div class="card">Search failed: ${esc(err.message)}</div>`;
    }
  }

  async function loadConversations() {
    const container = document.getElementById("conversations-container");
    if (!container) return;

    try {
      const data = await api(withWorld("/conversations?limit=100"));
      const convs = data.conversations || [];

      if (convs.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No conversations recorded.</div></div>';
        return;
      }

      container.innerHTML = convs.map((c) => `
        <div class="conversation-item from-left">
          <div class="conversation-meta">${esc(c.fromAgentId)} &rarr; ${esc(c.toAgentId || "broadcast")} &middot; Tick ${c.tick}</div>
          <div>${esc(c.content)}</div>
        </div>
      `).join("");
    } catch (err) {
      container.innerHTML = `<div class="card">Failed to load: ${esc(err.message)}</div>`;
    }
  }

  function handleScenarioFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const scenario = JSON.parse(reader.result);
        const preview = document.getElementById("scenario-preview");
        if (preview) {
          preview.innerHTML = `
            <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius);border:1px solid var(--border)">
              <div style="font-weight:600;margin-bottom:8px">${esc(scenario.name || "Custom Scenario")}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">${esc(scenario.description || "")}</div>
              <div style="font-size:12px;color:var(--text-muted)">
                Agents: ${scenario.agents?.length ?? 0} &middot; Ticks: ${scenario.maxTicks ?? "?"}
              </div>
              <button class="btn" style="margin-top:12px" id="start-custom-scenario">Start Simulation</button>
            </div>
          `;
          document.getElementById("start-custom-scenario")?.addEventListener("click", () => {
            startCustomScenario(scenario);
          });
        }
      } catch {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  // ── Sociological analysis rendering ────────────────────────────────
  function drawNetworkViews() {
    const net = state.report?.network;
    if (!net) return;
    drawLineSeries("density-chart", net.density.map((p) => ({ x: p.tick, y: p.value })), {
      label: "density",
      yFormatter: (v) => (v * 100).toFixed(1) + "%",
    });
  }

  function drawDialogueViews() {
    const d = state.report?.dialogue;
    if (!d) return;
    drawBars("voice-chart", d.voiceByAgent.map((v) => ({ label: v.agentId, value: v.speaks })));
    drawMatrixHeatmap("speak-heatmap", d.speakMatrix);
  }

  function drawArchetypeViews() {
    const arch = state.report?.archetypes;
    if (!arch) return;
    drawLineSeries("mood-variance-chart", arch.moodVarianceByTick.map((p) => ({ x: p.tick, y: p.variance })), { label: "variance" });
    drawLineSeries("contagion-chart", arch.emotionalContagion.map((p) => ({ x: p.tick, y: p.correlationNeighbors })), { label: "r", yRange: [-1, 1] });
  }

  function drawLineSeries(elementId, points, opts = {}) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (!points || points.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Dati non disponibili.</div></div>';
      return;
    }
    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width);
    canvas.height = Math.max(160, rect.height);
    container.innerHTML = "";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const padding = { top: 20, right: 20, bottom: 28, left: 48 };
    const chartW = canvas.width - padding.left - padding.right;
    const chartH = canvas.height - padding.top - padding.bottom;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yRange = opts.yRange || [Math.min(0, ...ys), Math.max(0.0001, ...ys)];
    const yMin = yRange[0];
    const yMax = yRange[1];

    ctx.strokeStyle = "#30363d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    ctx.fillStyle = "#8b949e";
    ctx.font = "11px monospace";
    const fmt = opts.yFormatter || ((v) => v.toFixed(2));
    ctx.fillText(fmt(yMax), 4, padding.top + 8);
    ctx.fillText(fmt(yMin), 4, padding.top + chartH);
    ctx.fillText("t=" + xMin, padding.left, canvas.height - 6);
    ctx.fillText("t=" + xMax, padding.left + chartW - 30, canvas.height - 6);

    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = padding.left + (xMax === xMin ? 0 : ((p.x - xMin) / (xMax - xMin)) * chartW);
      const py = padding.top + chartH - ((p.y - yMin) / (yMax - yMin || 1)) * chartH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  function drawBars(elementId, items) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Nessun dato.</div></div>';
      return;
    }
    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width);
    canvas.height = Math.max(160, rect.height);
    container.innerHTML = "";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const labelWidth = 140;
    const max = Math.max(1, ...items.map((i) => i.value));
    const rowH = Math.min(24, (canvas.height - 20) / items.length);
    items.forEach((item, i) => {
      const y = 10 + i * rowH;
      ctx.fillStyle = "#c9d1d9";
      ctx.font = "12px monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(item.label.slice(0, 18), 6, y + rowH / 2);
      const barW = ((canvas.width - labelWidth - 40) * item.value) / max;
      ctx.fillStyle = "#58a6ff";
      ctx.fillRect(labelWidth, y + 2, Math.max(0, barW), rowH - 4);
      ctx.fillStyle = "#8b949e";
      ctx.fillText(String(item.value), labelWidth + barW + 6, y + rowH / 2);
    });
  }

  function drawMatrixHeatmap(elementId, edges) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (!edges || edges.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Nessun messaggio.</div></div>';
      return;
    }
    const froms = [...new Set(edges.map((e) => e.from))].sort();
    const tos = [...new Set(edges.map((e) => e.to))].sort();
    const counts = new Map();
    let maxCount = 0;
    for (const e of edges) {
      counts.set(`${e.from}|${e.to}`, e.count);
      if (e.count > maxCount) maxCount = e.count;
    }

    const canvas = document.createElement("canvas");
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width);
    canvas.height = Math.max(200, rect.height);
    container.innerHTML = "";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const leftLabel = 120;
    const topLabel = 70;
    const cellW = Math.max(24, (canvas.width - leftLabel - 16) / tos.length);
    const cellH = Math.max(22, (canvas.height - topLabel - 10) / froms.length);

    ctx.font = "11px monospace";
    ctx.fillStyle = "#8b949e";
    for (let i = 0; i < tos.length; i++) {
      const x = leftLabel + i * cellW + cellW / 2;
      ctx.save();
      ctx.translate(x, topLabel - 6);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText((tos[i] || "").slice(0, 10), 0, 0);
      ctx.restore();
    }
    ctx.fillStyle = "#c9d1d9";
    for (let i = 0; i < froms.length; i++) {
      ctx.fillText((froms[i] || "").slice(0, 12), 6, topLabel + i * cellH + cellH / 2 + 4);
    }

    for (let i = 0; i < froms.length; i++) {
      for (let j = 0; j < tos.length; j++) {
        const c = counts.get(`${froms[i]}|${tos[j]}`) || 0;
        const intensity = c === 0 ? 0 : Math.min(1, c / maxCount);
        ctx.fillStyle = intensity === 0
          ? "#161b22"
          : `rgba(88,166,255,${0.15 + intensity * 0.8})`;
        ctx.fillRect(leftLabel + j * cellW + 2, topLabel + i * cellH + 2, cellW - 4, cellH - 4);
        if (c > 0) {
          ctx.fillStyle = intensity > 0.5 ? "#0d1117" : "#c9d1d9";
          ctx.fillText(String(c), leftLabel + j * cellW + cellW / 2 - 4, topLabel + i * cellH + cellH / 2 + 4);
        }
      }
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────
  function computeTopTools(report) {
    const map = new Map();
    const actions = report?.rawActions || [];
    for (const action of actions) {
      if (action.actionType !== "tool_call") continue;
      const payload = action.payload || {};
      const results = Array.isArray(payload.toolResults) ? payload.toolResults : [];
      if (results.length === 0) {
        const fallback = "unknown_tool";
        map.set(fallback, (map.get(fallback) || 0) + 1);
      }
      for (const result of results) {
        const name = result?.toolName || result?.name || "unknown_tool";
        map.set(name, (map.get(name) || 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Init ───────────────────────────────────────────────────────────
  loadCapabilities();
  loadWorlds();
  loadWorld();
  loadAgents();
  loadTuning();
  setInterval(() => {
    if (state.page === "report") loadReport();
    if (state.page === "worlds") loadWorlds();
    if (state.page === "dashboard") loadTuning();
  }, 5000);
  render();
})();
