import { useState } from 'react';
import {
  Badge,
  BottomNav,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Logo,
  Modal,
  Select,
  Skeleton,
  SkeletonText,
  StatCard,
  Switch,
  TABLE_STATUS_META,
  TABLE_STATUS_ORDER,
  TableStatusBadge,
  Tabs,
  Textarea,
  ToastProvider,
  useTheme,
  useToast,
  type TableStatus,
} from '@resto-hub/design-system';
import './../styles/design.css';

const SWATCHES = [
  ['Primaire', '--primary'],
  ['Secondaire', '--secondary'],
  ['Accent', '--accent'],
  ['Succès', '--success'],
  ['Alerte', '--warning'],
  ['Erreur', '--danger'],
  ['Info', '--info'],
  ['Fond', '--bg'],
  ['Surface', '--surface'],
  ['Texte', '--ink'],
] as const;

const TYPE_SCALE = [
  ['6xl', '3.5rem', '56'],
  ['5xl', '2.875rem', '46'],
  ['4xl', '2.25rem', '36'],
  ['3xl', '1.875rem', '30'],
  ['2xl', '1.5rem', '24'],
  ['xl', '1.25rem', '20'],
  ['lg', '1.125rem', '18'],
  ['md', '1rem', '16'],
  ['base', '0.9375rem', '15'],
  ['sm', '0.8125rem', '13'],
  ['xs', '0.75rem', '12'],
] as const;

const ROWS = [
  {
    id: 'cmd-1042',
    table: 'LOME01-SAL-004',
    items: 3,
    total: 18500,
    status: 'occupied' as TableStatus,
  },
  {
    id: 'cmd-1043',
    table: 'LOME01-TER-014',
    items: 2,
    total: 9000,
    status: 'bill' as TableStatus,
  },
  {
    id: 'cmd-1044',
    table: 'LOME01-BAR-002',
    items: 5,
    total: 27000,
    status: 'reserved' as TableStatus,
  },
];

const xof = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'XOF',
  maximumFractionDigits: 0,
}).format;

function Section({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="design-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="design-section__head">
        <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

function DemoGrid({ children }: { children: React.ReactNode }) {
  return <div className="design-grid">{children}</div>;
}

function ComponentsShowcase() {
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState('salle');
  const [modalOpen, setModalOpen] = useState(false);
  const [segment, setSegment] = useState<'jour' | 'semaine'>('jour');

  return (
    <div className="design-page">
      <header className="design-hero">
        <div className="design-hero__brand">
          <Logo />
          <div>
            <span className="design-eyebrow">Design system · v0.1.0</span>
            <h1>Composants, jetons et états</h1>
            <p>
              Vitrine unique en clair et en sombre, largeurs 390 / 768 / 1280 px. Chaque composant
              provient de <code>@resto-hub/design-system</code> et consomme les jetons.
            </p>
          </div>
        </div>
        <div className="design-hero__actions">
          <Button
            variant="outline"
            iconLeft={theme === 'dark' ? 'sun' : 'moon'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          </Button>
          <a className="rh-btn rh-btn--ghost" href="/">
            Retour à l'accueil
          </a>
        </div>
      </header>

      <nav className="design-toc" aria-label="Sommaire du design system">
        {[
          ['couleurs', 'Couleurs'],
          ['typographie', 'Typographie'],
          ['espacements', 'Espacements'],
          ['boutons', 'Boutons'],
          ['champs', 'Champs'],
          ['cartes', 'Cartes'],
          ['statuts', 'Statuts'],
          ['tableaux', 'Tableaux'],
          ['navigation', 'Navigation'],
          ['retours', 'Retours'],
          ['etats', 'États'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <Section
        id="couleurs"
        title="Couleurs"
        description="Palette sémantique, contrastes AA vérifiés automatiquement."
      >
        <div className="design-swatches">
          {SWATCHES.map(([label, token]) => (
            <div className="design-swatch" key={token}>
              <span className="design-swatch__chip" style={{ background: `var(${token})` }} />
              <strong>{label}</strong>
              <code>{token}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="typographie"
        title="Typographie"
        description="Fraunces pour les titres, Inter pour le texte, échelle 12 → 56 px."
      >
        <div className="design-type">
          <div className="design-type__sample" style={{ fontFamily: 'var(--font-display)' }}>
            <span style={{ fontSize: 'var(--text-6xl)' }}>Sahel Grill</span>
            <code>display · 56 px</code>
          </div>
          <div className="design-type__scale">
            {TYPE_SCALE.map(([name, size, px]) => (
              <div key={name} className="design-type__row">
                <code>{name}</code>
                <span style={{ fontSize: size }}>Commande prête en cuisine — {px} px</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="espacements"
        title="Espacements et rayons"
        description="Base 4 px, cible tactile 44 px."
      >
        <div className="design-space">
          {[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24].map((step) => (
            <div key={step} className="design-space__item">
              <span
                style={{
                  width: `var(--space-${step})`,
                  height: '1rem',
                  background: 'var(--primary)',
                }}
              />
              <code>space-{step}</code>
            </div>
          ))}
        </div>
        <div className="design-radii">
          {['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'].map((radius) => (
            <span
              key={radius}
              className="design-radius"
              style={{ borderRadius: `var(--radius-${radius})` }}
            >
              {radius}
            </span>
          ))}
        </div>
      </Section>

      <Section
        id="boutons"
        title="Boutons"
        description="Sept variantes, trois tailles, état de chargement et icône seule."
      >
        <DemoGrid>
          <Button>Encaisser</Button>
          <Button variant="secondary">Ajouter</Button>
          <Button variant="outline">Filtrer</Button>
          <Button variant="ghost">Ignorer</Button>
          <Button variant="soft">Dupliquer</Button>
          <Button variant="danger">Annuler la commande</Button>
          <Button variant="danger-soft">Rembourser</Button>
          <Button loading>Envoi…</Button>
          <Button size="sm">Petit</Button>
          <Button size="lg" iconLeft="plus">
            Grande action
          </Button>
          <Button iconOnly iconLeft="settings" aria-label="Réglages" variant="outline" />
        </DemoGrid>
      </Section>

      <Section
        id="champs"
        title="Champs"
        description="Labels associés, indices, erreurs annoncées, icônes."
      >
        <div className="design-fields">
          <Input label="Nom de l'établissement" placeholder="Sahel Grill" leadingIcon="home" />
          <Input
            label="Téléphone"
            placeholder="+228 90 00 00 00"
            error="Numéro invalide : 8 chiffres attendus."
            required
          />
          <Select
            label="Zone"
            options={[
              { value: 'salle', label: 'Salle' },
              { value: 'terrasse', label: 'Terrasse' },
              { value: 'bar', label: 'Bar' },
            ]}
          />
          <Textarea label="Note de commande" hint="Allergies, cuisson, préférences." rows={3} />
          <Checkbox label="Commande à emporter" defaultChecked />
          <Switch label="Disponible en ligne" defaultChecked />
        </div>
      </Section>

      <Section id="cartes" title="Cartes et statistiques">
        <div className="design-cards">
          <StatCard
            label="Chiffre d'affaires (jour)"
            value={xof(458000)}
            icon="chart"
            delta={{ value: '+12,4 %', direction: 'up' }}
            meta="vs hier"
          />
          <StatCard label="Tickets" value="126" icon="receipt" meta="panier moyen 3 635 F" />
          <Card>
            <CardHeader title="Sahel Grill" action={<Badge tone="success">Pro</Badge>} />
            <CardBody>
              <p>Établissement de démonstration, menu actif et plan de salle configuré.</p>
            </CardBody>
            <CardFooter>
              <Button size="sm" variant="outline">
                Ouvrir
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section
        id="statuts"
        title="Badges et statuts de table"
        description="Six statuts, libellés FR/EN, couleur jamais seule."
      >
        <DemoGrid>
          <Badge tone="neutral">Neutre</Badge>
          <Badge tone="primary">Principal</Badge>
          <Badge tone="success" dot>
            Succès
          </Badge>
          <Badge tone="warning" icon="alert">
            Alerte
          </Badge>
          <Badge tone="danger">Erreur</Badge>
          <Badge tone="info" live>
            Info
          </Badge>
          <Badge tone="accent">Premium</Badge>
        </DemoGrid>
        <div className="design-statuses">
          {TABLE_STATUS_ORDER.map((status) => (
            <div key={status} className="design-status">
              <TableStatusBadge status={status} />
              <code>{TABLE_STATUS_META[status].labelEn}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="tableaux"
        title="Tableaux"
        description="Données XOF, en-têtes alignés, caption accessible."
      >
        <DataTable
          caption="Commandes en cours"
          rows={ROWS}
          getRowId={(row) => row.id}
          columns={[
            { key: 'id', header: 'Commande', render: (row) => <code>{row.id}</code> },
            { key: 'table', header: 'Place', render: (row) => row.table },
            { key: 'items', header: 'Articles', render: (row) => row.items, align: 'right' },
            { key: 'total', header: 'Total', render: (row) => xof(row.total), align: 'right' },
            {
              key: 'status',
              header: 'Statut',
              render: (row) => <TableStatusBadge status={row.status} />,
            },
          ]}
        />
      </Section>

      <Section id="navigation" title="Onglets et navigation">
        <Tabs
          ariaLabel="Sections de démonstration"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'salle', label: 'Salle', icon: 'grid', badge: 6 },
            { id: 'cuisine', label: 'Cuisine', icon: 'chef', badge: 2 },
            { id: 'caisse', label: 'Caisse', icon: 'wallet' },
          ]}
        />
        <div className="design-segment">
          {(['jour', 'semaine'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={segment === value ? 'primary' : 'outline'}
              onClick={() => setSegment(value)}
            >
              {value === 'jour' ? 'Jour' : 'Semaine'}
            </Button>
          ))}
        </div>

        <div className="design-nav-demo">
          <div className="design-nav-demo__sidebar">
            <SidebarPreview active={tab} onSelect={setTab} />
          </div>
          <div className="design-nav-demo__phone">
            <BottomNav
              items={[
                {
                  id: 'salle',
                  label: 'Salle',
                  icon: 'grid',
                  active: tab === 'salle',
                  onClick: () => setTab('salle'),
                },
                {
                  id: 'cuisine',
                  label: 'Cuisine',
                  icon: 'chef',
                  active: tab === 'cuisine',
                  badge: 2,
                  onClick: () => setTab('cuisine'),
                },
                {
                  id: 'caisse',
                  label: 'Caisse',
                  icon: 'wallet',
                  active: tab === 'caisse',
                  onClick: () => setTab('caisse'),
                },
                { id: 'equipe', label: 'Équipe', icon: 'users' },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="retours" title="Modales et toasts">
        <DemoGrid>
          <Button onClick={() => setModalOpen(true)}>Ouvrir une modale</Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.push({
                title: 'Commande encaissée',
                description: '18 500 F enregistrés sur la table SAL-004.',
                tone: 'success',
              })
            }
          >
            Toast succès
          </Button>
          <Button
            variant="danger-soft"
            onClick={() =>
              toast.push({
                title: 'Paiement refusé',
                description: 'Nouvelle tentative possible avec un autre moyen.',
                tone: 'error',
              })
            }
          >
            Toast erreur
          </Button>
        </DemoGrid>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Fermer la table SAL-004 ?"
          description="L'addition est réglée. La table passera en « à nettoyer »."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Annuler
              </Button>
              <Button onClick={() => setModalOpen(false)}>Confirmer</Button>
            </>
          }
        >
          <p>Cette action est journalisée dans l'audit du service floor.</p>
        </Modal>
      </Section>

      <Section
        id="etats"
        title="États vide, chargement et erreur"
        description="Chaque écran couvre ces trois états."
      >
        <div className="design-states">
          <Card>
            <CardBody>
              <EmptyState
                icon="sparkles"
                title="Aucune commande ce matin"
                description="Les commandes apparaîtront ici dès la première table ouverte."
                action={<Button size="sm">Ouvrir une table</Button>}
              />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="design-loading">
                <Skeleton width="40%" height="1.25rem" />
                <SkeletonText lines={3} />
                <div className="design-loading__row">
                  <Skeleton width="2.75rem" height="2.75rem" circle />
                  <SkeletonText lines={2} />
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="rh-card rh-card--padded" role="alert">
                <h3>Connexion perdue</h3>
                <p>
                  La caisse fonctionne hors ligne ; les ventes seront synchronisées au retour du
                  réseau.
                </p>
                <Button size="sm" iconLeft="refresh">
                  Réessayer
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section
        title="Thème d'établissement"
        description="Le client final voit les couleurs et le logo de l'établissement."
      >
        <div className="design-tenants">
          <div data-tenant="le-baobab" className="design-tenant-card">
            <span className="design-eyebrow">Le Baobab</span>
            <h3>Menu du jour</h3>
            <Button size="sm">Commander</Button>
          </div>
          <div data-tenant="lagune" className="design-tenant-card">
            <span className="design-eyebrow">Lagune</span>
            <h3>Cocktails</h3>
            <Button size="sm">Découvrir</Button>
          </div>
        </div>
      </Section>

      <div data-theme="dark" className="design-dark-block">
        <div className="design-dark-block__head">
          <Icon name="moon" size="lg" />
          <div>
            <span className="design-eyebrow">Mode sombre</span>
            <h2>Le même système, pour la salle le soir</h2>
          </div>
        </div>
        <ComponentsMini />
      </div>

      <Section title="Mode sombre — statuts et navigation">
        <div data-theme="dark" className="design-dark-panel">
          <div className="design-statuses">
            {TABLE_STATUS_ORDER.map((status) => (
              <TableStatusBadge key={status} status={status} />
            ))}
          </div>
          <div className="design-dark-panel__nav">
            <Button>Encaisser</Button>
            <Badge tone="success">Service en cours</Badge>
            <Switch label="Mode sombre permanent" />
          </div>
        </div>
      </Section>

      <footer className="design-footer">
        <strong>RESTO-HUB</strong> · jetons v0.2.0 · XOF · FR/EN · cibles 44 px · contrastes AA
      </footer>
    </div>
  );
}

function ComponentsMini() {
  const toast = useToast();
  return (
    <div className="design-mini">
      <Button>Valider</Button>
      <Button variant="outline">Modifier</Button>
      <Badge tone="warning">Addition demandée</Badge>
      <Input label="Recherche" placeholder="Table, serveur, ticket…" leadingIcon="search" />
      <Button
        size="sm"
        variant="soft"
        onClick={() => toast.push({ title: 'Mode sombre vérifié', tone: 'info' })}
      >
        Tester un toast
      </Button>
    </div>
  );
}

function SidebarPreview({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <div className="rh-sidebar" style={{ position: 'static', height: '100%' }}>
      <div className="rh-sidebar__brand">
        <Logo />
      </div>
      <nav aria-label="Navigation de démonstration" className="rh-stack">
        {[
          { id: 'salle', label: 'Plan de salle', icon: 'grid' as const },
          { id: 'cuisine', label: 'Cuisine', icon: 'chef' as const, badge: 2 },
          { id: 'caisse', label: 'Caisse', icon: 'wallet' as const },
          { id: 'equipe', label: 'Équipe', icon: 'users' as const },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rh-nav-item${active === item.id ? ' is-active' : ''}`}
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className="rh-nav-item__icon">
              <Icon name={item.icon} size="sm" />
            </span>
            <span>{item.label}</span>
            {item.badge && <span className="rh-nav-item__badge">{item.badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function DesignPage() {
  return (
    <ToastProvider>
      <ComponentsShowcase />
    </ToastProvider>
  );
}
