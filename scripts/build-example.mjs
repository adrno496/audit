// scripts/build-example.mjs
// Génère public/audit-example.html depuis src/export.js avec les données Alpha Terminal du brief.
// Run: node scripts/build-example.mjs

import { generateExportHTML } from "../src/export.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const exampleData = {
  url: "alpha-terminal-sepia.vercel.app",
  pageTitle: "Alpha — Terminal d'analyse financière IA (46+ modules, 14 LLMs, BYOK)",
  date: "10/05/2026",
  globalScore: 41,
  mention: "Moyen",
  summary: "Alpha est un terminal d'analyse financière IA positionné comme alternative Bloomberg. La page souffre de surcharge informationnelle, d'une absence totale de preuve sociale et d'un CTA peu visible.",
  quickWins: [
    "Corriger les 3 clés de traduction non résolues (mod.risk-dashboard, mod.geo-risk, mod.news-feed) visibles en production",
    "Ajouter un CTA primaire visible dans le hero avec prix et garantie",
    "Choisir une langue principale et supprimer les doublons bilingues",
  ],
  strengths: [
    "Positionnement 'hedge fund analyst in the browser' vs Bloomberg 24 000€/an très percutant",
    "Modèle BYOK avec transparence sur les coûts — différenciateur fort",
  ],
  dimensions: [
    { id: "hero",      label: "Accroche (Hero)",     score: 5, maxScore: 10, weight: 2,   summary: "Le headline est fort mais noyé par un ticker crypto. Aucun CTA au-dessus de la ligne de flottaison.", actions: ["Supprimer ou miniaturiser le ticker de cours dans le hero", "Ajouter un sous-titre orienté bénéfice : 'Prenez des décisions pro en 30s'", "Ajouter une capture d'écran ou GIF du terminal sous le headline"] },
    { id: "copy",      label: "Copywriting",         score: 4, maxScore: 10, weight: 1.5, summary: "Page bilingue avec contenu doublé. Bugs de traduction non résolus en production. Ton feature-oriented plutôt que benefit-oriented.", actions: ["Créer /fr et /en séparés plutôt que tout afficher en double", "Corriger les clés non résolues (mod.risk-dashboard.label, etc.)", "Transformer les descriptions modules en bénéfices concrets"] },
    { id: "cta",       label: "Call-to-Action",      score: 4, maxScore: 10, weight: 2,   summary: "Pas de CTA dominant au-dessus de la fold. Le prix est mentionné dans la section BYOK sans bouton attaché.", actions: ["Ajouter un bouton CTA primaire dans le hero (couleur contrastante)", "Ajouter un CTA sticky bas de page avec prix et garantie", "Créer une section pricing avec CTA centré avant 'Comment ça marche'"] },
    { id: "social",    label: "Preuve sociale",      score: 2, maxScore: 10, weight: 1,   summary: "Aucun témoignage, aucune métrique, aucun logo. Absence critique pour un outil financier payant.", actions: ["Ajouter 3 témoignages courts avec profil utilisateur", "Intégrer une métrique de traction (nb d'utilisateurs, analyses générées)", "Afficher les logos des providers API (Anthropic, OpenAI, Google)"] },
    { id: "structure", label: "Structure visuelle",  score: 4, maxScore: 10, weight: 1,   summary: "Page extrêmement longue avec 46 modules listés exhaustivement. Hiérarchie visuelle faible.", actions: ["Condenser les 46 modules en 6-8 catégories thématiques", "Réorganiser : Problème → Solution → Preuve → Modules → Pricing → FAQ", "Ajouter des ancres de navigation en haut de page"] },
    { id: "trust",     label: "Signaux de confiance", score: 4, maxScore: 10, weight: 1,   summary: "Garantie 14j bien placée, mais bugs de traduction et bilingue chaotique dégradent le sérieux perçu.", actions: ["Ajouter FAQ courte pour les objections principales", "Ajouter un encart fondateur avec photo pour humaniser", "Badge visuel 'Aucune donnée stockée' avec lien privacy"] },
    { id: "urgency",   label: "Urgence / Rareté",    score: 2, maxScore: 10, weight: 1,   summary: "Aucun mécanisme d'urgence ni de rareté. La garantie n'est pas utilisée comme levier d'action.", actions: ["Offre de lancement avec date limite explicite", "Utiliser la garantie 14j comme déclencheur d'urgence positive", "Indicateur de traction actif (X analyses ce mois)"] },
    { id: "mobile",    label: "Mobile & Vitesse",    score: 3, maxScore: 10, weight: 1,   summary: "Ticker, 46 modules en double colonne et contenu bilingue = charge très lourde sur mobile.", actions: ["Modules en accordéon par catégorie sur mobile", "Réduire le ticker à 4-5 actifs max sur mobile", "Tester sur iPhone SE (320px) — CTA visible sans scroll"] },
  ],
  issues: [
    { priority: "critical", title: "Absence totale de preuve sociale", description: "Aucun témoignage, métrique ou logo pour un outil financier demandant confiance et paiement récurrent.", actions: ["Ajouter 3 témoignages courts et authentiques avec profil", "Intégrer une métrique de traction visible", "Afficher les logos des providers API officiels"] },
    { priority: "critical", title: "Page bilingue avec bugs de traduction en production", description: "Clés non résolues (mod.risk-dashboard.label, mod.geo-risk.label) visibles. Contenu doublé surcharge cognitivement.", actions: ["Corriger immédiatement les clés de traduction non résolues", "Créer /fr et /en séparés avec hreflang", "Supprimer les doublons 'AVANT / BEFORE' inline"] },
    { priority: "high",     title: "CTA principal absent au-dessus de la ligne de flottaison", description: "L'utilisateur ne sait pas quoi faire pour commencer sans scroller.", actions: ["Bouton CTA primaire dans le hero (couleur contrastante)", "CTA sticky bas de page avec prix + garantie", "Section pricing avec CTA centré"] },
    { priority: "high",     title: "Ticker crypto distrait du message principal", description: "Le ticker scrollant au-dessus du hero crée une distraction visuelle avant la lecture de la proposition de valeur.", actions: ["Supprimer ou déplacer le ticker hors du hero", "Si conservé : le miniaturiser à un bandeau discret sous la nav"] },
    { priority: "medium",   title: "Liste des 46 modules trop exhaustive", description: "La liste complète noie les messages clés et crée une fatigue de lecture.", actions: ["Regrouper en 6-8 catégories avec lien 'Voir tous les modules'", "Mettre en avant les 5 modules phares en hero-features"] },
    { priority: "medium",   title: "Urgence et rareté absentes", description: "Aucun mécanisme de déclenchement d'action immédiate.", actions: ["Offre de lancement avec date limite", "Compteur d'analyses ou d'utilisateurs actifs"] },
  ],
};

const html = generateExportHTML(exampleData);
const out = resolve(ROOT, "examples", "audit-example.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, "utf-8");
console.log(`✓ Wrote ${out} (${html.length.toLocaleString()} chars)`);
