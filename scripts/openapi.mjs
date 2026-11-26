#!/usr/bin/env node
/**
 * Génère la documentation OpenAPI 3.1 de chaque service à partir des tables de routes.
 * Tant que les services tournent sur le kit HTTP maison, la source de vérité des routes
 * reste `services/<nom>/src/app.ts`; la migration NestJS remplacera ce générateur par
 * un export natif OpenAPI.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'docs', 'openapi');

const SERVICES = [
  ['identity-service', 4001, 'Authentification, sessions, MFA, RBAC, audit.'],
  ['tenant-service', 4002, 'Établissements, KYC/KYB, multi-sites, abonnements SaaS.'],
  ['catalog-service', 4003, 'Produits, catégories, variantes, menus, promotions.'],
  ['floor-service', 4004, 'Zones, plan de salle, tables, QR, réservations.'],
  ['order-service', 4005, 'Paniers, commandes, workflow, KDS, caisse (POS).'],
  ['payment-service', 4006, 'Agrégateur de paiement, portefeuille, reversements, commissions, litiges.'],
  ['staff-service', 4007, 'Employés, plannings, pointage, performances, audit.'],
  ['payroll-service', 4008, 'Paie mensuelle, bulletins, paiements groupés à double validation.'],
  ['inventory-service', 4009, 'Stocks, fiches techniques, inventaires, pertes, fournisseurs.'],
  ['loyalty-marketing-service', 4010, 'Fidélité, codes promo, campagnes, avis clients.'],
  ['notification-service', 4011, 'Push, SMS, e-mail, notifications temps réel.'],
  ['reporting-service', 4012, 'Tableaux de bord, rapports PDF/Excel/CSV, exports.'],
  ['platform-admin-service', 4013, 'Supervision, litiges, paramètres globaux, journaux techniques.'],
];

function parseTableMap(source) {
  const map = {};
  const block = source.match(/const TABLE = \{([\s\S]*?)\} as const;/);
  if (!block) return map;
  for (const match of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) map[match[1]] = match[2];
  return map;
}

function parseRoutes(source) {
  const table = parseTableMap(source);
  const lines = source.split(/\r?\n/);
  const routes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const method = lines[index].match(/method: '(GET|POST|PUT|PATCH|DELETE)',/);
    if (!method) continue;
    const pathLine = lines[index + 1] ?? '';
    const literal = pathLine.match(/path: '([^']+)',/);
    const constant = pathLine.match(/path: TABLE\.(\w+),/);
    const path = literal ? literal[1] : constant ? table[constant[1]] : null;
    if (!path) continue;
    const window = lines.slice(index + 2, index + 45).join('\n');
    const boundary = window.indexOf("method: '");
    const scope = boundary >= 0 ? window.slice(0, boundary) : window;
    routes.push({
      method: method[1].toLowerCase(),
      path,
      publicRoute: /auth: false/.test(scope),
      internal: /service: true/.test(scope),
    });
  }
  return routes;
}

const describe = (route) => {
  if (route.internal) return 'Appel inter-service (clé interne, hors contrat public).';
  if (route.path.startsWith('/health')) return 'Sonde de disponibilité.';
  if (route.publicRoute) return 'Endpoint public (espace client, QR de table).';
  return 'Endpoint authentifié (JWT + permission fine évaluée côté service).';
};

function operation(route, service) {
  return {
    operationId: `${route.method}_${route.path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    tags: [route.internal ? 'internal' : route.publicRoute ? 'public' : 'authenticated'],
    summary: `${route.method.toUpperCase()} ${route.path}`,
    description: describe(route),
    security: route.internal
      ? [{ internalKey: [] }]
      : route.publicRoute
        ? []
        : [{ bearerAuth: [] }],
    'x-service': service,
    responses: {
      200: { description: 'Succès (corps conforme au contrat du service).' },
      400: { description: 'Requête invalide (validation d’entrée).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      401: { description: 'Authentification requise ou invalide.' },
      403: { description: 'Permission insuffisante ou accès inter-tenant refusé.' },
      404: { description: 'Ressource inexistante.' },
      409: { description: 'Conflit métier (état incompatible).' },
      422: { description: 'Règle métier non satisfaite.' },
      429: { description: 'Limitation de débit.' },
    },
  };
}

function buildSpec(service, port, description) {
  const source = readFileSync(join(root, 'services', service, 'src', 'app.ts'), 'utf8');
  const routes = parseRoutes(source);
  const paths = {};
  for (const route of routes) {
    const key = route.path.replace(/:(\w+)/g, '{$1}');
    paths[key] = paths[key] ?? {};
    paths[key][route.method] = operation(route, service);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `RESTO-HUB — ${service}`,
      version: '0.2.0',
      description:
        `${description}\n\nContrat public en HTTP/JSON, devise XOF, locales fr/en. ` +
        'Les événements métier correspondants sont documentés dans docs/architecture.md.',
      contact: { name: 'Équipe RESTO-HUB', email: 'support@resto-hub.tg' },
    },
    servers: [
      { url: `http://localhost:${port}`, description: 'Développement local' },
      { url: `https://${service}.resto-hub.tg`, description: 'Cible (placeholder de déploiement)' },
    ],
    tags: [
      { name: 'authenticated', description: 'JWT + permissions fines.' },
      { name: 'public', description: 'Sans authentification (client final, QR).' },
      { name: 'internal', description: 'Inter-services, clé interne + réseau privé.' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        internalKey: { type: 'apiKey', in: 'header', name: 'x-internal-key' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'validation_error' },
                message: { type: 'string' },
                field: { type: 'string' },
              },
            },
          },
        },
      },
    },
    'x-route-count': routes.length,
  };
}

const check = process.argv.includes('--check');
mkdirSync(outputDir, { recursive: true });
const index = { source: 'services/<nom>-service/src/app.ts', services: [] };
let stale = false;
let total = 0;

for (const [service, port, description] of SERVICES) {
  const spec = buildSpec(service, port, description);
  total += spec['x-route-count'];
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  const target = join(outputDir, `${service}.json`);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== json) {
      console.error(`Spec désynchronisée : docs/openapi/${service}.json — lancez npm run openapi.`);
      stale = true;
    }
  } else {
    writeFileSync(target, json);
  }
  index.services.push({
    service,
    port,
    routes: spec['x-route-count'],
    spec: `docs/openapi/${service}.json`,
    url: `http://localhost:${port}`,
  });
}

const indexPath = join(outputDir, 'index.json');
const indexJson = `${JSON.stringify(index, null, 2)}\n`;
if (check) {
  if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== indexJson) {
    console.error('Index OpenAPI désynchronisé — lancez npm run openapi.');
    stale = true;
  }
  if (stale) process.exit(1);
  console.log(`OpenAPI à jour — ${SERVICES.length} services, ${total} routes.`);
} else {
  writeFileSync(indexPath, indexJson);
  console.log(`OpenAPI généré — ${SERVICES.length} services, ${total} routes dans docs/openapi/.`);
}
