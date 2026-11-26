# RESTO-HUB — Design system

Identité moderne, chaleureuse et premium pour la restauration ouest-africaine. Ce document est le
contrat entre le design et le code : toute interface web, PWA ou Flutter consomme ces jetons.

## 1. Identité

- Nom produit : **RESTO-HUB** (wordmark, monogramme « R » dans un cercle piment).
- Ton : chaleureux, direct, professionnel ; aucune imagerie « tech » froide.
- Signature : primaire piment (ambre/terre cuite), secondaire basilic, accent or discret.

## 2. Palette et sémantique

| Rôle | Clair | Sombre | Usage |
|---|---|---|---|
| Primaire | `--pimento-600` `#c2410c` | `#ff8a4c` | actions principales, focus |
| Secondaire | `--basilic-700` `#0c6750` | `#58d9a6` | accents, succès produit |
| Accent | `--gold-400` `#e7b23e` | `#e7b23e` | badges premium, fidélité |
| Fond | `--stone-50` `#faf7f2` | `--stone-950` `#12100e` | pages |
| Surface | `#ffffff` | `#1a1714` | cartes, panneaux |
| Texte | `--stone-900` `#1c1815` | `#f7f2ea` | titres et corps |
| Succès | `#157f3d` | `#43d17a` | confirmation, statut libre |
| Alerte | `#a35a06` | `#fbbf24` | addition demandée, avertissements |
| Erreur | `#b42318` | `#f87171` | erreurs, annulations |
| Info | `#0e7490` | `#67d3e8` | informations neutres |

Contraste : AA vérifié automatiquement (`npm run test:tokens`, minimum 4,70:1 sur les couples
texte/fond). Le mode sombre est obligatoire (bar, cuisine).

## 3. Statuts de table (6)

| Statut | Jeton | Clair | Sombre |
|---|---|---|---|
| Libre | `--table-free` | `#12864a` | `#34d399` |
| Réservée | `--table-reserved` | `#c47a08` | `#fbbf24` |
| Occupée | `--table-occupied` | `#d9480f` | `#fb923c` |
| Addition demandée | `--table-bill` | `#2563eb` | `#60a5fa` |
| À nettoyer | `--table-cleaning` | `#7c3aed` | `#a78bfa` |
| Hors service | `--table-out` | `#78716c` | `#a8a29e` |

Chaque statut expose `-soft`, `-border` et `-ink` pour composer badges, cartes et plan de salle.
Couleur jamais seule : le libellé FR/EN accompagne toujours l'indicateur.

## 4. Typographie

- Titres : `Fraunces` (serif chaleureuse), secours Georgia.
- Texte : `Inter`, secours système.
- Monospace : `JetBrains Mono` (montants, numéros de ticket).
- Échelle : 12, 13, 15, 16, 18, 20, 24, 30, 36, 46, 56 px.
- Interlignes : 1,12 (titres) à 1,65 (texte long) ; tracking serré sur les titres.

## 5. Espacements et rayons

- Base 4 px : 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96 px.
- Rayons : 6 à 36 px, `999px` pour les pastilles.
- Cible tactile minimale : 44 px ; hauteur de barre inférieure : 68 px.
- Conteneurs : 74 rem (standard), 56 rem (étroit).

## 6. Mouvement

- Durées : 120 ms (micro), 200 ms (base), 320 ms (panneaux), 620 ms (révélation).
- Courbes : `cubic-bezier(0.2, 0.7, 0.2, 1)` standard, `cubic-bezier(0.16, 1, 0.3, 1)` sortie.
- Animations discrètes, jamais bloquantes ; `prefers-reduced-motion` neutralise les durées.

## 7. Thème par établissement

`[data-tenant]` surcharge primaire, secondaire, focus et surfaces associées. Deux exemples livrés
(`le-baobab`, `lagune`), en clair et en sombre. Le logo de l'établissement remplace le wordmark dans
l'espace client ; les couleurs ne doivent jamais dégrader le contraste AA.

## 8. Sources

- CSS : [`tokens.css`](./tokens.css)
- TS : [`src/tokens.ts`](./src/tokens.ts)
- JSON (Flutter, outils) : [`tokens.json`](./tokens.json)
- Thème Flutter : `apps/mobile/lib/theme/`
- Générateurs : `scripts/generate.mjs` (CSS → JSON/TS), `scripts/contrast.mjs` (AA),
  `scripts/flutter.mjs` (Dart).

Toute modification de jeton se fait dans `tokens.css`, puis `npm run tokens` et
`npm run flutter:theme`; la CI refuse un jeton non régénéré (`tokens:check`) ou un contraste < 4,5:1.
