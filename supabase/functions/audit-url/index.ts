// ConvertAudit — Edge Function audit-url
// Reçoit { url, lang, byok? } → fetch HTML, extrait contexte, appelle l'IA (BYOK ou clé serveur), retourne JSON scoré.

import { DOMParser } from "deno-dom";

// Clé serveur de fallback (mode payant via crédits Lemonsqueezy)
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SERVER_DEFAULT_PROVIDER: Provider = "anthropic";
const SERVER_DEFAULT_MODEL = "claude-sonnet-4-6";

const FETCH_TIMEOUT_MS = 10_000;
const AI_TIMEOUT_MS = 30_000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_TOKENS = 4000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

const DIMENSIONS = ["hero", "copywriting", "cta", "social_proof", "structure", "trust", "urgency", "mobile"] as const;
type Dimension = typeof DIMENSIONS[number];

interface DimensionScore {
  score: number;
  label: string;
  details: string;
  tips: string[];
}

interface AuditPayload {
  url: string;
  title: string;
  summary: string;
  scores: Record<Dimension, DimensionScore>;
  global_score: number;
  global_mention: "Faible" | "Moyen" | "Bon" | "Excellent";
  quick_wins: string[];
  strengths: string[];
  critical_issues: string[];
  meta: { provider: Provider; model: string };
}

// ============================================================
// PROVIDERS
// ============================================================

type Provider = "anthropic" | "openai" | "groq" | "grok" | "mistral" | "openrouter";
const SUPPORTED_PROVIDERS: Provider[] = ["anthropic", "openai", "groq", "grok", "mistral", "openrouter"];

interface ProviderConfig {
  endpoint: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildBody: (model: string, system: string, user: string) => Record<string, unknown>;
  extractText: (data: unknown) => string;
}

function chatCompletionsBody(opts: { jsonMode: boolean }) {
  return (model: string, system: string, user: string) => {
    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    return body;
  };
}

function chatCompletionsExtract(data: unknown): string {
  const d = data as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content ?? "";
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    endpoint: "https://api.anthropic.com/v1/messages",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    buildBody: (model, system, user) => ({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
    extractText: (data) => {
      const d = data as { content?: { type: string; text?: string }[] };
      return d.content?.find((c) => c.type === "text")?.text ?? "";
    },
  },
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    buildBody: chatCompletionsBody({ jsonMode: true }),
    extractText: chatCompletionsExtract,
  },
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    buildBody: chatCompletionsBody({ jsonMode: true }),
    extractText: chatCompletionsExtract,
  },
  grok: {
    endpoint: "https://api.x.ai/v1/chat/completions",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    // xAI grok-4 supporte response_format json_object ; on l'active.
    buildBody: chatCompletionsBody({ jsonMode: true }),
    extractText: chatCompletionsExtract,
  },
  mistral: {
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
    }),
    buildBody: chatCompletionsBody({ jsonMode: true }),
    extractText: chatCompletionsExtract,
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    buildHeaders: (key) => ({
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": "https://convertaudit.app",
      "X-Title": "ConvertAudit",
    }),
    buildBody: chatCompletionsBody({ jsonMode: true }),
    extractText: chatCompletionsExtract,
  },
};

// ============================================================
// HELPERS HTTP
// ============================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ============================================================
// PARSING PAGE
// ============================================================

interface PageContext {
  title: string;
  metaDescription: string;
  hasViewport: boolean;
  headings: { level: number; text: string }[];
  ctas: string[];
  bodyText: string;
}

function extractPageContext(html: string): PageContext {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    return { title: "", metaDescription: "", hasViewport: false, headings: [], ctas: [], bodyText: "" };
  }

  const title = (doc.querySelector("title")?.textContent ?? "").trim();
  const metaDescription = (doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").trim();
  const hasViewport = !!doc.querySelector('meta[name="viewport"]');

  const headings: { level: number; text: string }[] = [];
  for (const tag of ["h1", "h2", "h3"]) {
    const level = Number(tag[1]);
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) headings.push({ level, text });
    }
  }

  const ctaSet = new Set<string>();
  for (const btn of Array.from(doc.querySelectorAll("button"))) {
    const text = (btn.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length < 80) ctaSet.add(text);
  }
  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const cls = (a.getAttribute("class") ?? "").toLowerCase();
    if (/(cta|button|btn)/.test(cls)) {
      const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && text.length < 80) ctaSet.add(text);
    }
  }
  const ctas = Array.from(ctaSet).slice(0, 30);

  for (const sel of ["script", "style", "noscript", "svg"]) {
    for (const el of Array.from(doc.querySelectorAll(sel))) el.remove();
  }
  const bodyText = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();

  return { title, metaDescription, hasViewport, headings, ctas, bodyText };
}

function buildUserContext(url: string, ctx: PageContext): string {
  const headingsBlock = ctx.headings.slice(0, 60).map((h) => `H${h.level}: ${h.text}`).join("\n");
  const ctaBlock = ctx.ctas.length ? ctx.ctas.map((c) => `- ${c}`).join("\n") : "(aucun bouton/CTA détecté)";
  const remaining = MAX_CONTEXT_CHARS - (headingsBlock.length + ctaBlock.length + 500);
  const corpus = ctx.bodyText.slice(0, Math.max(2000, remaining));

  return [
    `URL analysée: ${url}`,
    `Titre <title>: ${ctx.title || "(absent)"}`,
    `Meta description: ${ctx.metaDescription || "(absente)"}`,
    `Viewport meta présent: ${ctx.hasViewport ? "oui" : "non"}`,
    "",
    "=== Hiérarchie des titres ===",
    headingsBlock || "(aucun H1/H2/H3 détecté)",
    "",
    "=== Boutons / CTA détectés ===",
    ctaBlock,
    "",
    "=== Texte visible (tronqué) ===",
    corpus,
  ].join("\n");
}

function buildSystemPrompt(lang: "fr" | "en"): string {
  const isFr = lang === "fr";
  const lead = isFr
    ? "Tu es un expert en optimisation de conversion (CRO) avec 15 ans d'expérience."
    : "You are a conversion rate optimization (CRO) expert with 15 years of experience.";
  const langInstr = isFr ? "Réponds en français." : "Respond in English.";
  const strict = isFr
    ? "Retourne UNIQUEMENT un objet JSON valide, sans markdown, sans préface, sans backticks."
    : "Return ONLY a valid JSON object, no markdown, no preamble, no backticks.";

  return `${lead}\n${langInstr}\n${strict}\n\nStructure JSON attendue (chaque dimension: score 0-10 entier, label court, details 2-3 phrases, tips = exactement 3 actions concrètes):\n{\n  "url": "string",\n  "title": "string",\n  "summary": "string (2 phrases max résumant ce que vend la page)",\n  "scores": {\n    "hero":         { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "copywriting":  { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "cta":          { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "social_proof": { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "structure":    { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "trust":        { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "urgency":      { "score": 0, "label": "", "details": "", "tips": ["","",""] },\n    "mobile":       { "score": 0, "label": "", "details": "", "tips": ["","",""] }\n  },\n  "quick_wins": ["", "", ""],\n  "strengths": ["", ""],\n  "critical_issues": ["", ""]\n}\n\nDimensions à évaluer:\n- hero: clarté de la proposition de valeur, headline, sous-titre, above the fold\n- copywriting: structure (AIDA/PAS), bénéfices vs fonctionnalités, lisibilité, voix\n- cta: nombre, placement, wording, urgence, friction\n- social_proof: témoignages, logos clients, chiffres, certifications, avis\n- structure: hiérarchie H1/H2/H3, sections logiques, espacement, scanabilité\n- trust: mentions légales, HTTPS, garanties, politique retour, FAQ\n- urgency: offres limitées, compte à rebours, disponibilité, FOMO\n- mobile: viewport meta, images compressées, pas de bloquants évidents`;
}

// ============================================================
// APPEL IA (avec retry JSON)
// ============================================================

async function callProvider(
  provider: Provider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: cfg.buildHeaders(apiKey),
    body: JSON.stringify(cfg.buildBody(model, systemPrompt, userMessage)),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    // On tronque pour éviter de logger toute la réponse — la clé n'apparaît PAS dans la réponse de l'API.
    throw new Error(`${provider}_${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = cfg.extractText(data);
  if (!text) throw new Error(`${provider}_empty_response`);
  return text;
}

function tryParseJson(raw: string): unknown | null {
  let s = raw.trim();
  // Retire les code fences markdown
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch { /* fallthrough */ }
  }
  // Tente de réparer un JSON tronqué
  if (start >= 0 && end < 0) {
    let candidate = s.slice(start);
    let depth = 0, brackets = 0, inStr = false, esc = false;
    for (const ch of candidate) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
    if (inStr) candidate = candidate.replace(/[^"]*$/, '"');
    candidate = candidate.replace(/,\s*$/, "");
    candidate += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, depth));
    try { return JSON.parse(candidate); } catch { /* fallthrough */ }
  }
  return null;
}

// ============================================================
// NORMALISATION PAYLOAD
// ============================================================

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v)));
}

function normalizeDimension(raw: unknown): DimensionScore {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const tipsRaw = Array.isArray(obj.tips) ? (obj.tips as unknown[]) : [];
  const tips = tipsRaw.map((t) => String(t)).filter((t) => t.trim().length > 0).slice(0, 5);
  while (tips.length < 3) tips.push("");
  return {
    score: clampScore(obj.score),
    label: String(obj.label ?? "").slice(0, 80),
    details: String(obj.details ?? ""),
    tips,
  };
}

function computeGlobalScore(scores: Record<Dimension, DimensionScore>): number {
  // Pondération: hero ×2, cta ×2, copywriting ×1.5, autres ×1. Total weight = 9.5. Scale to 100.
  const weighted =
    scores.hero.score * 2 +
    scores.cta.score * 2 +
    scores.copywriting.score * 1.5 +
    scores.social_proof.score +
    scores.structure.score +
    scores.trust.score +
    scores.urgency.score +
    scores.mobile.score;
  const totalWeight = 9.5;
  return Math.round((weighted / (totalWeight * 10)) * 100);
}

function mentionFor(score: number): AuditPayload["global_mention"] {
  if (score < 40) return "Faible";
  if (score < 60) return "Moyen";
  if (score < 80) return "Bon";
  return "Excellent";
}

function normalizePayload(parsed: unknown, url: string, provider: Provider, model: string): AuditPayload {
  const root = (parsed ?? {}) as Record<string, unknown>;
  const rawScores = (root.scores ?? {}) as Record<string, unknown>;
  const scores = Object.fromEntries(
    DIMENSIONS.map((d) => [d, normalizeDimension(rawScores[d])]),
  ) as Record<Dimension, DimensionScore>;
  const globalScore = computeGlobalScore(scores);

  const stringArray = (v: unknown, n: number): string[] => {
    const arr = Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim().length > 0) : [];
    return arr.slice(0, n);
  };

  return {
    url,
    title: String(root.title ?? ""),
    summary: String(root.summary ?? ""),
    scores,
    global_score: globalScore,
    global_mention: mentionFor(globalScore),
    quick_wins: stringArray(root.quick_wins, 5),
    strengths: stringArray(root.strengths, 5),
    critical_issues: stringArray(root.critical_issues, 5),
    meta: { provider, model },
  };
}

// ============================================================
// FETCH PAGE CIBLE
// ============================================================

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ConvertAuditBot/1.0; +https://convertaudit.example)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "fr,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("html")) throw new Error("not_html");
  return await res.text();
}

// ============================================================
// HANDLER
// ============================================================

interface Byok {
  provider: Provider;
  apiKey: string;
  model: string;
}

interface RequestBody {
  url?: string;
  lang?: string;
  byok?: { provider?: string; apiKey?: string; model?: string };
}

function resolveCredentials(body: RequestBody): { provider: Provider; apiKey: string; model: string } | { error: string } {
  if (body.byok && (body.byok.provider || body.byok.apiKey || body.byok.model)) {
    const p = (body.byok.provider ?? "").toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(p as Provider)) return { error: "invalid_provider" };
    const apiKey = (body.byok.apiKey ?? "").trim();
    if (!apiKey) return { error: "missing_api_key" };
    const model = (body.byok.model ?? "").trim();
    if (!model) return { error: "missing_model" };
    return { provider: p as Provider, apiKey, model };
  }
  if (!ANTHROPIC_API_KEY) return { error: "server_misconfigured" };
  return { provider: SERVER_DEFAULT_PROVIDER, apiKey: ANTHROPIC_API_KEY, model: SERVER_DEFAULT_MODEL };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const url = (body.url ?? "").trim();
  const lang: "fr" | "en" = body.lang === "en" ? "en" : "fr";

  if (!isValidHttpUrl(url)) {
    return jsonResponse({ error: "invalid_url", message: "URL invalide (http/https requis)" }, 400);
  }

  const creds = resolveCredentials(body);
  if ("error" in creds) {
    const map: Record<string, { status: number; message: string }> = {
      invalid_provider: { status: 400, message: "Fournisseur IA non supporté" },
      missing_api_key: { status: 400, message: "Clé API manquante" },
      missing_model: { status: 400, message: "Modèle manquant" },
      server_misconfigured: { status: 500, message: "Service mal configuré (clé serveur absente)" },
    };
    const m = map[creds.error] ?? { status: 400, message: creds.error };
    return jsonResponse({ error: creds.error, message: m.message }, m.status);
  }

  let html: string;
  try {
    html = await fetchPage(url);
  } catch (err) {
    console.error("fetchPage error:", err);
    return jsonResponse({ error: "unreachable", message: "Page inaccessible" }, 400);
  }

  const ctx = extractPageContext(html);
  const userMessage = buildUserContext(url, ctx);
  const systemPrompt = buildSystemPrompt(lang);

  let parsed: unknown = null;
  try {
    const first = await callProvider(creds.provider, creds.apiKey, creds.model, systemPrompt, userMessage);
    parsed = tryParseJson(first);
    if (!parsed) {
      const retry = await callProvider(
        creds.provider,
        creds.apiKey,
        creds.model,
        systemPrompt,
        userMessage + "\n\nIMPORTANT: ta dernière réponse n'était pas un JSON valide. Renvoie UNIQUEMENT l'objet JSON, sans markdown ni texte autour.",
      );
      parsed = tryParseJson(retry);
    }
  } catch (err) {
    // Le message d'erreur peut contenir le code HTTP du provider et un extrait de réponse, mais JAMAIS la clé.
    console.error("callProvider error:", err instanceof Error ? err.message : String(err));
    const msg = err instanceof Error ? err.message : "ai_error";
    // Détection erreur d'auth probable (401/403 du provider)
    const looksAuth = /_(401|403)\b/.test(msg);
    return jsonResponse(
      {
        error: looksAuth ? "ai_auth_failed" : "ai_unavailable",
        message: looksAuth ? "Clé API invalide ou refusée" : "Analyse impossible, réessaie",
        provider: creds.provider,
      },
      502,
    );
  }

  if (!parsed) {
    return jsonResponse({ error: "parse_failed", message: "Réponse IA non exploitable", provider: creds.provider }, 502);
  }

  const payload = normalizePayload(parsed, url, creds.provider, creds.model);
  if (!payload.title) payload.title = ctx.title || new URL(url).hostname;

  return jsonResponse(payload, 200);
});
