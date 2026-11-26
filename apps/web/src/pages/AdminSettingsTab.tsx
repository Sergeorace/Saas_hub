import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  Select,
  SkeletonText,
  formatDate,
  useI18n,
  useToast,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  platformAdminApi,
  type PlatformAuditEntry,
  type PlatformCountrySetting,
  type PlatformProviderSetting,
  type PlatformSettingsData,
  type PlatformTaxSetting,
} from '../lib/api';

interface Props {
  locale: Locale;
}

export function AdminSettingsTab({ locale }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [settings, setSettings] = useState<PlatformSettingsData | null>(null);
  const [audit, setAudit] = useState<{ valid: boolean; length: number } | null>(null);
  const [entries, setEntries] = useState<PlatformAuditEntry[]>([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSaveError(null);
    try {
      const [settingsResult, auditResult] = await Promise.all([
        platformAdminApi.settings(),
        platformAdminApi.audit(30),
      ]);
      setSettings(settingsResult.settings);
      setOriginal(JSON.stringify(settingsResult.settings));
      setAudit(settingsResult.audit);
      setEntries(auditResult.entries);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => (settings ? JSON.stringify(settings) !== original : false),
    [settings, original],
  );

  const patch = (updater: (current: PlatformSettingsData) => PlatformSettingsData) => {
    setSettings((current) => (current ? updater(current) : current));
    setSaveError(null);
  };

  const toggleLanguage = (language: 'fr' | 'en') => {
    patch((current) => {
      const has = current.languages.includes(language);
      if (has && current.languages.length === 1) return current;
      const languages = has
        ? current.languages.filter((entry) => entry !== language)
        : ([...current.languages, language] as Array<'fr' | 'en'>);
      return {
        ...current,
        languages,
        defaultLanguage: languages.includes(current.defaultLanguage)
          ? current.defaultLanguage
          : languages[0],
      };
    });
  };

  const toggleProvider = (code: string) => {
    patch((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.code === code ? { ...provider, enabled: !provider.enabled } : provider,
      ),
    }));
  };

  const toggleCountry = (code: string) => {
    patch((current) => ({
      ...current,
      countries: current.countries.map((country) =>
        country.code === code ? { ...country, active: !country.active } : country,
      ),
    }));
  };

  const updateTax = (code: string, changes: Partial<PlatformTaxSetting>) => {
    patch((current) => ({
      ...current,
      taxes: current.taxes.map((tax) => (tax.code === code ? { ...tax, ...changes } : tax)),
    }));
  };

  const save = async () => {
    if (!settings) return;
    if (!settings.providers.some((provider) => provider.enabled)) {
      setSaveError(t('adminSettings.providersHint'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await platformAdminApi.updateSettings(settings);
      setSettings(result.settings);
      setOriginal(JSON.stringify(result.settings));
      toast.push({ title: t('adminSettings.saved') });
      const auditResult = await platformAdminApi.audit(30);
      setEntries(auditResult.entries);
      setAudit(auditResult.chain);
    } catch (cause) {
      setSaveError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const countryColumns: Array<Column<PlatformCountrySetting>> = [
    {
      key: 'country',
      header: t('adminSettings.colCountry'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.code}</span>
        </div>
      ),
    },
    { key: 'currency', header: t('adminSettings.colCurrency'), render: (row) => row.currency },
    { key: 'dial', header: t('adminSettings.colDial'), render: (row) => row.dialCode },
    {
      key: 'tax',
      header: t('adminSettings.colDefaultTax'),
      render: (row) => <span className="console-muted">{row.defaultTaxCode}</span>,
    },
    {
      key: 'active',
      header: t('adminSettings.colActive'),
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={row.active ? 'soft' : 'outline'}
          aria-pressed={row.active}
          onClick={() => toggleCountry(row.code)}
        >
          {row.active ? t('adminSettings.enabled') : t('adminSettings.disabled')}
        </Button>
      ),
    },
  ];

  const taxColumns: Array<Column<PlatformTaxSetting>> = [
    {
      key: 'name',
      header: t('adminSettings.colTaxName'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.code}</span>
        </div>
      ),
    },
    {
      key: 'scope',
      header: t('adminSettings.colScope'),
      render: (row) => <Badge tone="neutral">{t(`adminSettings.scope_${row.scope}`)}</Badge>,
    },
    {
      key: 'rate',
      header: t('adminSettings.colRate'),
      align: 'right',
      render: (row) => (
        <Input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={row.ratePct}
          aria-label={`${t('adminSettings.colRate')} — ${row.name}`}
          style={{ width: '6.5rem' }}
          onChange={(event) => updateTax(row.code, { ratePct: Number(event.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'active',
      header: t('adminSettings.colActive'),
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={row.active ? 'soft' : 'outline'}
          aria-pressed={row.active}
          onClick={() => updateTax(row.code, { active: !row.active })}
        >
          {row.active ? t('adminSettings.enabled') : t('adminSettings.disabled')}
        </Button>
      ),
    },
  ];

  const providerColumns: Array<Column<PlatformProviderSetting>> = [
    {
      key: 'provider',
      header: t('adminSettings.colProvider'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.code}</span>
        </div>
      ),
    },
    {
      key: 'channels',
      header: t('adminSettings.colChannels'),
      render: (row) => <span className="console-muted">{row.channels.join(' · ')}</span>,
    },
    {
      key: 'priority',
      header: t('adminSettings.colPriority'),
      align: 'right',
      render: (row) => row.priority,
    },
    {
      key: 'enabled',
      header: t('adminSettings.colActive'),
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={row.enabled ? 'soft' : 'outline'}
          aria-pressed={row.enabled}
          onClick={() => toggleProvider(row.code)}
        >
          {row.enabled ? t('adminSettings.enabled') : t('adminSettings.disabled')}
        </Button>
      ),
    },
  ];

  const auditColumns: Array<Column<PlatformAuditEntry>> = [
    {
      key: 'action',
      header: t('adminSettings.colAction'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.action}</strong>
          <span>
            {row.targetType} · {row.targetId}
          </span>
        </div>
      ),
    },
    {
      key: 'actor',
      header: t('adminSettings.colActor'),
      render: (row) => <span className="console-muted">{row.actorId}</span>,
    },
    {
      key: 'at',
      header: t('adminSettings.colAt'),
      align: 'right',
      render: (row) => (
        <span className="console-muted">
          {formatDate(row.createdAt, locale, {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={8} />
        </CardBody>
      </Card>
    );
  }

  if (error || !settings) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon="alert"
            title={t('adminSettings.errorTitle')}
            description={error ?? t('adminSettings.loadError')}
            action={
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('adminSettings.reload')}
              </Button>
            }
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="console-stack">
      <Card>
        <CardHeader
          title={t('adminSettings.title')}
          subtitle={t('adminSettings.subtitle')}
          action={
            <div className="console-toolbar" style={{ margin: 0 }}>
              {dirty && (
                <Badge tone="warning" dot>
                  {t('adminSettings.unsaved')}
                </Badge>
              )}
              <Button size="sm" variant="outline" iconLeft="refresh" onClick={() => void load()}>
                {t('adminSettings.reload')}
              </Button>
              <Button
                size="sm"
                iconLeft="check"
                onClick={() => void save()}
                loading={saving}
                disabled={!dirty}
              >
                {saving ? t('adminSettings.saving') : t('adminSettings.save')}
              </Button>
            </div>
          }
        />
        <CardBody>
          <p className="console-muted">
            {t('adminSettings.updatedAt')} : {formatDate(settings.updatedAt, locale)} ·{' '}
            {t('adminSettings.updatedBy')} {settings.updatedBy}
          </p>
          {saveError && (
            <p className="auth-error" role="alert">
              {t('adminSettings.saveError')} — {saveError}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="console-2col">
        <Card>
          <CardHeader
            title={t('adminSettings.languagesTitle')}
            subtitle={t('adminSettings.languagesHint')}
          />
          <CardBody>
            <div className="console-toolbar" style={{ margin: 0 }}>
              {(['fr', 'en'] as const).map((language) => {
                const active = settings.languages.includes(language);
                return (
                  <Button
                    key={language}
                    size="sm"
                    variant={active ? 'soft' : 'outline'}
                    aria-pressed={active}
                    onClick={() => toggleLanguage(language)}
                  >
                    {language === 'fr' ? t('adminSettings.langFr') : t('adminSettings.langEn')}
                  </Button>
                );
              })}
            </div>
            <Select
              label={t('adminSettings.defaultLanguage')}
              value={settings.defaultLanguage}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  defaultLanguage: event.target.value as 'fr' | 'en',
                }))
              }
              options={settings.languages.map((language) => ({
                value: language,
                label: language === 'fr' ? t('adminSettings.langFr') : t('adminSettings.langEn'),
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('adminSettings.supportTitle')} />
          <CardBody>
            <div className="console-stack">
              <Input
                label={t('adminSettings.supportEmail')}
                type="email"
                value={settings.supportEmail}
                onChange={(event) =>
                  patch((current) => ({ ...current, supportEmail: event.target.value }))
                }
              />
              <Input
                label={t('adminSettings.supportPhone')}
                type="tel"
                value={settings.supportPhone}
                onChange={(event) =>
                  patch((current) => ({ ...current, supportPhone: event.target.value }))
                }
              />
              <div className="console-2col">
                <Input
                  label={t('adminSettings.timezone')}
                  value={settings.timezone}
                  onChange={(event) =>
                    patch((current) => ({ ...current, timezone: event.target.value }))
                  }
                />
                <Input
                  label={t('adminSettings.currency')}
                  value={settings.currency}
                  readOnly
                  disabled
                />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t('adminSettings.countriesTitle')}
          subtitle={t('adminSettings.countriesHint')}
        />
        <CardBody>
          <DataTable
            columns={countryColumns}
            rows={settings.countries}
            getRowId={(row) => row.code}
            caption={t('adminSettings.countriesTitle')}
          />
        </CardBody>
      </Card>

      <div className="console-2col">
        <Card>
          <CardHeader
            title={t('adminSettings.taxesTitle')}
            subtitle={t('adminSettings.taxesHint')}
          />
          <CardBody>
            <DataTable
              columns={taxColumns}
              rows={settings.taxes}
              getRowId={(row) => row.code}
              caption={t('adminSettings.taxesTitle')}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t('adminSettings.providersTitle')}
            subtitle={t('adminSettings.providersHint')}
          />
          <CardBody>
            <DataTable
              columns={providerColumns}
              rows={settings.providers}
              getRowId={(row) => row.code}
              caption={t('adminSettings.providersTitle')}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t('adminSettings.auditTitle')}
          subtitle={t('adminSettings.auditSubtitle')}
          action={
            audit ? (
              <Badge tone={audit.valid ? 'success' : 'danger'} dot>
                {audit.valid ? t('adminSupervision.chainOk') : t('adminSupervision.chainBroken')}
              </Badge>
            ) : undefined
          }
        />
        <CardBody>
          {entries.length === 0 ? (
            <p className="console-muted">{t('adminSettings.auditEmpty')}</p>
          ) : (
            <DataTable
              columns={auditColumns}
              rows={entries}
              getRowId={(row) => row.id}
              caption={t('adminSettings.auditTitle')}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
