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
    if (state.world) {
      state.world.tick = data.tick;
      state.world.activeAgents = data.activeAgents;
    }
    render();
  });

  socket.on("world:status", (data) => {
    if (state.world) state.world.status = data.status;
    render();
  });

  socket.on("agent:action", (data) => {
    state.events.unshift({
      type: "agent:action:" + data.action.actionType,
      tick: data.tick,
      agentId: data.agentId,
      agentName: data.agentName,
      payload: data.action.payload,
      timestamp: data.timestamp,
    });
    if (state.events.length > 500) state.events.length = 500;
    if (state.page === "events") render();
  });

  socket.on("agent:status", (data) => {
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
    });
    if (state.events.length > 500) state.events.length = 500;
    render();
  });

  // ── API helpers ────────────────────────────────────────────────────
  async function api(path, options) {
    const res = await fetch("/api" + path, options);
    return res.json();
  }

  async function loadCapabilities() {
    state.capabilities = await api("/stores");
    render();
  }

  async function loadEvents() {
    const params = new URLSearchParams({ limit: "200" });
    if (state.eventTypeFilter) params.set("type", state.eventTypeFilter);
    if (state.eventAgentFilter) params.set("agent", state.eventAgentFilter);
    const data = await api("/events?" + params);
    state.events = data.events || [];
    render();
  }

  async function loadWorld() {
    const data = await api("/world");
    if (!data.error) {
      state.world = data;
    }
    render();
  }

  async function loadAgents() {
    const data = await api("/agents");
    if (data.agents) state.agents = data.agents;
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
    if (page === "scenarios") loadScenarios();
    if (page === "agentDetail") loadAgentDetail(detail);
  }

  // ── Graph loading ──────────────────────────────────────────────────
  async function loadGraph() {
    if (!state.capabilities?.stores?.graph?.connected) return;
    const data = await api("/graph");
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

  async function loadAgentDetail(id) {
    agentDetail = await api("/agents/" + id);

    if (state.capabilities?.stores?.memory?.connected) {
      const memData = await api("/agents/" + id + "/memories?limit=50");
      agentMemories = memData.memories || [];
    } else {
      agentMemories = null;
    }

    if (state.capabilities?.stores?.graph?.connected) {
      const relData = await api("/agents/" + id + "/relationships");
      agentRelationships = relData.relationships || [];
    } else {
      agentRelationships = null;
    }

    if (state.capabilities?.stores?.persistence?.connected) {
      const snapData = await api("/agents/" + id + "/snapshots?limit=10");
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
          ${navItem("conversations", "Conversations", !hasPersistence)}
          ${navItem("search", "Semantic Search", !hasVector)}
          ${navItem("setup", "Store Setup")}
        </div>
        <div class="sidebar-status">
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
        <span class="event-tick">T${event.tick}</span>
        <span class="event-type">${esc(event.type)}</span>
        <span class="event-agent">${esc(event.agentName || event.agentId || "—")}</span>
        <span class="event-payload">${esc(payload)}</span>
      </div>
    `;
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
      const data = await api("/report");
      if (data.ready === false) {
        state.report = null;
      } else {
        state.report = data;
      }
    } catch {
      state.report = null;
    }
    render();
    if (state.report) {
      setTimeout(() => {
        drawMoodHeatmap();
        drawEnergyChart();
        drawActionBars();
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

    return `
      <div class="section-title">Simulation Report</div>
      <div class="section-subtitle">${esc(s.worldId)} &middot; ${(s.durationMs / 1000).toFixed(1)}s</div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${s.totalTicks}</div>
          <div class="stat-label">Ticks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${s.agentCount}</div>
          <div class="stat-label">Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${s.totalActions}</div>
          <div class="stat-label">Actions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${r.metrics.totalSpeaks}</div>
          <div class="stat-label">Speaks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${r.metrics.ruleViolations}</div>
          <div class="stat-label">Violations</div>
        </div>
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
          <span class="card-title">Timeline</span>
          <span class="badge">${r.timeline.length} events</span>
        </div>
        <div class="report-timeline">
          ${r.timeline.slice(0, 100).map((t) => `
            <div class="timeline-entry timeline-${t.type}">
              <span class="event-tick">T${t.tick}</span>
              <span class="timeline-desc">${esc(t.description)}</span>
            </div>
          `).join("")}
          ${r.timeline.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No timeline events.</div></div>' : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Per-Agent Summary</span>
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
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
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

    // Report refresh
    const reportRefresh = document.getElementById("report-refresh");
    if (reportRefresh) {
      reportRefresh.addEventListener("click", loadReport);
    }

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
        body: JSON.stringify({ query, agentId: agentId || undefined, topK: 20 }),
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
      const data = await api("/conversations?limit=100");
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

  // ── Utilities ──────────────────────────────────────────────────────
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
  loadWorld();
  loadAgents();
  render();
})();
