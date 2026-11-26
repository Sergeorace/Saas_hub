# RESTO-HUB — Bibliothèque de composants web

Composants React accessibles, sans dépendance UI externe, stylés exclusivement par les jetons de
`@resto-hub/design-tokens`. Thème clair/sombre via `<ThemeProvider>` (attribut `data-theme`).

| Composant               | Export                                                                                                   | Points clés                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boutons                 | `Button`                                                                                                 | 7 variantes (`primary`, `secondary`, `outline`, `ghost`, `soft`, `danger`, `danger-soft`), tailles `sm/md/lg`, chargement, icône seule avec libellé accessible, cible 44 px |
| Champs                  | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`                                                      | label associé, hint, erreur `role="alert"`, icône, état requis                                                                                                              |
| Cartes                  | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `StatCard`                                               | surfaces, ombres et statuts                                                                                                                                                 |
| Tableaux                | `DataTable`                                                                                              | en-têtes, tri visuel, états vide/chargement, responsive                                                                                                                     |
| Modales                 | `Modal`                                                                                                  | focus trap, `aria-modal`, fermeture Échap/overlay, titres                                                                                                                   |
| Badges                  | `Badge`, `TableStatusBadge`, `TABLE_STATUS_META`                                                         | 7 tonalités + 6 statuts de table avec libellés FR/EN                                                                                                                        |
| Toasts                  | `ToastProvider`, `useToast`                                                                              | succès/erreur/info/alerte, empilement, fermeture, `aria-live`                                                                                                               |
| Onglets                 | `Tabs`, `tabDomId`, `panelDomId`                                                                         | navigation clavier (flèches, Home/End), `aria-controls`                                                                                                                     |
| Navigation latérale web | `Sidebar`, `AppShell`                                                                                    | groupes, badges, état actif, repli mobile                                                                                                                                   |
| Barre inférieure mobile | `BottomNav`                                                                                              | 4–5 destinations, badge, cible 44 px                                                                                                                                        |
| États vides             | `EmptyState`                                                                                             | icône, titre, description, action de reprise                                                                                                                                |
| Squelettes              | `Skeleton`, `SkeletonText`                                                                               | annoncés `aria-hidden`, formes texte/cercle                                                                                                                                 |
| Divers                  | `Avatar`, `SegmentedControl`, `Logo`, `Icon`                                                             | —                                                                                                                                                                           |
| Thème / i18n            | `ThemeProvider`, `useTheme`, `I18nProvider`, `useI18n`                                                   | clair/sombre persisté, FR/EN                                                                                                                                                |
| Formats                 | `formatXof`, `formatXofCompact`, `formatNumber`, `formatPercent`, `formatDate`, `formatTime`, `initials` | XOF par défaut, formats locaux                                                                                                                                              |

## Règles d'usage

1. Aucune couleur, ombre, rayon ou durée en dur : uniquement les variables `--*`.
2. Chaque écran combine **chargement (squelette), état vide, erreur avec reprise**.
3. Tout bouton icône porte un `aria-label` ; tout champ possède un label visible.
4. Le statut d'une table n'est jamais indiqué par la couleur seule.
5. Les animations respectent `prefers-reduced-motion`.

## Démonstration

La page [`/design`](../../apps/web/src/pages/DesignPage.tsx) présente tous les composants, les
statuts de table, l'échelle typographique et l'espacement, en clair et en sombre, aux largeurs
390 / 768 / 1280 px. `npm run dev:web` puis `/design`.
