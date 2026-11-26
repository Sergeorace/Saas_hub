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
  Modal,
  SegmentedControl,
  Select,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  marketingApi,
  type CampaignChannel,
  type CampaignSegment,
  type CampaignView,
  type DiscountType,
  type InventoryAuditEntry,
  type LoyaltyDashboard,
  type LoyaltyProgramView,
  type PromoCodeView,
  type PromoRedemptionView,
  type PromotionView,
  type ReviewStatus,
  type ReviewView,
} from '../lib/api';

type Section = 'overview' | 'promotions' | 'codes' | 'campaigns' | 'reviews' | 'audit';

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  planifiee: 'info',
  terminee: 'neutral',
  desactivee: 'neutral',
  brouillon: 'neutral',
  envoyee: 'success',
  annulee: 'danger',
};

const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

const CHANNELS: CampaignChannel[] = ['sms', 'email', 'push'];
const SEGMENTS: CampaignSegment[] = ['all', 'bronze', 'argent', 'or', 'platine', 'inactifs'];

function toInputDate(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function defaultPeriod() {
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86_400_000);
  return { startAt: toInputDate(start), endAt: toInputDate(end) };
}

export function MarketingTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canView = permissions.includes('loyalty:view');
  const canManage = permissions.includes('loyalty:manage');

  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<LoyaltyDashboard | null>(null);
  const [program, setProgram] = useState<LoyaltyProgramView | null>(null);
  const [promotions, setPromotions] = useState<PromotionView[]>([]);
  const [codes, setCodes] = useState<PromoCodeView[]>([]);
  const [redemptions, setRedemptions] = useState<PromoRedemptionView[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [audience, setAudience] = useState<Record<string, number>>({});
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [reviewCounts, setReviewCounts] = useState<Record<ReviewStatus, number>>({
    pending: 0,
    approved: 0,
    rejected: 0,
  });
  const [reviewFilter, setReviewFilter] = useState<'all' | ReviewStatus>('all');
  const [audit, setAudit] = useState<{ entries: InventoryAuditEntry[]; integrity: boolean } | null>(
    null,
  );

  const [promotionModal, setPromotionModal] = useState(false);
  const [promoForm, setPromoForm] = useState({
    name: '',
    description: '',
    type: 'percent' as DiscountType,
    value: '10',
    minOrderXof: '0',
    appliesTo: 'all' as PromotionView['appliesTo'],
    ...defaultPeriod(),
  });

  const [codeModal, setCodeModal] = useState(false);
  const [codeForm, setCodeForm] = useState({
    code: '',
    type: 'percent' as DiscountType,
    value: '10',
    minOrderXof: '0',
    maxUses: '0',
    perUserLimit: '1',
    ...defaultPeriod(),
  });

  const [campaignModal, setCampaignModal] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    channel: 'sms' as CampaignChannel,
    segment: 'all' as CampaignSegment,
    message: '',
    scheduledAt: '',
  });

  const [replyTarget, setReplyTarget] = useState<ReviewView | null>(null);
  const [replyText, setReplyText] = useState('');

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const [dash, prog, promo, code, camp, rev, log] = await Promise.all([
        marketingApi.dashboard(tenantId),
        marketingApi.program(tenantId),
        marketingApi.promotions(tenantId),
        marketingApi.promoCodes(tenantId),
        marketingApi.campaigns(tenantId),
        marketingApi.reviews(tenantId),
        marketingApi.audit(tenantId),
      ]);
      setDashboard(dash);
      setProgram(prog);
      setPromotions(promo.items);
      setCodes(code.items);
      setRedemptions(code.redemptions);
      setCampaigns(camp.items);
      setAudience(camp.audience);
      setReviews(rev.items);
      setReviewCounts(rev.counts);
      setAudit({ entries: log.entries, integrity: log.integrity });
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId, canView]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const run = async (task: () => Promise<void>, success: string) => {
    setPending(true);
    try {
      await task();
      toast.push({ title: success, tone: 'success' });
      await reload();
    } catch (cause) {
      toast.push({ title: t('marketing.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const visibleReviews = useMemo(
    () => reviews.filter((review) => reviewFilter === 'all' || review.status === reviewFilter),
    [reviews, reviewFilter],
  );

  const savePromotion = () =>
    run(async () => {
      await marketingApi.createPromotion(tenantId, {
        name: promoForm.name,
        description: promoForm.description || undefined,
        type: promoForm.type,
        value: Number(promoForm.value) || 0,
        minOrderXof: Number(promoForm.minOrderXof) || 0,
        appliesTo: promoForm.appliesTo,
        startAt: new Date(promoForm.startAt).toISOString(),
        endAt: new Date(promoForm.endAt).toISOString(),
        active: true,
      });
      setPromotionModal(false);
      setPromoForm({
        name: '',
        description: '',
        type: 'percent',
        value: '10',
        minOrderXof: '0',
        appliesTo: 'all',
        ...defaultPeriod(),
      });
    }, t('marketing.promotionCreated'));

  const togglePromotion = (promotion: PromotionView) =>
    run(async () => {
      await marketingApi.updatePromotion(tenantId, promotion.id, { active: !promotion.active });
    }, t('marketing.promotionUpdated'));

  const saveCode = () =>
    run(async () => {
      await marketingApi.createPromoCode(tenantId, {
        code: codeForm.code.toUpperCase(),
        type: codeForm.type,
        value: Number(codeForm.value) || 0,
        minOrderXof: Number(codeForm.minOrderXof) || 0,
        maxUses: Number(codeForm.maxUses) > 0 ? Number(codeForm.maxUses) : undefined,
        perUserLimit: Number(codeForm.perUserLimit) || 1,
        startAt: new Date(codeForm.startAt).toISOString(),
        endAt: new Date(codeForm.endAt).toISOString(),
        active: true,
      });
      setCodeModal(false);
      setCodeForm({
        code: '',
        type: 'percent',
        value: '10',
        minOrderXof: '0',
        maxUses: '0',
        perUserLimit: '1',
        ...defaultPeriod(),
      });
    }, t('marketing.codeCreated'));

  const toggleCode = (code: PromoCodeView) =>
    run(async () => {
      await marketingApi.updatePromoCode(tenantId, code.id, { active: !code.active });
    }, t('marketing.codeUpdated'));

  const saveCampaign = () =>
    run(async () => {
      await marketingApi.createCampaign(tenantId, {
        name: campaignForm.name,
        channel: campaignForm.channel,
        segment: campaignForm.segment,
        message: campaignForm.message,
        scheduledAt: campaignForm.scheduledAt
          ? new Date(campaignForm.scheduledAt).toISOString()
          : null,
      });
      setCampaignModal(false);
      setCampaignForm({ name: '', channel: 'sms', segment: 'all', message: '', scheduledAt: '' });
    }, t('marketing.campaignCreated'));

  const sendCampaign = (campaign: CampaignView) =>
    run(async () => {
      const result = await marketingApi.sendCampaign(tenantId, campaign.id);
      toast.push({
        title: t('marketing.campaignSent', { count: result.campaign.recipients ?? 0 }),
        tone: 'success',
      });
    }, t('marketing.sent'));

  const cancelCampaign = (campaign: CampaignView) =>
    run(async () => {
      await marketingApi.cancelCampaign(tenantId, campaign.id);
    }, t('marketing.campaignCancelled'));

  const moderate = (review: ReviewView, action: 'approve' | 'reject') =>
    run(
      async () => {
        await marketingApi.moderateReview(tenantId, review.id, action);
      },
      action === 'approve'
        ? t('marketing.reviewStatus.approved')
        : t('marketing.reviewStatus.rejected'),
    );

  const sendReply = () =>
    run(async () => {
      if (!replyTarget) return;
      await marketingApi.replyReview(tenantId, replyTarget.id, replyText);
      setReplyTarget(null);
      setReplyText('');
    }, t('marketing.replySent'));

  if (!canView) {
    return (
      <EmptyState
        icon="lock"
        title={t('marketing.forbidden')}
        description={t('marketing.readOnly')}
      />
    );
  }

  if (loading && !dashboard) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={8} />
          <p className="console-muted">{t('marketing.loading')}</p>
        </CardBody>
      </Card>
    );
  }

  const promotionColumns: Column<PromotionView>[] = [
    {
      key: 'name',
      header: t('marketing.colName'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.description || '—'}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('marketing.colType'),
      render: (row) => t(`marketing.type.${row.type}`),
    },
    {
      key: 'value',
      header: t('marketing.colValue'),
      align: 'right',
      render: (row) => (row.type === 'percent' ? `${row.value} %` : formatXof(row.value, locale)),
    },
    {
      key: 'period',
      header: t('marketing.colPeriod'),
      render: (row) => `${formatDate(row.startAt, locale)} → ${formatDate(row.endAt, locale)}`,
    },
    {
      key: 'min',
      header: t('marketing.colMinOrder'),
      align: 'right',
      render: (row) => formatXof(row.minOrderXof, locale),
    },
    {
      key: 'status',
      header: t('marketing.colStatus'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>
          {t(`marketing.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('marketing.colAction'),
      render: (row) =>
        canManage ? (
          <Button
            size="sm"
            variant={row.active ? 'ghost' : 'outline'}
            onClick={() => void togglePromotion(row)}
          >
            {row.active ? t('marketing.deactivate') : t('marketing.activate')}
          </Button>
        ) : (
          <span className="console-muted">—</span>
        ),
    },
  ];

  const codeColumns: Column<PromoCodeView>[] = [
    { key: 'code', header: t('marketing.colCode'), render: (row) => <strong>{row.code}</strong> },
    {
      key: 'type',
      header: t('marketing.colType'),
      render: (row) => t(`marketing.type.${row.type}`),
    },
    {
      key: 'value',
      header: t('marketing.colValue'),
      align: 'right',
      render: (row) => (row.type === 'percent' ? `${row.value} %` : formatXof(row.value, locale)),
    },
    {
      key: 'uses',
      header: t('marketing.colUses'),
      align: 'right',
      render: (row) => `${row.uses}${row.maxUses ? ` / ${row.maxUses}` : ''}`,
    },
    {
      key: 'remaining',
      header: t('marketing.colRemaining'),
      align: 'right',
      render: (row) => row.remainingUses ?? '∞',
    },
    {
      key: 'status',
      header: t('marketing.colStatus'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>
          {t(`marketing.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('marketing.colAction'),
      render: (row) =>
        canManage ? (
          <Button
            size="sm"
            variant={row.active ? 'ghost' : 'outline'}
            onClick={() => void toggleCode(row)}
          >
            {row.active ? t('marketing.deactivate') : t('marketing.activate')}
          </Button>
        ) : (
          <span className="console-muted">—</span>
        ),
    },
  ];

  const redemptionColumns: Column<PromoRedemptionView>[] = [
    { key: 'code', header: t('marketing.colCode'), render: (row) => row.code },
    { key: 'order', header: t('marketing.colOrder'), render: (row) => row.orderId },
    {
      key: 'total',
      header: t('marketing.colMinOrder'),
      align: 'right',
      render: (row) => formatXof(row.orderTotalXof, locale),
    },
    {
      key: 'discount',
      header: t('marketing.colDiscount'),
      align: 'right',
      render: (row) => formatXof(row.discountXof, locale),
    },
    {
      key: 'at',
      header: t('marketing.colDate'),
      render: (row) =>
        formatDate(row.at, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
  ];

  const campaignColumns: Column<CampaignView>[] = [
    {
      key: 'name',
      header: t('marketing.colCampaign'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>
            {row.message.slice(0, 70)}
            {row.message.length > 70 ? '…' : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'channel',
      header: t('marketing.colChannel'),
      render: (row) => t(`marketing.channel.${row.channel}`),
    },
    {
      key: 'segment',
      header: t('marketing.colSegment'),
      render: (row) => t(`marketing.segment.${row.segment}`),
    },
    {
      key: 'recipients',
      header: t('marketing.colRecipients'),
      align: 'right',
      render: (row) => row.recipients ?? '—',
    },
    {
      key: 'status',
      header: t('marketing.colStatus'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>
          {t(`marketing.campaignStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'sentAt',
      header: t('marketing.colSentAt'),
      render: (row) => (row.sentAt ? formatDate(row.sentAt, locale) : '—'),
    },
    {
      key: 'action',
      header: t('marketing.colAction'),
      render: (row) =>
        !canManage || row.status === 'envoyee' || row.status === 'annulee' ? (
          <span className="console-muted">—</span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => void sendCampaign(row)}>
              {t('marketing.send')}
            </Button>
            {row.status === 'planifiee' && (
              <Button size="sm" variant="ghost" onClick={() => void cancelCampaign(row)}>
                {t('marketing.cancelCampaign')}
              </Button>
            )}
          </div>
        ),
    },
  ];

  const auditColumns: Column<InventoryAuditEntry>[] = [
    {
      key: 'at',
      header: t('marketing.colAt'),
      render: (row) =>
        formatDate(row.createdAt, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    { key: 'actor', header: t('marketing.colClient'), render: (row) => row.actorId },
    {
      key: 'action',
      header: t('marketing.colAction'),
      render: (row) => <Badge tone="neutral">{row.action}</Badge>,
    },
    {
      key: 'target',
      header: t('marketing.colTarget'),
      render: (row) => `${row.targetType} · ${row.targetId}`,
    },
  ];

  return (
    <div className="console-stack">
      <div className="console-toolbar">
        <SegmentedControl<Section>
          ariaLabel={t('marketing.title')}
          value={section}
          onChange={setSection}
          options={[
            { value: 'overview', label: t('marketing.sectionOverview') },
            { value: 'promotions', label: t('marketing.sectionPromotions') },
            { value: 'codes', label: t('marketing.sectionCodes') },
            { value: 'campaigns', label: t('marketing.sectionCampaigns') },
            { value: 'reviews', label: t('marketing.sectionReviews') },
            { value: 'audit', label: t('marketing.sectionAudit') },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!canManage && <Badge tone="neutral">{t('marketing.readOnly')}</Badge>}
          <Button variant="outline" size="sm" iconLeft="refresh" onClick={() => void reload()}>
            {t('marketing.refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {section === 'overview' && (
        <>
          <div className="console-stats">
            <StatCard
              label={t('marketing.statMembers')}
              value={dashboard?.members ?? 0}
              icon="users"
            />
            <StatCard
              label={t('marketing.statPoints')}
              value={(dashboard?.pointsOutstanding ?? 0).toLocaleString(locale)}
              icon="gift"
              meta={`${dashboard?.promotions.active ?? 0} ${t('marketing.statPromotions').toLowerCase()}`}
            />
            <StatCard
              label={t('marketing.statCodes')}
              value={dashboard?.promoCodes.active ?? 0}
              icon="banknote"
              meta={`${dashboard?.promoCodes.redemptions ?? 0} ${t('marketing.statRedemptions').toLowerCase()}`}
            />
            <StatCard
              label={t('marketing.statPending')}
              value={dashboard?.reviews.pending ?? 0}
              icon="alert"
              meta={`${dashboard?.campaigns.envoyees ?? 0} ${t('marketing.statCampaigns').toLowerCase()}`}
            />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader
                title={t('marketing.tiersTitle')}
                action={
                  <Badge tone="info">
                    {formatXof(dashboard?.promoCodes.discountXof ?? 0, locale)}
                  </Badge>
                }
              />
              <CardBody>
                {program ? (
                  <ul className="console-queue">
                    {program.program.tiers.map((tier) => (
                      <li key={tier.code}>
                        <div>
                          <strong>{tier.label}</strong>
                          <span>
                            {t('marketing.tierMembers', {
                              count: dashboard?.tiers[tier.code] ?? 0,
                            })}{' '}
                            · ×{tier.multiplier}
                          </span>
                        </div>
                        <Badge tone="accent">
                          {tier.minLifetimePoints.toLocaleString(locale)} pts
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="console-muted">{t('marketing.loading')}</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('marketing.rewardsTitle')} />
              <CardBody>
                {program ? (
                  <>
                    <ul className="console-queue">
                      {program.program.rewards.map((reward) => (
                        <li key={reward.id}>
                          <div>
                            <strong>{reward.label}</strong>
                            <span>{reward.description}</span>
                          </div>
                          <Badge tone="success">
                            {t('marketing.rewardCost', { points: reward.costPoints })}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    <div className="console-kv">
                      <span>{t('marketing.programRules')}</span>
                      <span>{program.program.rules}</span>
                    </div>
                    <div className="console-kv">
                      <span>{t('marketing.averageLabel')}</span>
                      <span>
                        {program.reviews.average.toFixed(1)} / 5 · {program.reviews.count}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="console-muted">{t('marketing.loading')}</p>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'promotions' && (
        <Card>
          <CardHeader
            title={t('marketing.promotionsTitle')}
            subtitle={t('marketing.promotionsHint')}
            action={
              canManage ? (
                <Button size="sm" iconLeft="plus" onClick={() => setPromotionModal(true)}>
                  {t('marketing.addPromotion')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {promotions.length === 0 ? (
              <EmptyState
                icon="gift"
                title={t('marketing.promotionsTitle')}
                description={t('marketing.emptyPromotions')}
              />
            ) : (
              <DataTable
                columns={promotionColumns}
                rows={promotions}
                getRowId={(row) => row.id}
                caption={t('marketing.promotionsTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'codes' && (
        <>
          <Card>
            <CardHeader
              title={t('marketing.codesTitle')}
              subtitle={t('marketing.codesHint')}
              action={
                canManage ? (
                  <Button size="sm" iconLeft="plus" onClick={() => setCodeModal(true)}>
                    {t('marketing.addCode')}
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              {codes.length === 0 ? (
                <EmptyState
                  icon="gift"
                  title={t('marketing.codesTitle')}
                  description={t('marketing.emptyCodes')}
                />
              ) : (
                <DataTable
                  columns={codeColumns}
                  rows={codes}
                  getRowId={(row) => row.id}
                  caption={t('marketing.codesTitle')}
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('marketing.redemptionsTitle')} />
            <CardBody>
              {redemptions.length === 0 ? (
                <p className="console-muted">{t('marketing.emptyRedemptions')}</p>
              ) : (
                <DataTable
                  columns={redemptionColumns}
                  rows={redemptions.slice(0, 50)}
                  getRowId={(row) => row.id}
                  caption={t('marketing.redemptionsTitle')}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}

      {section === 'campaigns' && (
        <Card>
          <CardHeader
            title={t('marketing.campaignsTitle')}
            subtitle={t('marketing.campaignsHint')}
            action={
              canManage ? (
                <Button size="sm" iconLeft="plus" onClick={() => setCampaignModal(true)}>
                  {t('marketing.addCampaign')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <div className="console-filters">
              {SEGMENTS.map((segment) => (
                <span key={segment} className="console-filter">
                  {t(`marketing.segment.${segment}`)} · {audience[segment] ?? 0}
                </span>
              ))}
            </div>
            {campaigns.length === 0 ? (
              <EmptyState
                icon="bell"
                title={t('marketing.campaignsTitle')}
                description={t('marketing.emptyCampaigns')}
              />
            ) : (
              <DataTable
                columns={campaignColumns}
                rows={campaigns}
                getRowId={(row) => row.id}
                caption={t('marketing.campaignsTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'reviews' && (
        <Card>
          <CardHeader
            title={t('marketing.reviewsTitle')}
            subtitle={t('marketing.reviewsHint')}
            action={
              <Badge tone="info">
                {t('marketing.averageLabel')} {dashboard?.reviews.average.toFixed(1) ?? '—'}
              </Badge>
            }
          />
          <CardBody>
            <div className="console-filters">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={reviewFilter === value ? 'console-filter is-active' : 'console-filter'}
                  aria-pressed={reviewFilter === value}
                  onClick={() => setReviewFilter(value)}
                >
                  {value === 'all'
                    ? t('marketing.sectionReviews')
                    : t(`marketing.reviewStatus.${value}`)}
                  {value !== 'all' && ` · ${reviewCounts[value]}`}
                </button>
              ))}
            </div>
            {visibleReviews.length === 0 ? (
              <EmptyState
                icon="users"
                title={t('marketing.reviewsTitle')}
                description={t('marketing.emptyReviews')}
              />
            ) : (
              <ul className="console-queue">
                {visibleReviews.map((review) => (
                  <li key={review.id}>
                    <div>
                      <strong>
                        {review.userName} · {'★'.repeat(review.rating)}
                        <span className="console-muted"> ({review.rating}/5)</span>
                      </strong>
                      <span>{review.comment ?? '—'}</span>
                      <span>
                        {review.reply
                          ? `${t('marketing.reply')} : ${review.reply.message}`
                          : t('marketing.noReply')}
                      </span>
                      <span className="console-muted">{formatDate(review.createdAt, locale)}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <Badge tone={REVIEW_TONE[review.status]} dot>
                        {t(`marketing.reviewStatus.${review.status}`)}
                      </Badge>
                      {canManage && review.status === 'pending' && (
                        <>
                          <Button size="sm" onClick={() => void moderate(review, 'approve')}>
                            {t('marketing.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger-soft"
                            onClick={() => void moderate(review, 'reject')}
                          >
                            {t('marketing.reject')}
                          </Button>
                        </>
                      )}
                      {canManage && !review.reply && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReplyTarget(review);
                            setReplyText('');
                          }}
                        >
                          {t('marketing.reply')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {section === 'audit' && (
        <Card>
          <CardHeader
            title={t('marketing.auditTitle')}
            subtitle={t('marketing.auditHint')}
            action={
              <Badge tone={audit?.integrity ? 'success' : 'danger'} dot>
                {audit?.integrity
                  ? t('marketing.auditIntegrityOk')
                  : t('marketing.auditIntegrityBroken')}
              </Badge>
            }
          />
          <CardBody>
            {!audit || audit.entries.length === 0 ? (
              <EmptyState
                icon="shield"
                title={t('marketing.auditTitle')}
                description={t('marketing.auditEmpty')}
              />
            ) : (
              <DataTable
                columns={auditColumns}
                rows={audit.entries}
                getRowId={(row) => row.id}
                caption={t('marketing.auditTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------ Modales ------------------------------ */}
      <Modal
        open={promotionModal}
        onClose={() => setPromotionModal(false)}
        title={t('marketing.addPromotion')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPromotionModal(false)}>
              {t('marketing.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={promoForm.name.trim().length < 2 || Number(promoForm.value) <= 0}
              onClick={() => void savePromotion()}
            >
              {t('marketing.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('marketing.formName')}
            required
            value={promoForm.name}
            onChange={(event) => setPromoForm({ ...promoForm, name: event.target.value })}
          />
          <Textarea
            label={t('marketing.formDescription')}
            value={promoForm.description}
            onChange={(event) => setPromoForm({ ...promoForm, description: event.target.value })}
          />
          <div className="console-2col">
            <Select
              label={t('marketing.formDiscountType')}
              value={promoForm.type}
              onChange={(event) =>
                setPromoForm({ ...promoForm, type: event.target.value as DiscountType })
              }
              options={[
                { value: 'percent', label: t('marketing.type.percent') },
                { value: 'amount', label: t('marketing.type.amount') },
              ]}
            />
            <Input
              label={t('marketing.formValue', { unit: promoForm.type === 'percent' ? '%' : 'XOF' })}
              type="number"
              min={0}
              value={promoForm.value}
              onChange={(event) => setPromoForm({ ...promoForm, value: event.target.value })}
            />
          </div>
          <div className="console-2col">
            <Input
              label={t('marketing.formMinOrder')}
              type="number"
              min={0}
              value={promoForm.minOrderXof}
              onChange={(event) => setPromoForm({ ...promoForm, minOrderXof: event.target.value })}
            />
            <Select
              label={t('marketing.formAppliesTo')}
              value={promoForm.appliesTo}
              onChange={(event) =>
                setPromoForm({
                  ...promoForm,
                  appliesTo: event.target.value as PromotionView['appliesTo'],
                })
              }
              options={(['all', 'dine_in', 'delivery', 'takeaway'] as const).map((value) => ({
                value,
                label: t(`marketing.appliesTo.${value}`),
              }))}
            />
          </div>
          <div className="console-2col">
            <Input
              label={t('marketing.formStart')}
              type="datetime-local"
              value={promoForm.startAt}
              onChange={(event) => setPromoForm({ ...promoForm, startAt: event.target.value })}
            />
            <Input
              label={t('marketing.formEnd')}
              type="datetime-local"
              value={promoForm.endAt}
              onChange={(event) => setPromoForm({ ...promoForm, endAt: event.target.value })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={codeModal}
        onClose={() => setCodeModal(false)}
        title={t('marketing.addCode')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setCodeModal(false)}>
              {t('marketing.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={codeForm.code.trim().length < 3 || Number(codeForm.value) <= 0}
              onClick={() => void saveCode()}
            >
              {t('marketing.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('marketing.formCode')}
            required
            value={codeForm.code}
            onChange={(event) =>
              setCodeForm({ ...codeForm, code: event.target.value.toUpperCase() })
            }
          />
          <div className="console-2col">
            <Select
              label={t('marketing.formDiscountType')}
              value={codeForm.type}
              onChange={(event) =>
                setCodeForm({ ...codeForm, type: event.target.value as DiscountType })
              }
              options={[
                { value: 'percent', label: t('marketing.type.percent') },
                { value: 'amount', label: t('marketing.type.amount') },
              ]}
            />
            <Input
              label={t('marketing.formValue', { unit: codeForm.type === 'percent' ? '%' : 'XOF' })}
              type="number"
              min={0}
              value={codeForm.value}
              onChange={(event) => setCodeForm({ ...codeForm, value: event.target.value })}
            />
          </div>
          <div className="console-2col">
            <Input
              label={t('marketing.formMinOrder')}
              type="number"
              min={0}
              value={codeForm.minOrderXof}
              onChange={(event) => setCodeForm({ ...codeForm, minOrderXof: event.target.value })}
            />
            <Input
              label={t('marketing.formMaxUses')}
              type="number"
              min={0}
              value={codeForm.maxUses}
              onChange={(event) => setCodeForm({ ...codeForm, maxUses: event.target.value })}
            />
          </div>
          <Input
            label={t('marketing.formPerUser')}
            type="number"
            min={1}
            value={codeForm.perUserLimit}
            onChange={(event) => setCodeForm({ ...codeForm, perUserLimit: event.target.value })}
          />
          <div className="console-2col">
            <Input
              label={t('marketing.formStart')}
              type="datetime-local"
              value={codeForm.startAt}
              onChange={(event) => setCodeForm({ ...codeForm, startAt: event.target.value })}
            />
            <Input
              label={t('marketing.formEnd')}
              type="datetime-local"
              value={codeForm.endAt}
              onChange={(event) => setCodeForm({ ...codeForm, endAt: event.target.value })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={campaignModal}
        onClose={() => setCampaignModal(false)}
        title={t('marketing.addCampaign')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setCampaignModal(false)}>
              {t('marketing.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={
                campaignForm.name.trim().length < 2 || campaignForm.message.trim().length < 5
              }
              onClick={() => void saveCampaign()}
            >
              {t('marketing.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('marketing.formName')}
            required
            value={campaignForm.name}
            onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })}
          />
          <div className="console-2col">
            <Select
              label={t('marketing.formChannel')}
              value={campaignForm.channel}
              onChange={(event) =>
                setCampaignForm({ ...campaignForm, channel: event.target.value as CampaignChannel })
              }
              options={CHANNELS.map((channel) => ({
                value: channel,
                label: t(`marketing.channel.${channel}`),
              }))}
            />
            <Select
              label={t('marketing.formSegment')}
              value={campaignForm.segment}
              onChange={(event) =>
                setCampaignForm({ ...campaignForm, segment: event.target.value as CampaignSegment })
              }
              options={SEGMENTS.map((segment) => ({
                value: segment,
                label: `${t(`marketing.segment.${segment}`)} (${audience[segment] ?? 0})`,
              }))}
            />
          </div>
          <Textarea
            label={t('marketing.formMessage')}
            required
            rows={5}
            value={campaignForm.message}
            onChange={(event) => setCampaignForm({ ...campaignForm, message: event.target.value })}
            hint={`${campaignForm.message.length} / 480`}
          />
          <Input
            label={t('marketing.formScheduled')}
            type="datetime-local"
            value={campaignForm.scheduledAt}
            onChange={(event) =>
              setCampaignForm({ ...campaignForm, scheduledAt: event.target.value })
            }
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(replyTarget)}
        onClose={() => {
          setReplyTarget(null);
          setReplyText('');
        }}
        title={
          replyTarget
            ? t('marketing.replyTitle', { name: replyTarget.userName })
            : t('marketing.reply')
        }
        description={t('marketing.replyHint')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              onClick={() => {
                setReplyTarget(null);
                setReplyText('');
              }}
            >
              {t('marketing.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={replyText.trim().length < 3}
              onClick={() => void sendReply()}
            >
              {t('marketing.send')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          {replyTarget && (
            <p className="console-muted">
              {replyTarget.rating}/5 · {replyTarget.comment ?? '—'}
            </p>
          )}
          <Textarea
            label={t('marketing.replyLabel')}
            rows={4}
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
