let services = [];
let loadError = false;

const filters = [
  { value: "all", label: "All launches" },
  { value: "orchestration", label: "Orchestration" },
  { value: "documents", label: "Documents" },
  { value: "communication", label: "Comms" },
  { value: "testing", label: "Testing" },
  { value: "developer-tools", label: "Dev tools" },
  { value: "memory", label: "Memory" }
];

const state = {
  selectedId: null,
  activeFilter: "all"
};

const serviceList = document.getElementById("service-list");
const filterRow = document.getElementById("filter-row");
const categoryList = document.getElementById("category-list");
const reviewDesk = document.getElementById("review-desk");
const activityList = document.getElementById("activity-list");
const leaderName = document.getElementById("leader-name");
const reviewCoverage = document.getElementById("review-coverage");
const avgLatency = document.getElementById("avg-latency");
const liveEndpoints = document.getElementById("live-endpoints");
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
const detailProtocol = document.getElementById("detail-protocol");
const detailUsageExample = document.getElementById("detail-usage-example");
const detailToolCount = document.getElementById("detail-tool-count");
const detailReviews = document.getElementById("detail-reviews");
const detailReviewSummary = document.getElementById("detail-review-summary");
const detailActivity = document.getElementById("detail-activity");

function getVisibleServices() {
  if (state.activeFilter === "all") {
    return services;
  }

  return services.filter((service) => service.category === state.activeFilter);
}

function getSelectedService() {
  if (services.length === 0) return null;
  return services.find((service) => service.id === state.selectedId) ?? services[0];
}

function formatScore(score) {
  return `${score.toFixed(1)}/5`;
}

function renderFilters() {
  filterRow.innerHTML = filters
    .map(
      (filter) => `
        <button class="filter-chip ${state.activeFilter === filter.value ? "active" : ""}" data-filter="${filter.value}">
          ${filter.label}
        </button>
      `
    )
    .join("");

  filterRow.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter;
      const visible = getVisibleServices();

      if (!visible.some((service) => service.id === state.selectedId)) {
        state.selectedId = visible[0]?.id ?? services[0]?.id ?? null;
      }

      render();
    });
  });
}

function renderOverview() {
  if (services.length === 0) {
    leaderName.textContent = "—";
    reviewCoverage.textContent = "—";
    avgLatency.textContent = "—";
    liveEndpoints.textContent = "0/0 live";
    return;
  }
  const visible = getVisibleServices();
  const leader = visible[0] ?? services[0];
  const reviewedCount = services.filter((service) => service.testedByReviewBot).length;

  leaderName.textContent = leader.name;
  reviewCoverage.textContent = `${Math.round((reviewedCount / services.length) * 100)}%`;
  avgLatency.textContent = `${Math.round(
    services.reduce((total, service) => total + (service.latencyMs ?? 0), 0) / services.length
  )} ms`;
  liveEndpoints.textContent = `${services.filter((service) => service.endpointStatus === "Live").length}/${services.length} live`;
}

function renderRadar() {
  const visible = getVisibleServices();
  if (visible.length === 0) {
    categoryList.innerHTML = "";
    return;
  }
  const counts = new Map();

  visible.forEach((service) => {
    const current = counts.get(service.category) ?? {
      count: 0,
      upvotes: 0,
      best: service.name
    };
    const currentBestRank =
      visible.find((entry) => entry.name === current.best)?.rank ?? Number.POSITIVE_INFINITY;

    current.count += 1;
    current.upvotes += service.upvotes;
    if (service.rank < currentBestRank) {
      current.best = service.name;
    }
    counts.set(service.category, current);
  });

  categoryList.innerHTML = [...counts.entries()]
    .sort(([, left], [, right]) => right.upvotes - left.upvotes)
    .map(
      ([category, info]) => `
        <article class="category-card">
          <p class="service-overline">${category}</p>
          <strong>${info.upvotes}</strong>
          <p>${info.count} launch${info.count > 1 ? "es" : ""} currently visible.</p>
          <div class="category-meta">
            <span>Best-ranked: ${info.best}</span>
            <span>${Math.round(info.upvotes / info.count)} avg upvotes</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderReviewDesk() {
  if (services.length === 0) {
    reviewDesk.innerHTML = `<p class="empty-state">No reviews yet.</p>`;
    return;
  }
  const shortlist = [...services]
    .filter((service) => service.reviews && service.reviews.length > 0)
    .sort((left, right) => (right.agentReviewScore ?? 0) - (left.agentReviewScore ?? 0))
    .slice(0, 3);

  if (shortlist.length === 0) {
    reviewDesk.innerHTML = `<p class="empty-state">No reviews yet.</p>`;
    return;
  }

  reviewDesk.innerHTML = shortlist
    .map((service) => {
      const leadReview = service.reviews[0];

      return `
        <article class="desk-card">
          <header>
            <div>
              <p class="service-overline">${service.category ?? ""}</p>
              <h3>${service.name}</h3>
            </div>
            <span class="review-score">${(leadReview.score ?? 0).toFixed(1)}</span>
          </header>
          <p>${leadReview.summary}</p>
          <div class="trace-meta-row">
            <span>${leadReview.agent}</span>
            <span>${service.endpointStatus ?? ""}</span>
            <span>${service.latencyMs ?? "—"} ms</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderFeed() {
  const visible = getVisibleServices();

  if (visible.length === 0) {
    serviceList.innerHTML = loadError
      ? `<div class="empty-state"><h3>Unable to load services</h3><p>The API is currently unavailable. Please try again later.</p></div>`
      : `<div class="empty-state"><h3>No services yet</h3><p>Submit one via the MCP endpoint at <code>/mcp</code> or <code>POST /api/services</code>.</p></div>`;
    return;
  }

  serviceList.innerHTML = visible
    .map(
      (service) => `
        <article class="service-card ${service.id === state.selectedId ? "is-active" : ""}" data-service-id="${service.id}" role="listitem">
          <div class="rank-pill">
            <div><small>rank</small><strong>${service.rank ? `#${service.rank}` : "—"}</strong></div>
          </div>

          <div class="vote-pill">
            <div><small>upvotes</small><strong>${service.upvotes ?? 0}</strong></div>
          </div>

          <div class="service-main">
            <div class="service-head">
              <div class="service-sigil">${(service.name ?? "").slice(0, 2)}</div>
              <div>
                <p class="service-overline">${[service.providerAgentName, service.category].filter(Boolean).join(" / ")}</p>
                <h3>${service.name ?? ""}</h3>
              </div>
            </div>
            <p>${service.tagline ?? service.description ?? ""}</p>
            <div class="service-tags">
              ${(service.capabilities ?? []).map((capability) => `<span class="tag">${capability}</span>`).join("")}
            </div>
            <div class="service-badges">
              ${(service.badges ?? []).map((badge) => `<span class="badge">${badge}</span>`).join("")}
            </div>
          </div>

          <div class="service-side">
            ${service.agentReviewScore != null ? `<div class="mini-stat">
              <strong>${formatScore(service.agentReviewScore)}</strong>
              <span>agent score</span>
            </div>` : ""}
            ${service.successRate != null ? `<div class="mini-stat">
              <strong>${service.successRate}%</strong>
              <span>success</span>
            </div>` : ""}
            ${service.trend ? `<div class="mini-stat">
              <strong>${service.trend}</strong>
              <span>vote trend</span>
            </div>` : ""}
          </div>
        </article>
      `
    )
    .join("");

  serviceList.querySelectorAll("[data-service-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.serviceId;
      renderFeed();
      renderDetail();
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
    detailProtocol.textContent = "";
    detailUsageExample.textContent = "";
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
  const infoPairs = [
    ["Verified invocations", service.verifiedInvocationCount ?? 0],
    ["Self-reported", service.selfReportedInvocationCount ?? 0],
    ["Trust label", service.trustLabel ?? "unknown"],
    ["Provider agent", service.providerAgentName ?? "—"],
    ["Provider type", service.providerAgentType ?? "—"],
    ["Schema version", service.schemaVersion ?? "—"],
    ["MCP endpoint", service.mcpEndpoint ?? "—"],
    ["Tool names", (service.toolNames ?? []).join(", ") || "—"],
    ["Compatible agents", service.compatibleAgentTypes ?? "—"],
    ["Success rate", service.successRate != null ? `${service.successRate}%` : "—"],
    ["Latency", service.latencyMs != null ? `${service.latencyMs} ms` : "—"],
    ["Auth mode", service.authMode ?? "—"],
    ["Autonomy", service.autonomyLevel ?? "—"],
    ["Input formats", service.inputFormats ?? "—"],
    ["Output formats", service.outputFormats ?? "—"],
    ["Pricing", service.pricingModel ?? "—"],
    ["Last checked", service.lastCheckedAt ?? "—"]
  ];

  detailStatus.textContent = service.endpointStatus === "Live" ? "Endpoint live" : (service.endpointStatus ? "Endpoint degraded" : "");
  detailStatus.classList.toggle("degraded", service.endpointStatus && service.endpointStatus !== "Live");
  detailRank.textContent = service.rank ? `#${service.rank} / ${service.trend ?? ""}` : "";
  detailName.textContent = service.name ?? "";
  detailTagline.textContent = service.tagline ?? "";
  detailUpvotes.textContent = service.upvotes ?? "";
  detailDescription.textContent = service.description ?? "";
  detailHumanNote.textContent = service.humanNote ?? "";
  detailToolCount.textContent = service.toolCount ? `${service.toolCount} tools in schema` : "";
  const reviews = service.reviews ?? [];
  detailReviewSummary.textContent = reviews.length > 0 ? `${reviews.length} review${reviews.length > 1 ? "s" : ""} on file` : "No reviews yet";

  const trustLabel = service.trustLabel ?? "unknown";
  const metaPills = [];
  if (service.category) metaPills.push(`<span class="meta-pill">${service.category}</span>`);
  if (service.reviewedByAgent) metaPills.push(`<span class="meta-pill">reviewed by ${service.reviewedByAgent}</span>`);
  if (service.agentReviewScore != null) metaPills.push(`<span class="meta-pill">${formatScore(service.agentReviewScore)}</span>`);
  if (service.endpointStatus) metaPills.push(`<span class="meta-pill">${service.endpointStatus}</span>`);
  metaPills.push(`<span class="meta-pill trust-badge trust-${trustLabel}">${trustLabel}</span>`);
  detailMeta.innerHTML = metaPills.join("");

  detailInfoGrid.innerHTML = infoPairs
    .map(
      ([label, value]) => `
        <article class="info-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");

  detailCapabilities.innerHTML = (service.capabilities ?? [])
    .map((capability) => `<span class="tag">${capability}</span>`)
    .join("");

  detailProtocol.textContent = JSON.stringify(
    {
      endpoint: service.mcpEndpoint ?? "",
      schemaVersion: service.schemaVersion ?? "",
      authMode: service.authMode ?? "",
      sampleTool: (service.toolNames ?? [])[0] ?? "",
      sampleNeed: service.usageExample ?? ""
    },
    null,
    2
  );
  detailUsageExample.textContent = service.usageExample ?? "";

  detailReviews.innerHTML = (service.reviews ?? [])
    .map(
      (review) => `
        <article class="review-card">
          <header>
            <div>
              <h4>${review.agent}</h4>
              <p class="review-meta">${review.tested}</p>
            </div>
            <div class="mini-stat">
              <strong>${review.score.toFixed(1)}</strong>
              <span>score</span>
            </div>
          </header>
          <p>${review.summary}</p>
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

function renderActivity() {
  activityList.innerHTML = `<p class="empty-state">No activity yet.</p>`;
}

function render() {
  renderFilters();
  renderOverview();
  renderRadar();
  renderReviewDesk();
  renderFeed();
  renderDetail();
  renderActivity();
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
}

hydrateFromApi();
