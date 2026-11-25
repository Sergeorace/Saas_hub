import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Input,
  Logo,
  SegmentedControl,
  Select,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useTheme,
  type Locale,
} from '@resto-hub/design-system';
import { useToast } from '@resto-hub/design-system';
import { navigate } from '../lib/router';
import {
  ApiError,
  errorMessage,
  tenantApi,
  type Application,
  type ApplicationStatus,
  type EstablishmentHours,
  type Plan,
  type PlanCode,
} from '../lib/api';

const DRAFT_KEY = 'restohub.applicationDraft';
const POINTER_KEY = 'restohub.application';

const FALLBACK_PLANS: Plan[] = [
  { code: 'starter', name: 'Starter', priceXof: 15000, maxSites: 1, maxEmployees: 5 },
  { code: 'pro', name: 'Pro', priceXof: 35000, maxSites: 3, maxEmployees: 25, highlight: true },
  { code: 'enterprise', name: 'Entreprise', priceXof: 75000, maxSites: 99, maxEmployees: 999 },
];

const DAYS = [
  { key: 'lun', labelFr: 'Lundi', labelEn: 'Monday' },
  { key: 'mar', labelFr: 'Mardi', labelEn: 'Tuesday' },
  { key: 'mer', labelFr: 'Mercredi', labelEn: 'Wednesday' },
  { key: 'jeu', labelFr: 'Jeudi', labelEn: 'Thursday' },
  { key: 'ven', labelFr: 'Vendredi', labelEn: 'Friday' },
  { key: 'sam', labelFr: 'Samedi', labelEn: 'Saturday' },
  { key: 'dim', labelFr: 'Dimanche', labelEn: 'Sunday' },
];

interface Pointer {
  applicationId: string;
  applicationToken: string;
  reference: string;
}

interface FormState {
  brandName: string;
  legalName: string;
  type: 'restaurant' | 'bar' | 'both';
  nif: string;
  rccm: string;
  description: string;
  logoUrl: string;
  photos: string[];
  district: string;
  city: string;
  street: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  password: string;
  confirmPassword: string;
  plan: PlanCode;
  languages: string[];
  currency: string;
}

const EMPTY_FORM: FormState = {
  brandName: '',
  legalName: '',
  type: 'restaurant',
  nif: '',
  rccm: '',
  description: '',
  logoUrl: '',
  photos: [],
  district: '',
  city: 'Lomé',
  street: '',
  contactPhone: '',
  contactEmail: '',
  website: '',
  managerName: '',
  managerEmail: '',
  managerPhone: '',
  password: '',
  confirmPassword: '',
  plan: 'pro',
  languages: ['fr', 'en'],
  currency: 'XOF',
};

function defaultHours(): EstablishmentHours[] {
  return DAYS.map((day) => ({
    day: day.key,
    open: '11:00',
    close: '23:00',
    closed: day.key === 'dim',
  }));
}

type DocType = 'nif' | 'rccm' | 'id_card';
type UploadedDoc = { fileName: string; sizeBytes: number; uploadedAt?: string };

function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

function statusTone(status: ApplicationStatus): 'neutral' | 'warning' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'submitted':
      return 'warning';
    case 'info_requested':
      return 'info';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function RegisterPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();

  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hours, setHours] = useState<EstablishmentHours[]>(defaultHours);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [documents, setDocuments] = useState<Partial<Record<DocType, UploadedDoc>>>({});
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitted, setSubmitted] = useState<Application | null>(null);
  const [tracking, setTracking] = useState<Application | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const fileInputs = {
    nif: useRef<HTMLInputElement>(null),
    rccm: useRef<HTMLInputElement>(null),
    id_card: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    let cancelled = false;
    tenantApi
      .plans()
      .then((result) => {
        if (!cancelled && result.items.length > 0) setPlans(result.items);
      })
      .catch(() => {
        /* mode démo : plans locaux */
      });

    const draft = readStorage<{
      form: FormState;
      hours: EstablishmentHours[];
      step: number;
      pointer: Pointer | null;
      documents: Partial<Record<DocType, UploadedDoc>>;
    }>(DRAFT_KEY);
    const savedPointer = readStorage<Pointer>(POINTER_KEY);
    if (draft) {
      setForm({ ...EMPTY_FORM, ...draft.form, photos: draft.form?.photos ?? [] });
      setHours(draft.hours?.length ? draft.hours : defaultHours());
      setStep(Math.min(draft.step ?? 0, 4));
      setPointer(draft.pointer ?? savedPointer);
      setDocuments(draft.documents ?? {});
      setDraftLoaded(true);
    } else if (savedPointer) {
      setDraftLoaded(true);
      tenantApi
        .getApplication(savedPointer.applicationId, savedPointer.applicationToken)
        .then((result) => {
          if (!cancelled) setTracking(result.application);
        })
        .catch(() => {
          if (!cancelled) writeStorage(POINTER_KEY, null);
        });
    } else {
      setDraftLoaded(true);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftLoaded || submitted) return;
    writeStorage(DRAFT_KEY, { form, hours, step, pointer, documents });
  }, [form, hours, step, pointer, documents, draftLoaded, submitted]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === form.plan) ?? plans[0] ?? FALLBACK_PLANS[1],
    [plans, form.plan],
  );

  const validateStep = (index: number): boolean => {
    const next: Record<string, string> = {};
    const required = t('register.required');
    if (index === 0) {
      if (form.brandName.trim().length < 2) next.brandName = required;
      if (form.legalName.trim().length < 2) next.legalName = required;
      if (!/^[A-Za-z0-9]{6,20}$/.test(form.nif.trim())) next.nif = t('register.nifInvalid');
      if (form.rccm.trim().length < 3) next.rccm = required;
      if (form.logoUrl.trim() && !/^https:\/\//i.test(form.logoUrl.trim())) next.logoUrl = t('register.urlInvalid');
      if (form.photos.some((photo) => photo.trim() && !/^https:\/\//i.test(photo.trim()))) {
        next.photos = t('register.urlInvalid');
      }
    }
    if (index === 1) {
      if (form.district.trim().length < 2) next.district = required;
      if (form.city.trim().length < 2) next.city = required;
      if (!/^\+?\d[\d\s-]{7,}$/.test(form.contactPhone.trim())) next.contactPhone = t('register.phoneInvalid');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.contactEmail.trim())) next.contactEmail = t('register.emailInvalid');
    }
    if (index === 2) {
      if (form.managerName.trim().length < 2) next.managerName = required;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.managerEmail.trim())) next.managerEmail = t('register.emailInvalid');
      if (!/^\+?\d[\d\s-]{7,}$/.test(form.managerPhone.trim())) next.managerPhone = t('register.phoneInvalid');
      if (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
        next.password = t('register.passwordInvalid');
      }
      if (form.password !== form.confirmPassword) next.confirmPassword = t('register.passwordMismatch');
    }
    if (index === 3) {
      if (!documents.nif) next.nif = t('register.documentRequired');
      if (!documents.rccm) next.rccm = t('register.documentRequired');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const applicationPayload = () => ({
    establishment: {
      brandName: form.brandName.trim(),
      legalName: form.legalName.trim(),
      type: form.type,
      nif: form.nif.trim().toUpperCase(),
      rccm: form.rccm.trim().toUpperCase(),
      description: form.description.trim() || undefined,
      logoUrl: form.logoUrl.trim() || undefined,
      photos: form.photos.map((photo) => photo.trim()).filter(Boolean),
      address: {
        street: form.street.trim(),
        district: form.district.trim(),
        city: form.city.trim(),
        country: 'Togo',
      },
      contact: {
        phone: form.contactPhone.trim(),
        email: form.contactEmail.trim(),
        website: form.website.trim() || undefined,
      },
      hours,
    },
    manager: {
      name: form.managerName.trim(),
      email: form.managerEmail.trim(),
      phone: form.managerPhone.trim(),
      password: form.password,
    },
    plan: form.plan,
    languages: form.languages,
    currency: form.currency,
  });

  const ensureApplication = async (): Promise<Pointer> => {
    if (pointer) {
      await tenantApi.updateApplication(pointer.applicationId, pointer.applicationToken, applicationPayload());
      return pointer;
    }
    const created = await tenantApi.createApplication(applicationPayload());
    const next: Pointer = {
      applicationId: created.applicationId,
      applicationToken: created.applicationToken,
      reference: created.reference,
    };
    setPointer(next);
    writeStorage(POINTER_KEY, next);
    return next;
  };

  const nextStep = async () => {
    setAlert(null);
    if (!validateStep(step)) return;
    if (step === 2) {
      setPending(true);
      try {
        await ensureApplication();
        setStep(3);
      } catch (error) {
        setAlert(errorMessage(error));
      } finally {
        setPending(false);
      }
      return;
    }
    setStep((current) => Math.min(current + 1, 4));
  };

  const previousStep = async () => {
    setAlert(null);
    if (step === 0) {
      navigate('/');
      return;
    }
    if (pointer && step > 2) {
      setPending(true);
      try {
        await tenantApi.updateApplication(pointer.applicationId, pointer.applicationToken, applicationPayload());
      } catch {
        /* la sauvegarde de brouillon reste locale */
      } finally {
        setPending(false);
      }
    }
    setStep((current) => Math.max(current - 1, 0));
  };

  const uploadDocument = async (type: DocType, file: File | null) => {
    if (!file || !pointer) return;
    setAlert(null);
    if (file.size > 2 * 1024 * 1024) {
      setErrors((current) => ({ ...current, [type]: t('register.documentTooLarge') }));
      return;
    }
    setPending(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await tenantApi.uploadDocument(pointer.applicationId, pointer.applicationToken, {
        type,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64,
      });
      setDocuments((current) => ({
        ...current,
        [type]: { fileName: result.document.fileName, sizeBytes: result.document.sizeBytes, uploadedAt: result.document.uploadedAt },
      }));
      setErrors((current) => ({ ...current, [type]: '' }));
      toast.push({ title: t('register.documentUploaded'), description: file.name });
    } catch (error) {
      setAlert(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    setAlert(null);
    if (!acceptTerms) {
      setErrors({ acceptTerms: t('register.termsRequired') });
      return;
    }
    if (!validateStep(3)) {
      setStep(3);
      return;
    }
    setPending(true);
    try {
      const active = pointer ?? (await ensureApplication());
      await tenantApi.updateApplication(active.applicationId, active.applicationToken, {
        ...applicationPayload(),
        acceptTerms: true,
      });
      const result = await tenantApi.submitApplication(active.applicationId, active.applicationToken);
      setSubmitted(result.application);
      writeStorage(DRAFT_KEY, null);
      toast.push({ title: t('register.submitSuccess') });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'application_incomplete') {
        const details = error.details as { missing?: string[] } | undefined;
        setAlert(`${error.message} ${details?.missing?.join(', ') ?? ''}`);
      } else {
        setAlert(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  };

  const startNew = () => {
    writeStorage(DRAFT_KEY, null);
    writeStorage(POINTER_KEY, null);
    setPointer(null);
    setTracking(null);
    setDocuments({});
    setForm(EMPTY_FORM);
    setHours(defaultHours());
    setStep(0);
    setAcceptTerms(false);
    setSubmitted(null);
    setDraftLoaded(true);
  };

  const header = (
    <header className="reg-header">
      <a href="#/" className="reg-header__brand" aria-label="RESTO-HUB">
        <Logo withWordmark size={28} />
      </a>
      <div className="reg-header__actions">
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={() => navigate('/')}>
          {t('register.backHome')}
        </Button>
        <SegmentedControl<Locale>
          ariaLabel={t('nav.language')}
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'fr', label: 'FR', ariaLabel: 'Français' },
            { value: 'en', label: 'EN', ariaLabel: 'English' },
          ]}
        />
        <Button
          variant="ghost"
          iconOnly
          aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
          iconLeft={theme === 'light' ? 'moon' : 'sun'}
          onClick={toggleTheme}
        />
      </div>
    </header>
  );

  if (tracking) {
    return (
      <div className="reg-page">
        {header}
        <main className="reg-main reg-main--narrow">
          <Card className="reg-tracking">
            <CardBody>
              <div className="reg-tracking__head">
                <div>
                  <p className="reg-eyebrow">{t('register.trackingEyebrow')}</p>
                  <h1 className="reg-title">{tracking.reference}</h1>
                  <p className="reg-lead">{t('register.trackingLead')}</p>
                </div>
                <Badge tone={statusTone(tracking.status)} dot>
                  {t(`register.status.${tracking.status}`)}
                </Badge>
              </div>
              <dl className="reg-recap">
                <div>
                  <dt>{t('register.establishment')}</dt>
                  <dd>{tracking.establishment.brandName}</dd>
                </div>
                <div>
                  <dt>{t('register.legalName')}</dt>
                  <dd>{tracking.establishment.legalName}</dd>
                </div>
                <div>
                  <dt>{t('register.plan')}</dt>
                  <dd>{tracking.plan}</dd>
                </div>
                <div>
                  <dt>{t('register.submittedAt')}</dt>
                  <dd>{tracking.submittedAt ? formatDate(tracking.submittedAt, locale) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('register.documents')}</dt>
                  <dd>{tracking.documents.length}</dd>
                </div>
              </dl>
              {tracking.review.notes.length > 0 && (
                <div className="reg-timeline">
                  <h2 className="reg-subtitle">{t('register.reviewNotes')}</h2>
                  <ul>
                    {tracking.review.notes.map((note, index) => (
                      <li key={`${note.at}-${index}`}>
                        <strong>{t(`register.reviewAction.${note.action}`)}</strong>
                        <span>{formatDate(note.at, locale)}</span>
                        {(note.reason || note.note) && <p>{note.reason ?? note.note}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="reg-actions">
                <Button variant="outline" onClick={startNew}>
                  {t('register.newApplication')}
                </Button>
                {tracking.status === 'approved' && (
                  <Button iconLeft="arrow-right" onClick={() => navigate('/connexion')}>
                    {t('register.goLogin')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="reg-page">
        {header}
        <main className="reg-main reg-main--narrow">
          <Card className="reg-confirm">
            <CardBody>
              <span className="reg-confirm__icon">✓</span>
              <p className="reg-eyebrow">{t('register.confirmEyebrow')}</p>
              <h1 className="reg-title">{t('register.confirmTitle')}</h1>
              <p className="reg-lead">
                {t('register.confirmLead', { reference: submitted.reference })}
              </p>
              <div className="reg-confirm__steps">
                <div className="is-done">
                  <strong>{t('register.confirmStep1')}</strong>
                  <span>{formatDate(submitted.submittedAt ?? submitted.updatedAt, locale)}</span>
                </div>
                <div>
                  <strong>{t('register.confirmStep2')}</strong>
                  <span>{t('register.confirmStep2Hint')}</span>
                </div>
                <div>
                  <strong>{t('register.confirmStep3')}</strong>
                  <span>{t('register.confirmStep3Hint')}</span>
                </div>
              </div>
              <div className="reg-confirm__credentials">
                <Badge tone="info" icon="lock">{t('register.credentialsTitle')}</Badge>
                <p>{t('register.credentialsBody', { email: form.managerEmail })}</p>
              </div>
              <div className="reg-actions">
                <Button variant="outline" onClick={() => navigate('/connexion')}>
                  {t('register.goLogin')}
                </Button>
                <Button
                  onClick={() =>
                    tenantApi
                      .getApplication(pointer!.applicationId, pointer!.applicationToken)
                      .then((result) => setTracking(result.application))
                      .catch((error: unknown) => toast.push({ title: t('register.errorTitle'), description: errorMessage(error), tone: 'error' }))
                  }
                >
                  {t('register.track')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  const steps = [
    t('register.stepEstablishment'),
    t('register.stepContact'),
    t('register.stepManager'),
    t('register.stepDocuments'),
    t('register.stepReview'),
  ];

  return (
    <div className="reg-page">
      {header}
      <main className="reg-main">
        <div className="reg-intro">
          <p className="reg-eyebrow">{t('register.eyebrow')}</p>
          <h1 className="reg-title">{t('register.title')}</h1>
          <p className="reg-lead">{t('register.lead')}</p>
        </div>

        <div className="reg-layout">
          <Card className="reg-card">
            <CardBody>
              <ol className="reg-stepper" aria-label={t('register.progress')}>
                {steps.map((label, index) => (
                  <li
                    key={label}
                    className={index === step ? 'is-current' : index < step ? 'is-done' : undefined}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    <span className="reg-stepper__index">{index < step ? '✓' : index + 1}</span>
                    <span className="reg-stepper__label">{label}</span>
                  </li>
                ))}
              </ol>
              <div className="reg-progress" aria-hidden="true">
                <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
              </div>

              {alert && <p className="auth-error" role="alert">{alert}</p>}

              {step === 0 && (
                <section className="reg-section">
                  <h2 className="reg-subtitle">{t('register.stepEstablishment')}</h2>
                  <p className="reg-section__hint">{t('register.stepEstablishmentHint')}</p>
                  <div className="reg-grid">
                    <Input
                      label={t('register.brandName')}
                      value={form.brandName}
                      onChange={(event) => update('brandName', event.target.value)}
                      error={errors.brandName}
                      hint={t('register.brandNameHint')}
                      required
                    />
                    <Input
                      label={t('register.legalName')}
                      value={form.legalName}
                      onChange={(event) => update('legalName', event.target.value)}
                      error={errors.legalName}
                      required
                    />
                    <Select
                      label={t('register.type')}
                      value={form.type}
                      onChange={(event) => update('type', event.target.value as FormState['type'])}
                      options={[
                        { value: 'restaurant', label: t('register.typeRestaurant') },
                        { value: 'bar', label: t('register.typeBar') },
                        { value: 'both', label: t('register.typeBoth') },
                      ]}
                    />
                    <Input
                      label={t('register.nif')}
                      value={form.nif}
                      onChange={(event) => update('nif', event.target.value)}
                      error={errors.nif}
                      hint={t('register.nifHint')}
                      required
                    />
                    <Input
                      label={t('register.rccm')}
                      value={form.rccm}
                      onChange={(event) => update('rccm', event.target.value)}
                      error={errors.rccm}
                      required
                    />
                  </div>
                  <Textarea
                    label={t('register.description')}
                    value={form.description}
                    onChange={(event) => update('description', event.target.value)}
                    rows={3}
                    hint={t('register.descriptionHint')}
                  />
                  <div className="reg-visual">
                    <div className="reg-logo">
                      <Input
                        label={t('register.logo')}
                        type="url"
                        value={form.logoUrl}
                        onChange={(event) => update('logoUrl', event.target.value)}
                        error={errors.logoUrl}
                        hint={t('register.logoHint')}
                        placeholder="https://…/logo.png"
                      />
                      <div className="reg-logo__preview" aria-label={t('register.logoPreview')}>
                        {/^https:\/\//i.test(form.logoUrl.trim()) ? (
                          <img src={form.logoUrl.trim()} alt={t('register.logoPreview')} loading="lazy" />
                        ) : (
                          'LOGO'
                        )}
                      </div>
                    </div>
                    <div className="reg-visual__head">
                      <h3 className="reg-visual__title">{t('register.photos')}</h3>
                      <span className="reg-visual__count">
                        {t('register.photoCount', { count: form.photos.length })}
                      </span>
                    </div>
                    <p className="reg-note">{t('register.photosHint')}</p>
                    <div className="reg-photos">
                      {form.photos.map((photo, index) => (
                        <div className="reg-photo" key={index}>
                          <Input
                            label={t('register.photoLabel', { index: index + 1 })}
                            type="url"
                            value={photo}
                            error={errors.photos}
                            onChange={(event) =>
                              update(
                                'photos',
                                form.photos.map((entry, position) =>
                                  position === index ? event.target.value : entry,
                                ),
                              )
                            }
                            placeholder="https://…/photo.jpg"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('register.photoRemove', { index: index + 1 })}
                            onClick={() =>
                              update(
                                'photos',
                                form.photos.filter((_, position) => position !== index),
                              )
                            }
                          >
                            {t('register.photoDelete')}
                          </Button>
                        </div>
                      ))}
                    </div>
                    {form.photos.length < 6 && (
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => update('photos', [...form.photos, ''])}
                        >
                          {t('register.photoAdd')}
                        </Button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="reg-section">
                  <h2 className="reg-subtitle">{t('register.stepContact')}</h2>
                  <p className="reg-section__hint">{t('register.stepContactHint')}</p>
                  <div className="reg-grid">
                    <Input
                      label={t('register.district')}
                      value={form.district}
                      onChange={(event) => update('district', event.target.value)}
                      error={errors.district}
                      required
                    />
                    <Input
                      label={t('register.city')}
                      value={form.city}
                      onChange={(event) => update('city', event.target.value)}
                      error={errors.city}
                      required
                    />
                    <Input
                      label={t('register.street')}
                      value={form.street}
                      onChange={(event) => update('street', event.target.value)}
                    />
                    <Input
                      label={t('register.contactPhone')}
                      type="tel"
                      value={form.contactPhone}
                      onChange={(event) => update('contactPhone', event.target.value)}
                      error={errors.contactPhone}
                      placeholder="+228 22 00 00 00"
                      required
                    />
                    <Input
                      label={t('register.contactEmail')}
                      type="email"
                      value={form.contactEmail}
                      onChange={(event) => update('contactEmail', event.target.value)}
                      error={errors.contactEmail}
                      required
                    />
                    <Input
                      label={t('register.website')}
                      value={form.website}
                      onChange={(event) => update('website', event.target.value)}
                      placeholder="https://"
                    />
                  </div>
                  <h3 className="reg-subtitle reg-subtitle--sm">{t('register.hours')}</h3>
                  <div className="reg-hours">
                    {hours.map((slot, index) => {
                      const day = DAYS[index];
                      return (
                        <div className={slot.closed ? 'reg-hours__row is-closed' : 'reg-hours__row'} key={slot.day}>
                          <span className="reg-hours__day">{locale === 'en' ? day.labelEn : day.labelFr}</span>
                          <input
                            type="time"
                            aria-label={`${day.labelFr} — ${t('register.open')}`}
                            value={slot.open}
                            disabled={slot.closed}
                            onChange={(event) =>
                              setHours((current) =>
                                current.map((entry, i) => (i === index ? { ...entry, open: event.target.value } : entry)),
                              )
                            }
                          />
                          <span aria-hidden="true">–</span>
                          <input
                            type="time"
                            aria-label={`${day.labelFr} — ${t('register.close')}`}
                            value={slot.close}
                            disabled={slot.closed}
                            onChange={(event) =>
                              setHours((current) =>
                                current.map((entry, i) => (i === index ? { ...entry, close: event.target.value } : entry)),
                              )
                            }
                          />
                          <label className="reg-hours__closed">
                            <input
                              type="checkbox"
                              checked={Boolean(slot.closed)}
                              onChange={(event) =>
                                setHours((current) =>
                                  current.map((entry, i) =>
                                    i === index ? { ...entry, closed: event.target.checked } : entry,
                                  ),
                                )
                              }
                            />
                            {t('register.closed')}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="reg-section">
                  <h2 className="reg-subtitle">{t('register.stepManager')}</h2>
                  <p className="reg-section__hint">{t('register.stepManagerHint')}</p>
                  <div className="reg-grid">
                    <Input
                      label={t('register.managerName')}
                      value={form.managerName}
                      onChange={(event) => update('managerName', event.target.value)}
                      error={errors.managerName}
                      autoComplete="name"
                      required
                    />
                    <Input
                      label={t('register.managerEmail')}
                      type="email"
                      value={form.managerEmail}
                      onChange={(event) => update('managerEmail', event.target.value)}
                      error={errors.managerEmail}
                      autoComplete="email"
                      required
                    />
                    <Input
                      label={t('register.managerPhone')}
                      type="tel"
                      value={form.managerPhone}
                      onChange={(event) => update('managerPhone', event.target.value)}
                      error={errors.managerPhone}
                      autoComplete="tel"
                      required
                    />
                    <Input
                      label={t('register.password')}
                      type="password"
                      value={form.password}
                      onChange={(event) => update('password', event.target.value)}
                      error={errors.password}
                      hint={t('register.passwordHint')}
                      autoComplete="new-password"
                      required
                    />
                    <Input
                      label={t('register.confirmPassword')}
                      type="password"
                      value={form.confirmPassword}
                      onChange={(event) => update('confirmPassword', event.target.value)}
                      error={errors.confirmPassword}
                      autoComplete="new-password"
                      required
                    />
                  </div>

                  <h3 className="reg-subtitle reg-subtitle--sm">{t('register.plan')}</h3>
                  <div className="reg-plans" role="radiogroup" aria-label={t('register.plan')}>
                    {plans.map((plan) => (
                      <button
                        key={plan.code}
                        type="button"
                        role="radio"
                        aria-checked={form.plan === plan.code}
                        className={form.plan === plan.code ? 'reg-plan is-selected' : 'reg-plan'}
                        onClick={() => update('plan', plan.code)}
                      >
                        <span className="reg-plan__head">
                          <strong>{plan.name}</strong>
                          {plan.highlight && <Badge tone="accent">{t('register.recommended')}</Badge>}
                        </span>
                        <span className="reg-plan__price">
                          {formatXof(plan.priceXof, locale)}
                          <small>{t('register.perMonth')}</small>
                        </span>
                        <span className="reg-plan__meta">
                          {t('register.planSites', { count: plan.maxSites ?? '∞' })} ·{' '}
                          {t('register.planEmployees', { count: plan.maxEmployees ?? '∞' })}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="reg-grid reg-grid--2">
                    <div className="reg-choice">
                      <span className="reg-choice__label">{t('register.languages')}</span>
                      <Checkbox
                        label="Français"
                        checked={form.languages.includes('fr')}
                        onChange={(event) =>
                          update(
                            'languages',
                            event.target.checked
                              ? [...new Set([...form.languages, 'fr'])]
                              : form.languages.filter((entry) => entry !== 'fr'),
                          )
                        }
                      />
                      <Checkbox
                        label="English"
                        checked={form.languages.includes('en')}
                        onChange={(event) =>
                          update(
                            'languages',
                            event.target.checked
                              ? [...new Set([...form.languages, 'en'])]
                              : form.languages.filter((entry) => entry !== 'en'),
                          )
                        }
                      />
                    </div>
                    <Select
                      label={t('register.currency')}
                      value={form.currency}
                      onChange={(event) => update('currency', event.target.value)}
                      options={[
                        { value: 'XOF', label: 'XOF — Franc CFA' },
                        { value: 'EUR', label: 'EUR — Euro' },
                        { value: 'USD', label: 'USD — Dollar' },
                      ]}
                    />
                  </div>
                </section>
              )}

              {step === 3 && (
                <section className="reg-section">
                  <h2 className="reg-subtitle">{t('register.stepDocuments')}</h2>
                  <p className="reg-section__hint">{t('register.stepDocumentsHint')}</p>
                  <div className="reg-docs">
                    {(
                      [
                        { type: 'nif' as const, required: true },
                        { type: 'rccm' as const, required: true },
                        { type: 'id_card' as const, required: false },
                      ]
                    ).map((doc) => {
                      const uploaded = documents[doc.type];
                      return (
                        <div className={uploaded ? 'reg-doc is-done' : 'reg-doc'} key={doc.type}>
                          <div className="reg-doc__icon">{uploaded ? '✓' : '⇪'}</div>
                          <div className="reg-doc__body">
                            <strong>
                              {t(`register.doc.${doc.type}`)}
                              {doc.required ? ' *' : ''}
                            </strong>
                            <span>
                              {uploaded
                                ? `${uploaded.fileName} · ${Math.round(uploaded.sizeBytes / 1024)} Ko`
                                : t('register.documentHint')}
                            </span>
                            {errors[doc.type] && <span className="auth-error">{errors[doc.type]}</span>}
                          </div>
                          <input
                            ref={fileInputs[doc.type]}
                            type="file"
                            accept="image/*,application/pdf"
                            hidden
                            onChange={(event) => {
                              void uploadDocument(doc.type, event.target.files?.[0] ?? null);
                              event.target.value = '';
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputs[doc.type].current?.click()}
                            disabled={pending}
                          >
                            {uploaded ? t('register.replaceDocument') : t('register.chooseDocument')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="reg-note">{t('register.documentSecurity')}</p>
                </section>
              )}

              {step === 4 && (
                <section className="reg-section">
                  <h2 className="reg-subtitle">{t('register.stepReview')}</h2>
                  <p className="reg-section__hint">{t('register.stepReviewHint')}</p>
                  <div className="reg-recap">
                    <div>
                      <dt>{t('register.establishment')}</dt>
                      <dd>{form.brandName} — {form.legalName}</dd>
                    </div>
                    <div>
                      <dt>{t('register.nifRccm')}</dt>
                      <dd>{form.nif} · {form.rccm}</dd>
                    </div>
                    <div>
                      <dt>{t('register.address')}</dt>
                      <dd>{[form.street, form.district, form.city].filter(Boolean).join(', ')}</dd>
                    </div>
                    <div>
                      <dt>{t('register.contact')}</dt>
                      <dd>{form.contactPhone} · {form.contactEmail}</dd>
                    </div>
                    <div>
                      <dt>{t('register.visual')}</dt>
                      <dd>
                        {form.logoUrl.trim() ? 'Logo' : t('register.noLogo')} ·{' '}
                        {t('register.photoCount', {
                          count: form.photos.filter((photo) => photo.trim()).length,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('register.manager')}</dt>
                      <dd>{form.managerName} · {form.managerEmail} · {form.managerPhone}</dd>
                    </div>
                    <div>
                      <dt>{t('register.plan')}</dt>
                      <dd>
                        {selectedPlan.name} — {formatXof(selectedPlan.priceXof, locale)}
                        {t('register.perMonth')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('register.languages')}</dt>
                      <dd>{form.languages.map((entry) => entry.toUpperCase()).join(' · ')} — {form.currency}</dd>
                    </div>
                    <div>
                      <dt>{t('register.documents')}</dt>
                      <dd>
                        {Object.entries(documents)
                          .map(([type, doc]) => `${t(`register.doc.${type}`)} (${doc?.fileName})`)
                          .join(' · ')}
                      </dd>
                    </div>
                  </div>
                  <div className="reg-terms">
                    <Checkbox
                      label={t('register.terms')}
                      checked={acceptTerms}
                      onChange={(event) => {
                        setAcceptTerms(event.target.checked);
                        setErrors((current) => ({ ...current, acceptTerms: '' }));
                      }}
                    />
                    {errors.acceptTerms && <span className="auth-error">{errors.acceptTerms}</span>}
                    <p className="reg-note">{t('register.termsNote')}</p>
                  </div>
                </section>
              )}

              <div className="reg-actions">
                <Button variant="ghost" onClick={() => void previousStep()} disabled={pending}>
                  {step === 0 ? t('register.cancel') : t('register.back')}
                </Button>
                {step < 4 ? (
                  <Button onClick={() => void nextStep()} loading={pending} iconRight="arrow-right">
                    {step === 2 ? t('register.saveContinue') : t('register.continue')}
                  </Button>
                ) : (
                  <Button onClick={() => void submit()} loading={pending} iconRight="check">
                    {t('register.submit')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          <aside className="reg-aside">
            <Card className="reg-summary">
              <CardBody>
                <p className="reg-eyebrow">{t('register.summaryTitle')}</p>
                <div className="reg-summary__plan">
                  <strong>{selectedPlan.name}</strong>
                  <span>
                    {formatXof(selectedPlan.priceXof, locale)} <small>{t('register.perMonth')}</small>
                  </span>
                </div>
                <ul className="reg-summary__features">
                  {[
                    t('register.summaryFeature1', { sites: selectedPlan.maxSites ?? '∞' }),
                    t('register.summaryFeature2', { employees: selectedPlan.maxEmployees ?? '∞' }),
                    t('register.summaryFeature3'),
                    t('register.summaryFeature4'),
                  ].map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="reg-summary__trial">
                  <Badge tone="success" icon="gift">{t('register.trialBadge')}</Badge>
                  <p>{t('register.trialNote')}</p>
                </div>
                <div className="reg-summary__help">
                  <strong>{t('register.helpTitle')}</strong>
                  <p>{t('register.helpBody')}</p>
                  <a href="mailto:bonjour@resto-hub.tg">bonjour@resto-hub.tg</a>
                </div>
              </CardBody>
            </Card>
            {pointer && (
              <Card className="reg-summary reg-summary--draft">
                <CardBody>
                  <Badge tone="info" icon="edit">{t('register.draftBadge')}</Badge>
                  <p>{t('register.draftNote', { reference: pointer.reference })}</p>
                </CardBody>
              </Card>
            )}
          </aside>
        </div>
      </main>
      <p className="reg-foot">{t('register.foot')}</p>
    </div>
  );
}
