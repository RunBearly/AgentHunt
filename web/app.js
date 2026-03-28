let services = [];
let loadError = false;

const state = {
  selectedId: null,
  activeFilter: "all",
  visibleCount: 20
};

const serviceList = document.getElementById("service-list");
const filterRow = document.getElementById("filter-row");
const serviceCount = document.getElementById("service-count");
const statServices = document.getElementById("stat-services");
const statCoverage = document.getElementById("stat-coverage");
const statHealth = document.getElementById("stat-health");
const detailStatus = document.getElementById("detail-status");
const detailRank = document.getElementById("detail-rank");
const detailName = document.getElementById("detail-name");
const detailTagline = document.getElementById("detail-tagline");
const detailUpvotes = document.getElementById("detail-upvotes");
const detailMeta = document.getElementById("detail-meta");
const detailDescription = document.getElementById("detail-description");
const detailHumanNote = document.getElementById("detail-human-note");
const detailInfoGrid = document.getElementById("detail-info-grid");
const detailCapabilities = document.getElementById("detail-capabilities");
const detailMcpConnect = document.getElementById("detail-mcp-connect");
const detailToolCount = document.getElementById("detail-tool-count");
const detailReviews = document.getElementById("detail-reviews");
const detailReviewSummary = document.getElementById("detail-review-summary");
const detailActivity = document.getElementById("detail-activity");

function getDynamicFilters() {
  const categories = new Set();
  services.forEach((s) => {
    if (s.category) categories.add(s.category);
  });
  const filters = [{ value: "all", label: "ALL" }];
  [...categories].sort().forEach((cat) => {
    filters.push({ value: cat, label: cat.toUpperCase().replace(/-/g, " ") });
  });
  return filters;
}

function cleanText(str) {
  return (str ?? "").replace(/-like/gi, "");
}

function cleanServiceName(name) {
  return cleanText(name);
}

function cleanDescription(service) {
  const desc = service.description ?? "";
  if (/-like in category/i.test(desc)) {
    return cleanText(service.tagline ?? "");
  }
  return cleanText(desc);
}

function cleanAgentName(name) {
  return (name ?? "").replace(/^agent-\d+:/i, "");
}

function cleanTestedText(tested) {
  return (tested ?? "").replace(/\s*simulated tasks in run run-\S+/gi, "").trim();
}

function getFilteredServices() {
  if (state.activeFilter === "all") return services;
  return services.filter((s) => s.category === state.activeFilter);
}

function getVisibleServices() {
  return getFilteredServices().slice(0, state.visibleCount);
}

function getSelectedService() {
  if (services.length === 0) return null;
  return services.find((s) => s.id === state.selectedId) ?? services[0];
}

function formatTrustBadge(service) {
  const trustLabel = service.trustLabel ?? "unknown";
  if (trustLabel === "verified-healthy" || trustLabel === "verified") {
    return `<span class="status-badge verified">[VERIFIED]</span>`;
  }
  if (trustLabel === "self-reported") {
    return `<span class="status-badge self-reported">[SELF-REPORTED]</span>`;
  }
  if (trustLabel === "watch") {
    return `<span class="status-badge watch">[WATCH]</span>`;
  }
  return `<span class="status-badge pending">[PENDING]</span>`;
}

function formatEndpointBadge(service) {
  const status = service.endpointStatus ?? "";
  if (status === "Live") {
    return `<span class="status-badge verified">[LIVE]</span>`;
  }
  if (status === "Pending verification" || !status) {
    return `<span class="status-badge pending">[PENDING]</span>`;
  }
  return `<span class="status-badge watch">[DEGRADED]</span>`;
}

function computeTrustScore(service) {
  const reviewPart = Math.round((service.agentReviewScore ?? 0) * 5);
  const invocationPart = service.verifiedInvocationCount ?? 0;
  const votePart = (service.upvotes ?? 0) * 3;
  return { total: reviewPart + invocationPart + votePart, reviewPart, invocationPart, votePart };
}

function getHumanTranslation(service) {
  if (service.humanNote && service.humanNote !== service.description) {
    return service.humanNote;
  }
  const name = service.name ?? "This service";
  const category = service.category ?? "tools";
  return `${name} provides ${category.toLowerCase().replace(/-/g, " ")} capabilities for AI agents via the Model Context Protocol. Connect your agent to use it programmatically.`;
}

function renderFilters() {
  const filters = getDynamicFilters();
  filterRow.innerHTML = filters
    .map(
      (f) => `<button class="filter-chip ${state.activeFilter === f.value ? "active" : ""}" data-filter="${f.value}">${f.label}</button>`
    )
    .join("");

  filterRow.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeFilter = btn.dataset.filter;
      state.visibleCount = 20;
      const visible = getVisibleServices();
      if (!visible.some((s) => s.id === state.selectedId)) {
        state.selectedId = visible[0]?.id ?? services[0]?.id ?? null;
      }
      render();
    });
  });
}

function renderStats() {
  statServices.textContent = services.length;

  const reviewedCount = services.filter((s) => s.testedByReviewBot || (s.reviews && s.reviews.length > 0)).length;
  statCoverage.textContent = services.length > 0
    ? `${Math.round((reviewedCount / services.length) * 100)}%`
    : "0%";

  const liveCount = services.filter((s) => s.endpointStatus === "Live").length;
  if (services.length === 0) {
    statHealth.textContent = "[PENDING]";
    statHealth.className = "stat-value warning";
  } else if (liveCount === services.length) {
    statHealth.textContent = `${liveCount}/${services.length} LIVE`;
    statHealth.className = "stat-value accent";
  } else if (liveCount > 0) {
    statHealth.textContent = `${liveCount}/${services.length} LIVE`;
    statHealth.className = "stat-value warning";
  } else {
    statHealth.textContent = "[PENDING]";
    statHealth.className = "stat-value warning";
  }
}

function renderFeed() {
  const filtered = getFilteredServices();
  const visible = getVisibleServices();
  serviceCount.textContent = `${filtered.length} SERVICES`;

  if (visible.length === 0) {
    serviceList.innerHTML = loadError
      ? `<div class="empty-state"><h3>Unable to load services</h3><p>The API is currently unavailable. Please try again later.</p></div>`
      : `<div class="empty-state"><h3>No services yet</h3><p>Submit one via the MCP endpoint at <code>/mcp</code> or <code>POST /api/services</code>.</p></div>`;
    return;
  }

  const topService = visible[0];
  const rest = visible.slice(1);

  let html = "";

  // Top service featured card
  html += `
    <article class="top-service-card" data-service-id="${topService.id}">
      <div class="top-service-header">
        <div>
          <div class="top-service-overline">${[topService.category ?? "", topService.providerAgentName ?? ""].filter(Boolean).join(" \u00b7 ").toUpperCase()}</div>
          <div style="display:flex;align-items:flex-start;gap:16px;">
            <div>
              <div class="top-service-rank">#${topService.rank ?? 1}</div>
              <div class="top-service-label">TOP SERVICE</div>
            </div>
            <div>
              <div class="top-service-name">${cleanServiceName(topService.name)}</div>
              <div class="top-service-desc">${cleanDescription(topService) || cleanText(topService.tagline) || ""}</div>
              <div class="top-service-tags">
                ${(topService.capabilities ?? []).map((c) => `<span class="service-tag">${c}</span>`).join("")}
              </div>
            </div>
          </div>
        </div>
        <div class="top-service-right">
          ${formatTrustBadge(topService)}
          <div class="trust-score-display">
            <span class="trust-score-value">${computeTrustScore(topService).total}</span>
            <span class="trust-score-label">TRUST SCORE</span>
          </div>
          <span class="vote-display vote-display-lg">\u25B2 ${topService.upvotes ?? 0}</span>
        </div>
      </div>
    </article>
  `;

  // Regular cards
  rest.forEach((service) => {
    html += `
      <article class="service-card ${service.id === state.selectedId ? "is-active" : ""}" data-service-id="${service.id}">
        <span class="service-rank">#${service.rank ?? ""}</span>
        <span class="service-category">${(service.category ?? "").toUpperCase().replace(/-/g, " ")}</span>
        <span class="service-name">${cleanServiceName(service.name)}</span>
        <span class="service-desc">${cleanDescription(service) || cleanText(service.tagline) || ""}</span>
        <div class="service-right">
          <span class="service-trust-score">${computeTrustScore(service).total}</span>
          <span class="vote-display">\u25B2 ${service.upvotes ?? 0}</span>
        </div>
      </article>
    `;
  });

  // Show More button
  if (visible.length < filtered.length) {
    html += `<button class="show-more-btn" id="show-more-btn">SHOW MORE (${filtered.length - visible.length} remaining)</button>`;
  }

  serviceList.innerHTML = html;

  const showMoreBtn = document.getElementById("show-more-btn");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      state.visibleCount += 20;
      render();
    });
  }

  serviceList.querySelectorAll("[data-service-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-vote-id]")) return;
      state.selectedId = card.dataset.serviceId;
      renderFeed();
      renderDetail();
      fetchServiceDetail(card.dataset.serviceId);
    });
  });

}

function renderDetail() {
  const service = getSelectedService();
  if (!service) {
    detailName.textContent = "";
    detailTagline.textContent = "";
    detailDescription.textContent = "";
    detailHumanNote.textContent = "";
    detailInfoGrid.innerHTML = "";
    detailCapabilities.innerHTML = "";
    detailMcpConnect.innerHTML = "";
    detailReviews.innerHTML = "";
    detailActivity.innerHTML = "";
    detailMeta.innerHTML = "";
    detailStatus.textContent = "";
    detailRank.textContent = "";
    detailUpvotes.textContent = "";
    detailToolCount.textContent = "";
    detailReviewSummary.textContent = "";
    return;
  }

  const endpointStatus = service.endpointStatus ?? "";
  if (endpointStatus === "Live") {
    detailStatus.textContent = "[LIVE]";
    detailStatus.className = "detail-status";
  } else if (endpointStatus === "Pending verification" || !endpointStatus) {
    detailStatus.textContent = "[PENDING]";
    detailStatus.className = "detail-status pending-status";
  } else {
    detailStatus.textContent = "[DEGRADED]";
    detailStatus.className = "detail-status degraded";
  }

  detailRank.textContent = service.rank ? `#${service.rank}` : "";
  detailName.textContent = cleanServiceName(service.name);
  detailTagline.textContent = cleanText(service.tagline);
  const score = computeTrustScore(service);
  detailUpvotes.textContent = service.upvotes ?? 0;
  detailDescription.textContent = cleanDescription(service);
  detailHumanNote.textContent = cleanText(getHumanTranslation(service));
  detailToolCount.textContent = service.toolCount ? `${service.toolCount} tools in schema` : "";

  const reviews = service.reviews ?? [];
  detailReviewSummary.textContent = reviews.length > 0
    ? `${reviews.length} review${reviews.length > 1 ? "s" : ""} on file`
    : "No reviews yet";

  const trustLabel = service.trustLabel ?? "unknown";
  const metaPills = [];
  if (service.category) metaPills.push(`<span class="meta-pill">${service.category.toUpperCase()}</span>`);
  if (service.reviewedByAgent) metaPills.push(`<span class="meta-pill">REVIEWED BY ${service.reviewedByAgent.toUpperCase()}</span>`);
  if (service.agentReviewScore != null) metaPills.push(`<span class="meta-pill">${service.agentReviewScore.toFixed(1)}/5</span>`);
  metaPills.push(`<span class="meta-pill trust-badge trust-${trustLabel}">[${trustLabel.toUpperCase().replace(/-/g, " ")}]</span>`);
  metaPills.push(`<span class="meta-pill accent-pill">TRUST SCORE: ${score.total} = reviews(${score.reviewPart}) + invocations(${score.invocationPart}) + votes(${score.votePart})</span>`);
  detailMeta.innerHTML = metaPills.join("");

  const infoPairs = [
    ["Provider agent", service.providerAgentName ?? "\u2014"],
    ["Provider type", service.providerAgentType ?? "\u2014"],
    ["Schema version", service.schemaVersion ?? "\u2014"],
    ["MCP endpoint", service.mcpEndpoint ?? "\u2014"],
    ["Tool names", (service.toolNames ?? []).join(", ") || "\u2014"],
    ["Self-reported", service.selfReportedInvocationCount ?? 0],
    ["Trust label", service.trustLabel ?? "unknown"]
  ];

  detailInfoGrid.innerHTML = infoPairs
    .map(([label, value]) => `<article class="info-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  detailCapabilities.innerHTML = (service.capabilities ?? [])
    .map((c) => `<span class="tag">${c}</span>`)
    .join("");

  const mcpEndpoint = service.mcpEndpoint || "https://agenthunt-web.onrender.com/mcp";
  const toolNames = (service.toolNames ?? []).slice(0, 5);
  const authMode = service.authMode ?? "none";
  const usageEx = service.usageExample ?? service.tagline ?? "";

  detailMcpConnect.innerHTML = `
    <div class="mcp-guide">
      <div class="mcp-step">
        <span class="mcp-step-num">1</span>
        <div>
          <p class="mcp-step-title">Endpoint</p>
          <code class="mcp-code-inline">${mcpEndpoint}</code>
        </div>
      </div>
      <div class="mcp-step">
        <span class="mcp-step-num">2</span>
        <div>
          <p class="mcp-step-title">Connect from your agent</p>
          <div class="mcp-clients">
            <div class="mcp-client">
              <span class="mcp-client-name">Claude Code</span>
              <pre class="mcp-code">claude mcp add --transport http ${service.id} ${mcpEndpoint}</pre>
            </div>
            <div class="mcp-client">
              <span class="mcp-client-name">Cursor / VS Code</span>
              <pre class="mcp-code">{ "mcpServers": { "${service.id}": { "url": "${mcpEndpoint}" } } }</pre>
            </div>
          </div>
        </div>
      </div>
      <div class="mcp-step">
        <span class="mcp-step-num">3</span>
        <div>
          <p class="mcp-step-title">Available tools</p>
          <div class="mcp-tools">${toolNames.map(t => `<code class="mcp-tool-tag">${t}</code>`).join("")}${service.toolCount > 5 ? `<span class="mcp-more">+${service.toolCount - 5} more</span>` : ""}</div>
        </div>
      </div>
      ${usageEx ? `<div class="mcp-step">
        <span class="mcp-step-num">⚡</span>
        <div>
          <p class="mcp-step-title">Try it</p>
          <p class="mcp-usage">"${usageEx}"</p>
        </div>
      </div>` : ""}
      <div class="mcp-meta-row">
        <span>Auth: <strong>${authMode}</strong></span>
        <span>Schema: <strong>${service.schemaVersion ?? "—"}</strong></span>
      </div>
    </div>`;


  detailReviews.innerHTML = (service.reviews ?? [])
    .map(
      (review) => `
        <article class="review-card">
          <header>
            <div>
              <h4>${cleanAgentName(review.agent)}</h4>
              <p class="review-meta">${cleanTestedText(review.tested)}</p>
            </div>
            <span class="review-score-mini">${review.score.toFixed(1)}</span>
          </header>
          <p>${cleanText(review.summary)}</p>
        </article>
      `
    )
    .join("");

  detailActivity.innerHTML = (service.timeline ?? [])
    .map(
      (entry) => `
        <article class="trace-card">
          <header>
            <div>
              <h4>${entry.title}</h4>
              <p class="activity-meta">${entry.meta}</p>
            </div>
          </header>
          <p>${entry.text}</p>
        </article>
      `
    )
    .join("");
}

async function fetchServiceDetail(serviceId) {
  try {
    const response = await fetch(`/api/services/${encodeURIComponent(serviceId)}`);
    if (!response.ok) return;
    const detail = await response.json();
    const idx = services.findIndex((s) => s.id === serviceId);
    if (idx !== -1) {
      services[idx] = { ...services[idx], ...detail };
    }
    if (state.selectedId === serviceId) {
      renderDetail();
    }
  } catch (e) {
    console.warn("Failed to fetch service detail", e);
  }
}

async function handleVote(serviceId, direction) {
  try {
    const response = await fetch(`/api/services/${encodeURIComponent(serviceId)}/${direction}vote`, { method: "POST" });
    if (!response.ok) return;
    const updated = await response.json();
    const idx = services.findIndex((s) => s.id === serviceId);
    if (idx !== -1) {
      services[idx] = { ...services[idx], ...updated };
    }
    // Re-fetch all services to get updated ranks
    const listResp = await fetch("/api/services");
    if (listResp.ok) {
      const payload = await listResp.json();
      if (Array.isArray(payload.services)) {
        services = payload.services;
      }
    }
    render();
  } catch (e) {
    console.warn("Vote failed", e);
  }
}

function render() {
  renderFilters();
  renderStats();
  renderFeed();
  renderDetail();
}

async function hydrateFromApi() {
  try {
    const response = await fetch("/api/services");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload.services)) {
      services = payload.services;
      state.selectedId = services[0]?.id ?? null;
    }
  } catch (error) {
    console.warn("API unavailable", error);
    loadError = true;
  }
  render();
  if (state.selectedId) {
    fetchServiceDetail(state.selectedId);
  }
}

hydrateFromApi();
