// ConvertAudit — Edge Function audit-url
// Reçoit { url, lang } → fetch HTML, extrait contexte, appelle Claude, retourne JSON scoré.

import { DOMParser } from "deno-dom";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

const FETCH_TIMEOUT_MS = 10_000;
const ANTHROPIC_TIMEOUT_MS = 30_000;
const MAX_CONTEXT_CHARS = 12_000;

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
}

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

function buildClaudeUserContext(url: string, ctx: PageContext): string {
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

interface ClaudeMessageResponse {
  content?: { type: string; text?: string }[];
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic_${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as ClaudeMessageResponse;
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  if (!text) throw new Error("anthropic_empty_response");
  return text;
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fallthrough */ }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* fallthrough */ }
  }
  return null;
}

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

function normalizePayload(parsed: unknown, url: string): AuditPayload {
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
  };
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "server_misconfigured", message: "ANTHROPIC_API_KEY manquante" }, 500);
  }

  let body: { url?: string; lang?: string } = {};
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

  let html: string;
  try {
    html = await fetchPage(url);
  } catch (err) {
    console.error("fetchPage error:", err);
    return jsonResponse({ error: "unreachable", message: "Page inaccessible" }, 400);
  }

  const ctx = extractPageContext(html);
  const userMessage = buildClaudeUserContext(url, ctx);
  const systemPrompt = buildSystemPrompt(lang);

  let parsed: unknown = null;
  try {
    const first = await callClaude(systemPrompt, userMessage);
    parsed = tryParseJson(first);
    if (!parsed) {
      const retry = await callClaude(
        systemPrompt,
        userMessage + "\n\nIMPORTANT: ta dernière réponse n'était pas un JSON valide. Renvoie UNIQUEMENT l'objet JSON, sans markdown ni texte autour.",
      );
      parsed = tryParseJson(retry);
    }
  } catch (err) {
    console.error("callClaude error:", err);
    return jsonResponse({ error: "ai_unavailable", message: "Analyse impossible, réessaie" }, 502);
  }

  if (!parsed) {
    return jsonResponse({ error: "parse_failed", message: "Réponse IA non exploitable" }, 502);
  }

  const payload = normalizePayload(parsed, url);
  if (!payload.title) payload.title = ctx.title || new URL(url).hostname;

  return jsonResponse(payload, 200);
});
