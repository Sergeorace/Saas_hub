import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon, Skeleton, cx, useI18n, useToast } from '@resto-hub/design-system';
import { publicApi } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { navigate, parseTableQr, withQuery } from '../lib/router';
import { ClientBottomBar, ClientHeader } from '../components/ClientChrome';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const DEMO_TABLES: Array<{ slug: string; name: string; color: string; codes: string[] }> = [
  { slug: 'sahel-grill', name: 'Sahel Grill', color: '#C2410C', codes: ['LOME01-SAL-001', 'LOME01-TER-001', 'LOME01-BAR-002'] },
  { slug: 'le-baobab', name: 'Le Baobab', color: '#6D28D9', codes: ['BAOB01-SAL-001', 'BAOB01-TER-001'] },
  { slug: 'lagune-beach-club', name: 'Lagune Beach Club', color: '#0E7490', codes: ['LAGN01-SAL-001', 'LAGN01-TER-001'] },
];

function openTable(tenantKey: string, code: string, token: string) {
  navigate(withQuery(`/e/${encodeURIComponent(tenantKey)}/menu`, { table: code, k: token }));
}

export default function ScanPage({ presetTenant }: { presetTenant?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [tenantKey, setTenantKey] = useState(presetTenant ?? '');
  const establishments = useAsync(() => publicApi.establishments({}), []);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      window.clearTimeout(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };

  useEffect(() => stopCamera, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || video.readyState < 2) {
      rafRef.current = window.setTimeout(() => void tick(), 350);
      return;
    }
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue;
      if (value) {
        const parsed = parseTableQr(value);
        if (parsed) {
          stopCamera();
          openTable(parsed.tenantKey, parsed.code, parsed.token);
          return;
        }
      }
    } catch {
      /* frame non lisible : on réessaie */
    }
    rafRef.current = window.setTimeout(() => void tick(), 350);
  };

  const startCamera = async () => {
    setCameraError(null);
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setCameraError(t('scan.cameraError'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t('scan.noCamera'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      detectorRef.current = new Detector({ formats: ['qr_code'] });
      setScanning(true);
      void tick();
    } catch {
      setCameraError(t('scan.permissionHelp'));
      stopCamera();
    }
  };

  const submitManual = () => {
    const value = manual.trim();
    if (!value) return;
    const parsed = parseTableQr(value);
    if (parsed) {
      openTable(parsed.tenantKey, parsed.code, parsed.token);
      return;
    }
    if (tenantKey && /^[A-Za-z0-9-]+$/.test(value)) {
      openTable(tenantKey, value.toUpperCase(), `demo-${value.toLowerCase()}`);
      return;
    }
    toast.push({ title: t('scan.invalidCode'), tone: 'warning' });
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('scan.title')} />
      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-scan-stage">
          <div className={cx('rh-scan-viewport', scanning && 'is-scanning')}>
            <video ref={videoRef} playsInline muted aria-label={t('scan.title')} />
            <div className="rh-scan-frame" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            {!scanning && (
              <div className="rh-scan-placeholder">
                <Icon name="qr" size="lg" />
                <p>{t('scan.desc')}</p>
              </div>
            )}
            {scanning && <span className="rh-scan-line" aria-hidden="true" />}
          </div>
          <div className="rh-scan-actions">
            {scanning ? (
              <button type="button" className="rh-client-btn rh-client-btn--ghost rh-client-btn--block" onClick={stopCamera}>
                <Icon name="x" size="sm" /> {t('scan.stop')}
              </button>
            ) : (
              <button type="button" className="rh-client-btn rh-client-btn--primary rh-client-btn--block rh-client-btn--lg" onClick={startCamera}>
                <Icon name="scan" size="sm" /> {t('scan.start')}
              </button>
            )}
            {cameraError && (
              <p className="rh-client-hint rh-client-hint--center">
                <Icon name="info" size="sm" /> {cameraError}
              </p>
            )}
          </div>
        </section>

        <section className="rh-scan-manual">
          <h2>{t('scan.manualTitle')}</h2>
          <p>{t('scan.manualDesc')}</p>
          <label className="rh-client-field">
            <span>{t('scan.manualTenant')}</span>
            <select className="rh-client-input" value={tenantKey} onChange={(event) => setTenantKey(event.target.value)}>
              <option value="">{t('scan.chooseTenant')}</option>
              {establishments.loading && <option disabled>{t('common.loading')}</option>}
              {establishments.data?.items.map((establishment) => (
                <option key={establishment.id} value={establishment.slug}>
                  {establishment.brandName}
                </option>
              ))}
            </select>
          </label>
          <label className="rh-client-field">
            <span>{t('scan.manualLabel')}</span>
            <input
              className="rh-client-input"
              placeholder={t('scan.manualPlaceholder')}
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitManual();
              }}
            />
          </label>
          <button type="button" className="rh-client-btn rh-client-btn--soft rh-client-btn--block" onClick={submitManual} disabled={!manual.trim()}>
            <Icon name="arrow-right" size="sm" /> {t('scan.openTable')}
          </button>
        </section>

        <section className="rh-scan-demo">
          <h2>{t('scan.demoTitle')}</h2>
          <p>{t('scan.demoDesc')}</p>
          {establishments.loading && <Skeleton height={90} />}
          {DEMO_TABLES.map((tenant) => (
            <article key={tenant.slug} className="rh-scan-demo-card" style={{ '--demo-color': tenant.color } as CSSProperties}>
              <header>
                <span className="rh-scan-demo-dot" aria-hidden="true" />
                <strong>{tenant.name}</strong>
                <button type="button" className="rh-client-link-btn" onClick={() => navigate(`/e/${tenant.slug}`)}>
                  {t('common.seeAll')}
                </button>
              </header>
              <div className="rh-scan-demo-tables">
                {tenant.codes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    className="rh-scan-demo-chip"
                    onClick={() => openTable(tenant.slug, code, `demo-${code.toLowerCase()}`)}
                    aria-label={t('scan.openDemo', { code })}
                  >
                    <Icon name="qr" size="sm" /> {code}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <p className="rh-client-hint rh-client-hint--center">
            <Icon name="info" size="sm" /> {t('scan.hint')}
          </p>
        </section>
      </main>
      <ClientBottomBar active="scan" />
    </div>
  );
}
