// src/export.js
// Génère un rapport HTML autonome pour ConvertAudit.
// ESM, runnable browser + Node, zéro dépendance.

// ============================================================
// Helpers
// ============================================================

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const tierFor100 = (s) => s < 40 ? "bad" : s < 60 ? "mid" : s < 80 ? "ok" : "good";
const tierFor10  = (s) => s < 4  ? "bad" : s < 6  ? "mid" : s < 8  ? "ok" : "good";

const tierColor = {
  bad:  "var(--bad)",
  mid:  "var(--warn)",
  ok:   "#84cc16",
  good: "var(--good)",
};
const tierLabel = {
  bad: "Faible", mid: "Moyen", ok: "Bon", good: "Excellent",
};

// Hash url → 8 char base64 stable, pour préfixer les clés localStorage
// (évite collision entre rapports différents stockés dans le même navigateur).
function urlHash(url) {
  const safe = String(url || "anonymous");
  // btoa gère les ASCII ; pour les non-ASCII on fallback sur un hash simple
  try {
    return btoa(unescape(encodeURIComponent(safe))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "x";
  } catch {
    let h = 5381;
    for (let i = 0; i < safe.length; i++) h = ((h << 5) + h) + safe.charCodeAt(i);
    return Math.abs(h).toString(36).slice(0, 8);
  }
}

// ============================================================
// Adapter heuristique : ancien format (analyse.html) → nouveau
// ============================================================

const DIM_META = {
  hero:         { label: "Accroche (Hero)",       weight: 2   },
  copywriting:  { label: "Copywriting",           weight: 1.5 },
  cta:          { label: "Call-to-Action",        weight: 2   },
  social_proof: { label: "Preuve sociale",        weight: 1   },
  structure:    { label: "Structure visuelle",    weight: 1   },
  trust:        { label: "Signaux de confiance",  weight: 1   },
  urgency:      { label: "Urgence / Rareté",      weight: 1   },
  mobile:       { label: "Mobile & Vitesse",      weight: 1   },
};

export function adaptLegacyData(legacy) {
  const scores = legacy.scores || {};
  const dimensions = Object.entries(DIM_META).map(([id, meta]) => {
    const s = scores[id] || { score: 0, label: "", details: "", tips: [] };
    return {
      id,
      label: meta.label,
      score: s.score ?? 0,
      maxScore: 10,
      weight: meta.weight,
      summary: s.details || s.label || "",
      actions: (s.tips || []).filter(Boolean),
    };
  });

  // issues[] heuristique :
  // - Chaque entrée de critical_issues devient un issue 'critical' si la dim corrélée a score≤3, sinon 'high'
  // - On ajoute un issue 'medium' pour chaque dimension à score 4-5 non encore couverte (max 3)
  const critical = legacy.critical_issues || [];
  const issues = [];
  const usedDims = new Set();

  for (const text of critical) {
    // Cherche la dimension la plus probable mentionnée dans le texte
    const lower = String(text).toLowerCase();
    const dim = dimensions.find((d) =>
      lower.includes(d.label.toLowerCase().split(" ")[0]) ||
      lower.includes(d.id.replace("_", " "))
    );
    const priority = (dim && dim.score <= 3) ? "critical" : "high";
    issues.push({
      priority,
      title: String(text).slice(0, 120),
      description: String(text),
      actions: dim ? dim.actions.slice(0, 3) : [],
    });
    if (dim) usedDims.add(dim.id);
  }
  // Compléter avec les dimensions à score 4-5 non couvertes
  const mediumCandidates = dimensions
    .filter((d) => d.score >= 4 && d.score <= 5 && !usedDims.has(d.id))
    .slice(0, 3);
  for (const d of mediumCandidates) {
    issues.push({
      priority: "medium",
      title: `${d.label} à renforcer`,
      description: d.summary || `Le score actuel de ${d.score}/10 indique une marge d'amélioration significative.`,
      actions: d.actions.slice(0, 3),
    });
  }

  return {
    url: legacy.url || "",
    pageTitle: legacy.title || legacy.url || "",
    date: new Date().toLocaleDateString("fr-FR"),
    globalScore: legacy.global_score ?? 0,
    mention: legacy.global_mention || tierLabel[tierFor100(legacy.global_score ?? 0)],
    summary: legacy.summary || "",
    quickWins: (legacy.quick_wins || []).slice(0, 3),
    strengths: legacy.strengths || [],
    dimensions,
    issues,
  };
}

// ============================================================
// Render — sections HTML
// ============================================================

function renderHeader(data) {
  return `
<header class="ca-header">
  <div class="ca-header-inner">
    <a class="ca-brand" href="https://convertaudit.app">
      <span class="ca-brand-mark">CA</span>
      <span class="ca-brand-name">ConvertAudit</span>
    </a>
    <code class="ca-url">${escapeHtml(data.url)}</code>
    <div class="ca-header-actions">
      <button type="button" class="ca-btn ca-btn-ghost btn-print" onclick="window.print()" aria-label="Imprimer le rapport">Imprimer</button>
      <a class="ca-btn ca-btn-primary btn-new-audit" href="https://convertaudit.app">Nouvel audit</a>
    </div>
  </div>
</header>`;
}

function renderHeroScore(data) {
  const score = Math.max(0, Math.min(100, data.globalScore | 0));
  const tier = tierFor100(score);
  const counts = (data.issues || []).reduce(
    (a, x) => (a[x.priority] = (a[x.priority] || 0) + 1, a),
    {}
  );
  // Cercle SVG : rayon 80, circumference = 2*PI*80 ≈ 502.65
  const R = 80;
  const C = 2 * Math.PI * R;
  return `
<section class="ca-hero" data-score="${score}" data-tier="${tier}">
  <div class="ca-hero-inner">
    <div class="ca-gauge">
      <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="12"/>
        <circle id="ca-gauge-progress" cx="100" cy="100" r="${R}" fill="none"
                stroke="${tierColor[tier]}" stroke-width="12" stroke-linecap="round"
                stroke-dasharray="${C} ${C}" stroke-dashoffset="${C}"
                transform="rotate(-90 100 100)"/>
      </svg>
      <div class="ca-gauge-text">
        <span class="ca-gauge-num" id="ca-gauge-num">0</span>
        <span class="ca-gauge-max">/100</span>
      </div>
    </div>
    <div class="ca-hero-meta">
      <h1 class="ca-hero-title">${escapeHtml(String(data.pageTitle || data.url).slice(0, 80))}</h1>
      <span class="ca-mention ca-mention-${tier}">${escapeHtml(data.mention || tierLabel[tier])}</span>
      <p class="ca-hero-summary">${escapeHtml(data.summary || "")}</p>
      <div class="ca-pills">
        <span class="ca-pill ca-pill-bad">${counts.critical || 0} critiques</span>
        <span class="ca-pill ca-pill-warn">${counts.high || 0} priorité haute</span>
        <span class="ca-pill ca-pill-info">${counts.medium || 0} améliorations</span>
      </div>
    </div>
  </div>
</section>`;
}

function renderQuickWins(data, hashId) {
  const wins = (data.quickWins || []).slice(0, 3);
  if (!wins.length) return "";
  return `
<section class="ca-section ca-quickwins">
  <div class="ca-section-inner">
    <h2 class="ca-h2">⚡ 3 actions immédiates</h2>
    <p class="ca-section-sub">Ces 3 corrections peuvent améliorer ton taux de conversion dès cette semaine.</p>
    <ol class="ca-quickwin-list">
      ${wins.map((text, i) => {
        const id = `ca_${hashId}_qw${i}`;
        return `
      <li class="ca-quickwin">
        <input type="checkbox" id="${id}" class="ca-check"/>
        <label for="${id}">
          <span class="ca-quickwin-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="ca-quickwin-text">${escapeHtml(text)}</span>
        </label>
      </li>`;
      }).join("")}
    </ol>
  </div>
</section>`;
}

function renderScores(data) {
  return `
<section class="ca-section ca-scores">
  <div class="ca-section-inner">
    <h2 class="ca-h2">Scores par dimension</h2>
    <div class="ca-scores-grid">
      ${data.dimensions.map((d) => {
        const tier = tierFor10(d.score);
        const pct = Math.max(0, Math.min(100, (d.score / (d.maxScore || 10)) * 100));
        return `
      <a class="ca-score-cell" href="#dim-${escapeHtml(d.id)}" data-tier="${tier}">
        <div class="ca-score-head">
          <span class="ca-score-label">${escapeHtml(d.label)}</span>
          <span class="ca-score-num">${d.score}<span class="ca-score-max">/${d.maxScore || 10}</span></span>
        </div>
        <div class="ca-score-meta">
          <span class="ca-score-weight">Poids ×${d.weight}</span>
        </div>
        <div class="ca-bar">
          <div class="ca-bar-fill" data-tier="${tier}" data-pct="${pct.toFixed(1)}"></div>
        </div>
      </a>`;
      }).join("")}
    </div>
  </div>
</section>`;
}

function renderIssues(data, hashId) {
  const order = { critical: 0, high: 1, medium: 2 };
  const issues = [...(data.issues || [])].sort(
    (a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9)
  );
  if (!issues.length) return "";
  const labelByPrio = { critical: "CRITIQUE", high: "HAUTE", medium: "MOYEN" };
  return `
<section class="ca-section ca-issues">
  <div class="ca-section-inner">
    <h2 class="ca-h2">Problèmes à corriger</h2>
    <div class="ca-issues-list">
      ${issues.map((iss, i) => `
      <article class="ca-issue ca-issue-${iss.priority}">
        <header class="ca-issue-head">
          <span class="ca-badge ca-badge-${iss.priority}">${labelByPrio[iss.priority] || iss.priority.toUpperCase()}</span>
          <h3 class="ca-issue-title">${escapeHtml(iss.title)}</h3>
        </header>
        <p class="ca-issue-desc">${escapeHtml(iss.description)}</p>
        ${(iss.actions || []).filter(Boolean).length ? `
        <ul class="ca-action-list">
          ${iss.actions.filter(Boolean).map((a, j) => {
            const id = `ca_${hashId}_iss${i}_${j}`;
            return `
          <li class="ca-action">
            <input type="checkbox" id="${id}" class="ca-check"/>
            <label for="${id}">${escapeHtml(a)}</label>
          </li>`;
          }).join("")}
        </ul>` : ""}
      </article>`).join("")}
    </div>
  </div>
</section>`;
}

function renderStrengths(data) {
  const strengths = (data.strengths || []).filter(Boolean);
  if (!strengths.length) return "";
  return `
<section class="ca-section ca-strengths">
  <div class="ca-section-inner">
    <h2 class="ca-h2">Points forts</h2>
    <ul class="ca-strength-list">
      ${strengths.map((s) => `
      <li class="ca-strength">
        <span class="ca-strength-icon" aria-hidden="true">✓</span>
        <span>${escapeHtml(s)}</span>
      </li>`).join("")}
    </ul>
  </div>
</section>`;
}

function renderDimensions(data, hashId) {
  return `
<section class="ca-section ca-dimensions">
  <div class="ca-section-inner">
    <h2 class="ca-h2">Détail par dimension</h2>
    <div class="ca-dim-list">
      ${data.dimensions.map((d) => {
        const tier = tierFor10(d.score);
        const isOpen = d.score <= 4;
        return `
      <details class="ca-dim" id="dim-${escapeHtml(d.id)}"${isOpen ? " open" : ""}>
        <summary class="ca-dim-summary">
          <span class="ca-badge ca-badge-tier" data-tier="${tier}">${d.score}/${d.maxScore || 10}</span>
          <span class="ca-dim-label">${escapeHtml(d.label)}</span>
          <span class="ca-dim-weight">×${d.weight}</span>
          <span class="ca-chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="ca-dim-body">
          <p class="ca-dim-desc">${escapeHtml(d.summary || "")}</p>
          ${(d.actions || []).filter(Boolean).length ? `
          <ul class="ca-action-list">
            ${d.actions.filter(Boolean).map((a, j) => {
              const id = `ca_${hashId}_dim${d.id}_${j}`;
              return `
            <li class="ca-action">
              <input type="checkbox" id="${id}" class="ca-check"/>
              <label for="${id}">${escapeHtml(a)}</label>
            </li>`;
            }).join("")}
          </ul>` : ""}
        </div>
      </details>`;
      }).join("")}
    </div>
  </div>
</section>`;
}

function renderFooter(data) {
  return `
<footer class="ca-footer">
  <div class="ca-footer-inner">
    <a class="ca-brand" href="https://convertaudit.app">
      <span class="ca-brand-mark">CA</span>
      <span class="ca-brand-name">ConvertAudit</span>
    </a>
    <p class="ca-footer-text">Généré par ConvertAudit · ${escapeHtml(data.date)}</p>
    <a class="ca-btn ca-btn-primary" href="https://convertaudit.app">Auditer une autre page →</a>
    <p class="ca-disclaimer">Ce rapport est généré par IA. Les recommandations sont indicatives et ne se substituent pas à l'expertise d'un professionnel.</p>
  </div>
</footer>`;
}

// ============================================================
// CSS inline
// ============================================================

function inlineCSS() {
  return `
:root {
  --accent: #0a8478;
  --accent-deep: #065e55;
  --accent-hot: #c8f04b;
  --accent-soft: #e8f8f5;
  --ink: #0d1117;
  --ink-2: #1f2937;
  --ink-3: #6b7280;
  --ink-4: #9ca3af;
  --paper: #ffffff;
  --paper-2: #f9fafb;
  --paper-3: #f3f4f6;
  --b: 1px solid #e5e7eb;
  --hs: 4px 4px 0 0 #0d1117;
  --good: #16a34a;
  --warn: #d97706;
  --bad: #dc2626;
  --info: #2563eb;
  --f-display: 'Bricolage Grotesque', system-ui, -apple-system, sans-serif;
  --f-mono: 'JetBrains Mono', ui-monospace, "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--f-display);
  background: var(--paper-2);
  color: var(--ink);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  font-size: 16px;
}
a { color: var(--ink); text-decoration: none; }
button { font: inherit; cursor: pointer; }

/* ===== Header ===== */
.ca-header {
  position: sticky; top: 0; z-index: 50;
  background: var(--ink); color: var(--paper);
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.ca-header-inner {
  display: flex; align-items: center; gap: 16px;
  max-width: 1100px; margin: 0 auto;
  padding: 12px 24px;
}
.ca-brand { display: inline-flex; align-items: center; gap: 10px; color: var(--paper); flex-shrink: 0; }
.ca-brand-mark {
  width: 30px; height: 30px; border-radius: 6px;
  background: var(--accent); color: var(--paper);
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 13px;
}
.ca-brand-name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.ca-url {
  flex: 1; min-width: 0;
  font-family: var(--f-mono); font-size: 12px;
  color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.05);
  padding: 6px 12px; border-radius: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ca-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.ca-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 8px 14px; border-radius: 8px;
  font-weight: 600; font-size: 13px; border: 0;
  transition: opacity .15s;
}
.ca-btn-primary { background: var(--accent-hot); color: var(--ink); }
.ca-btn-primary:hover { opacity: .9; }
.ca-btn-ghost {
  background: transparent; color: var(--paper);
  border: 1px solid rgba(255,255,255,.2);
}
.ca-btn-ghost:hover { background: rgba(255,255,255,.06); }

/* ===== Hero score ===== */
.ca-hero {
  background: var(--ink); color: var(--paper);
  padding: 48px 0 56px;
}
.ca-hero-inner {
  display: grid; gap: 40px;
  grid-template-columns: auto 1fr;
  align-items: center;
  max-width: 1100px; margin: 0 auto;
  padding: 0 24px;
}
.ca-gauge { position: relative; width: 200px; height: 200px; flex-shrink: 0; }
.ca-gauge svg { display: block; }
#ca-gauge-progress {
  transition: stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1);
}
.ca-gauge-text {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 4px;
}
.ca-gauge-num {
  font-family: var(--f-display); font-weight: 800;
  font-size: 64px; line-height: 1; letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.ca-gauge-max {
  font-family: var(--f-mono); font-size: 13px;
  color: rgba(255,255,255,.5); letter-spacing: 0.05em;
}
.ca-hero-meta { min-width: 0; }
.ca-hero-title {
  font-family: var(--f-display); font-weight: 700;
  font-size: 28px; line-height: 1.2; letter-spacing: -0.02em;
  margin: 0 0 12px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.ca-mention {
  display: inline-block;
  font-family: var(--f-mono); font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 4px 10px; border-radius: 999px; margin-bottom: 14px;
}
.ca-mention-bad  { background: var(--bad);  color: var(--paper); }
.ca-mention-mid  { background: var(--warn); color: var(--paper); }
.ca-mention-ok   { background: #84cc16; color: var(--ink); }
.ca-mention-good { background: var(--good); color: var(--paper); }
.ca-hero-summary {
  color: rgba(255,255,255,.75); margin: 0 0 16px;
  font-size: 15px; line-height: 1.55; max-width: 64ch;
}
.ca-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.ca-pill {
  display: inline-flex; align-items: center;
  font-family: var(--f-mono); font-size: 11px; font-weight: 700;
  padding: 5px 11px; border-radius: 999px;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.ca-pill-bad  { background: rgba(220,38,38,.18); color: #fca5a5; }
.ca-pill-warn { background: rgba(217,119,6,.18); color: #fcd34d; }
.ca-pill-info { background: rgba(37,99,235,.18); color: #93c5fd; }

/* ===== Sections génériques ===== */
.ca-section { padding: 56px 0; }
.ca-section-inner { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
.ca-h2 {
  font-family: var(--f-display); font-weight: 800;
  font-size: 28px; line-height: 1.2; letter-spacing: -0.02em;
  margin: 0 0 20px;
}
.ca-section-sub { color: var(--ink-3); font-size: 15px; margin: 0 0 24px; }

/* ===== Quick wins (fond accent-hot) ===== */
.ca-quickwins { background: var(--accent-hot); color: var(--ink); border-bottom: 1px solid var(--ink); border-top: 1px solid var(--ink); }
.ca-quickwin-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.ca-quickwin {
  background: var(--paper);
  border: 1px solid var(--ink); border-radius: 12px;
  box-shadow: var(--hs);
}
.ca-quickwin label {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 16px 20px; cursor: pointer;
}
.ca-quickwin input[type="checkbox"] {
  margin: 4px 0 0; width: 20px; height: 20px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.ca-quickwin-num {
  font-family: var(--f-mono); font-weight: 700; font-size: 13px;
  color: var(--accent-deep); letter-spacing: 0.04em;
  flex-shrink: 0; padding-top: 2px;
}
.ca-quickwin-text { font-size: 16px; line-height: 1.5; }
.ca-quickwin input:checked ~ label .ca-quickwin-text,
.ca-quickwin label:has(input:checked) .ca-quickwin-text {
  text-decoration: line-through;
}
.ca-quickwin:has(input:checked) { opacity: .55; }

/* ===== Scores grid ===== */
.ca-scores-grid {
  display: grid; gap: 12px;
  grid-template-columns: repeat(2, 1fr);
}
.ca-score-cell {
  display: block;
  background: var(--paper);
  border: var(--b); border-radius: 12px;
  padding: 16px 18px;
  transition: transform .15s, border-color .15s;
}
.ca-score-cell:hover { transform: translateY(-2px); border-color: var(--ink-3); }
.ca-score-head {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 12px; margin-bottom: 4px;
}
.ca-score-label { font-weight: 600; font-size: 15px; color: var(--ink); }
.ca-score-num {
  font-family: var(--f-display); font-weight: 800; font-size: 22px;
  letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
}
.ca-score-max { color: var(--ink-3); font-size: 14px; font-weight: 500; }
.ca-score-meta {
  font-family: var(--f-mono); font-size: 11px; color: var(--ink-3);
  letter-spacing: 0.04em; text-transform: uppercase;
  margin-bottom: 10px;
}
.ca-bar {
  height: 8px; background: var(--paper-3);
  border-radius: 999px; overflow: hidden;
}
.ca-bar-fill {
  height: 100%; width: 100%;
  transform: scaleX(0); transform-origin: left;
  border-radius: 999px;
  transition: transform .9s cubic-bezier(.2,.7,.2,1);
}
.ca-bar-fill[data-tier="bad"]  { background: var(--bad); }
.ca-bar-fill[data-tier="mid"]  { background: var(--warn); }
.ca-bar-fill[data-tier="ok"]   { background: #84cc16; }
.ca-bar-fill[data-tier="good"] { background: var(--good); }

/* ===== Issues ===== */
.ca-issues-list { display: grid; gap: 16px; }
.ca-issue {
  background: var(--paper);
  border: 1px solid var(--ink); border-radius: 14px;
  box-shadow: var(--hs);
  padding: 22px 24px;
}
.ca-issue-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.ca-issue-title {
  font-family: var(--f-display); font-weight: 700;
  font-size: 19px; line-height: 1.3; letter-spacing: -0.015em;
  margin: 0;
}
.ca-issue-desc { color: var(--ink-3); margin: 0 0 14px; font-size: 15px; line-height: 1.55; }

.ca-badge {
  display: inline-flex; align-items: center;
  font-family: var(--f-mono); font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 999px;
  letter-spacing: 0.08em;
}
.ca-badge-critical { background: var(--bad);  color: var(--paper); }
.ca-badge-high     { background: var(--warn); color: var(--paper); }
.ca-badge-medium   { background: var(--info); color: var(--paper); }
.ca-badge-tier[data-tier="bad"]  { background: var(--bad);  color: var(--paper); }
.ca-badge-tier[data-tier="mid"]  { background: var(--warn); color: var(--paper); }
.ca-badge-tier[data-tier="ok"]   { background: #84cc16; color: var(--ink); }
.ca-badge-tier[data-tier="good"] { background: var(--good); color: var(--paper); }

/* ===== Action list (issues + dimensions) ===== */
.ca-action-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.ca-action {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 12px; border-radius: 8px;
  background: var(--paper-2);
  transition: opacity .15s;
}
.ca-action input[type="checkbox"] {
  margin: 3px 0 0; width: 17px; height: 17px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.ca-action label {
  flex: 1; cursor: pointer; line-height: 1.5; font-size: 14.5px; color: var(--ink-2);
}
.ca-action:has(input:checked) { opacity: .5; }
.ca-action:has(input:checked) label { text-decoration: line-through; }

/* ===== Strengths ===== */
.ca-strengths { background: var(--accent-soft); border-top: 1px solid var(--accent); border-bottom: 1px solid var(--accent); }
.ca-strength-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.ca-strength {
  display: flex; align-items: flex-start; gap: 14px;
  background: var(--paper);
  border: 1px solid var(--accent); border-radius: 12px;
  padding: 14px 18px;
  font-size: 15.5px; line-height: 1.5;
}
.ca-strength-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent); color: var(--paper);
  font-weight: 800; flex-shrink: 0; margin-top: -2px;
}

/* ===== Dimensions detail ===== */
.ca-dim-list { display: grid; gap: 10px; }
.ca-dim {
  background: var(--paper);
  border: var(--b); border-radius: 12px;
  overflow: hidden;
}
.ca-dim[open] { border-color: var(--ink-3); }
.ca-dim-summary {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; cursor: pointer;
  list-style: none;
}
.ca-dim-summary::-webkit-details-marker { display: none; }
.ca-dim-label { flex: 1; font-weight: 600; font-size: 16px; }
.ca-dim-weight { font-family: var(--f-mono); font-size: 11px; color: var(--ink-3); letter-spacing: 0.04em; }
.ca-chevron {
  font-size: 18px; color: var(--ink-3);
  transition: transform .2s;
}
.ca-dim[open] .ca-chevron { transform: rotate(180deg); }
.ca-dim-body {
  padding: 0 18px 18px;
  border-top: var(--b);
  padding-top: 16px;
}
.ca-dim-desc { color: var(--ink-2); margin: 0 0 12px; font-size: 14.5px; line-height: 1.6; }

/* ===== Footer ===== */
.ca-footer {
  background: var(--ink); color: var(--paper);
  padding: 56px 24px;
}
.ca-footer-inner {
  max-width: 600px; margin: 0 auto; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 16px;
}
.ca-footer-text { font-family: var(--f-mono); font-size: 13px; color: rgba(255,255,255,.6); margin: 0; letter-spacing: 0.04em; }
.ca-footer .ca-brand-name { color: var(--paper); }
.ca-disclaimer {
  margin-top: 12px;
  font-size: 12px; color: rgba(255,255,255,.4); max-width: 50ch;
  line-height: 1.55;
}

/* ===== Mobile ===== */
@media (max-width: 640px) {
  .ca-header-inner { padding: 12px 16px; gap: 10px; }
  .ca-url { font-size: 11px; padding: 5px 9px; }
  .ca-btn { padding: 7px 11px; font-size: 12px; }
  .ca-hero { padding: 32px 0 40px; }
  .ca-hero-inner { grid-template-columns: 1fr; gap: 24px; padding: 0 16px; }
  .ca-gauge { width: 160px; height: 160px; margin: 0 auto; }
  .ca-gauge svg { width: 160px; height: 160px; }
  .ca-gauge-num { font-size: 52px; }
  .ca-hero-title { font-size: 22px; }
  .ca-section { padding: 40px 0; }
  .ca-section-inner { padding: 0 16px; }
  .ca-h2 { font-size: 22px; }
  .ca-scores-grid { grid-template-columns: 1fr; }
  .ca-issue { padding: 18px 16px; }
  .ca-issue-title { font-size: 17px; }
}

/* ===== Print ===== */
@media print {
  body { background: white; color: black; font-size: 11pt; }
  .ca-header, .btn-print, .btn-new-audit, .ca-footer .ca-btn { display: none !important; }
  .ca-hero { background: white !important; color: black !important; padding: 24px 0; border-bottom: 2px solid black; }
  .ca-hero-summary, .ca-gauge-max { color: #444 !important; }
  .ca-pill { border: 1px solid currentColor; background: transparent !important; }
  .ca-pill-bad  { color: var(--bad); }
  .ca-pill-warn { color: var(--warn); }
  .ca-pill-info { color: var(--info); }
  .ca-quickwins { background: white !important; border: 2px solid black; }
  .ca-strengths { background: white !important; }
  .ca-issue, .ca-quickwin, .ca-strength, .ca-dim { box-shadow: none !important; page-break-inside: avoid; }
  .ca-bar-fill { transform: scaleX(1) !important; transition: none !important; }
  .ca-dim { open: open !important; }
  .ca-dim-body { display: block !important; }
  .ca-footer { background: white !important; color: black !important; border-top: 2px solid black; padding-top: 24px; }
  .ca-disclaimer { color: #666 !important; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; color: #666; }
  .ca-action:has(input:checked) { opacity: 1; }
  .ca-action:has(input:checked) label { text-decoration: none; }
}
`;
}

// ============================================================
// JS inline
// ============================================================

function inlineJS(score) {
  const R = 80;
  const C = 2 * Math.PI * R;
  return `
(function () {
  // 1. Anim jauge SVG
  var progress = document.getElementById('ca-gauge-progress');
  var num = document.getElementById('ca-gauge-num');
  var target = ${score};
  var C = ${C};
  if (progress) {
    requestAnimationFrame(function () {
      progress.style.strokeDashoffset = (C - C * target / 100).toFixed(2);
    });
  }
  // Anim compteur synchro
  if (num) {
    var start = performance.now();
    var dur = 1200;
    function tick(t) {
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      num.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(tick);
      else num.textContent = target;
    }
    requestAnimationFrame(tick);
  }

  // 2. Anim barres dimensions au scroll
  var bars = document.querySelectorAll('.ca-bar-fill[data-pct]');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var pct = parseFloat(e.target.getAttribute('data-pct')) / 100;
          e.target.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });
    bars.forEach(function (b) { io.observe(b); });
  } else {
    bars.forEach(function (b) {
      var pct = parseFloat(b.getAttribute('data-pct')) / 100;
      b.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
    });
  }

  // 3. Persistence checkboxes
  var checks = document.querySelectorAll('input.ca-check[type="checkbox"]');
  checks.forEach(function (c) {
    var id = c.id;
    if (!id) return;
    try {
      if (localStorage.getItem(id) === '1') c.checked = true;
    } catch (e) {}
    c.addEventListener('change', function () {
      try { localStorage.setItem(id, c.checked ? '1' : '0'); } catch (e) {}
    });
  });

  // 4. Smooth scroll vers les sections détail
  document.querySelectorAll('a[href^="#dim-"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var t = document.querySelector(a.getAttribute('href'));
      if (t) {
        ev.preventDefault();
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Ouvre le <details> cible
        if (t.tagName === 'DETAILS' && !t.open) t.open = true;
      }
    });
  });
})();
`;
}

// ============================================================
// Main export
// ============================================================

export function generateExportHTML(data) {
  const d = data || {};
  const score = Math.max(0, Math.min(100, d.globalScore | 0));
  const hashId = urlHash(d.url);
  const date = d.date || new Date().toLocaleDateString("fr-FR");
  const fullData = { ...d, date };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Audit ConvertAudit — ${escapeHtml(d.url || "")} — ${escapeHtml(date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${inlineCSS()}</style>
</head>
<body>
${renderHeader(fullData)}
${renderHeroScore(fullData)}
${renderQuickWins(fullData, hashId)}
${renderScores(fullData)}
${renderIssues(fullData, hashId)}
${renderStrengths(fullData)}
${renderDimensions(fullData, hashId)}
${renderFooter(fullData)}
<script>${inlineJS(score)}</script>
</body>
</html>`;
}
