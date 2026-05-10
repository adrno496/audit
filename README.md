# ConvertAudit

MVP SaaS « pay-per-audit » : analyse automatique du potentiel de conversion d'une landing page via son URL. L'utilisateur saisit une URL, l'app récupère le HTML, l'envoie à Claude pour analyse CRO sur 8 dimensions, affiche un rapport interactif scoré 0–100 et permet l'export d'un rapport HTML autonome.

## Stack

- **Frontend** : `index.html` standalone (HTML + CSS + Vanilla JS, zéro framework, zéro build)
- **Backend** : Supabase Edge Function (Deno/TypeScript) — fetch URL + appel Claude (cache la clé API, contourne le CORS)
- **IA** : Claude `claude-sonnet-4-6` via [Anthropic API](https://docs.claude.com)
- **Parsing HTML** : [`deno-dom`](https://deno.land/x/deno_dom) côté Edge Function
- **Monétisation** : [Lemonsqueezy](https://lemonsqueezy.com) (1 crédit = 1 audit, packs prépayés ; v1 : crédits stockés en `localStorage`, hooks UI seulement)

## Structure

```
.
├── index.html                                    # App frontend complète
└── supabase/
    └── functions/
        └── audit-url/
            ├── index.ts                          # Edge Function
            └── deno.json                         # Import map (deno-dom)
```

## Prérequis

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Compte [Anthropic](https://console.anthropic.com) avec une clé API (`ANTHROPIC_API_KEY`)
- Compte [Supabase](https://supabase.com) (gratuit)
- Compte [Lemonsqueezy](https://lemonsqueezy.com) avec 3 produits/variants (1, 5, 20 crédits)

## Variables d'environnement

| Nom | Où | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secrets Supabase (Edge Function) | Clé `sk-ant-...` |

Le frontend a 3 constantes en haut de `index.html` à remplacer après déploiement :

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
const LEMONSQUEEZY_URL = "https://YOUR-STORE.lemonsqueezy.com/checkout/buy/YOUR-VARIANT";
```

## Setup local

```bash
# 1) Login + link au projet Supabase
supabase login
supabase link --project-ref <YOUR-REF>

# 2) Set le secret Anthropic côté Supabase
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx

# 3) Test local de la function
echo "ANTHROPIC_API_KEY=sk-ant-xxxxx" > supabase/.env.local
supabase functions serve audit-url --env-file supabase/.env.local

# 4) Tester depuis curl (autre terminal)
curl -X POST http://localhost:54321/functions/v1/audit-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR-ANON-KEY>" \
  -d '{"url":"https://stripe.com","lang":"fr"}'
```

## Déploiement

### Edge Function

```bash
supabase functions deploy audit-url
```

Vérifier le secret est bien set côté Supabase Dashboard → Project Settings → Edge Functions → Secrets.

### Frontend

1. Éditer `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LEMONSQUEEZY_URL` dans `index.html` (haut du `<script>`)
2. Drag-drop `index.html` sur [Netlify Drop](https://app.netlify.com/drop) ou [Vercel](https://vercel.com)
3. Tester avec une URL réelle

> Le frontend fonctionne aussi en `file://` direct, mais certains navigateurs (Firefox notamment) restreignent `fetch` cross-origin depuis `file://`. Pour le test sérieux, sers-le via un static host.

## Configuration Lemonsqueezy

1. Crée 3 produits dans ton store :
   - 1 audit · 2,90 €
   - 5 audits · 9,90 €
   - 20 audits · 29,00 €
2. Récupère le checkout URL pour le pack par défaut (le bouton « Acheter » dans la modal pointe vers `LEMONSQUEEZY_URL` configuré dans `index.html`)
3. Pour des liens distincts par pack : remplace les `<div class="pack">` dans la modal par des `<a>` cliquables vers chaque variant

> En v1, **les crédits ne sont pas synchronisés** avec Lemonsqueezy. Après paiement, l'utilisateur doit ajouter ses crédits manuellement (ou tu mets à jour `localStorage.convertaudit_credits` à la main pour la démo). En v2 : webhook Supabase + table `users`.

## API Edge Function

### `POST /functions/v1/audit-url`

**Request**
```json
{ "url": "https://example.com", "lang": "fr" }
```
- `lang` : `"fr"` ou `"en"` (défaut `"fr"`)

**Response 200**
```json
{
  "url": "https://example.com",
  "title": "Titre détecté",
  "summary": "Résumé 2 phrases",
  "scores": {
    "hero":         { "score": 7, "label": "...", "details": "...", "tips": ["...","...","..."] },
    "copywriting":  { "score": 6, "label": "...", "details": "...", "tips": [...] },
    "cta":          { "score": 8, "label": "...", "details": "...", "tips": [...] },
    "social_proof": { "score": 5, "label": "...", "details": "...", "tips": [...] },
    "structure":    { "score": 7, "label": "...", "details": "...", "tips": [...] },
    "trust":        { "score": 6, "label": "...", "details": "...", "tips": [...] },
    "urgency":      { "score": 4, "label": "...", "details": "...", "tips": [...] },
    "mobile":       { "score": 9, "label": "...", "details": "...", "tips": [...] }
  },
  "global_score": 67,
  "global_mention": "Bon",
  "quick_wins": ["...", "...", "..."],
  "strengths": ["...", "..."],
  "critical_issues": ["...", "..."]
}
```

**Erreurs**
| Status | Code | Sens |
|---|---|---|
| 400 | `invalid_url` | URL malformée ou non-http(s) |
| 400 | `unreachable` | Page inaccessible (timeout, 4xx, redirect bloquant) |
| 400 | `invalid_body` | Body JSON invalide |
| 500 | `server_misconfigured` | `ANTHROPIC_API_KEY` absent |
| 502 | `ai_unavailable` | Claude API timeout / 5xx |
| 502 | `parse_failed` | Réponse Claude non parseable même après retry |

## Limitations v1 connues

- Pas d'authentification utilisateur, crédits stockés en `localStorage` (perdus si cache vidé)
- Pas de webhook Lemonsqueezy → recharge manuelle
- Pas d'historique des audits côté serveur (rapport téléchargeable seulement)
- ~5–10 % d'URLs échoueront (Cloudflare bot challenge, sites lourds en JS)
- Pas de cache : un même URL audité 2 fois = 2 appels Claude (à monitorer en début)

## Idées v2

- Auth Supabase + table `audits` (historique, partage par lien)
- Webhook Lemonsqueezy → table `users.credits`
- Comparaison avant/après (re-audit même URL)
- Mode agence : batch 10 URLs en parallèle
- Intégration Google PageSpeed Insights (score technique)
- Export PDF (Puppeteer dans une 2e Edge Function ou service annexe)
- Embed widget iframe pour agences
- Scoring sectoriel (e-commerce vs SaaS vs service local vs médical)
- Cache 1h en mémoire (KV ou table) pour réduire le coût Anthropic

## Estimation coûts/revenus

- **Coût Claude Sonnet 4.6 par audit** : ~12k chars input + ~2k tokens output ≈ 0,01–0,03 €
- **Marge brute** à 2,90 €/audit : > 95 %

| Scénario | Audits/jour | Revenus/mois |
|---|---|---|
| Conservateur | 3 × 2,90 € | ~260 €/mois |
| Réaliste | 10 × 6 € (mix packs) | ~1 800 €/mois |
| Optimiste | 50 clients agence × pack 29 € | ~1 450 €/mois |

## Licence

Privé / propriétaire (à adapter).
