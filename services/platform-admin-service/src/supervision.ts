import { nowIso } from '@resto-hub/service-kit';
import { healthSampleLimit, type PlatformAdminStore, type ServiceSample } from './store.js';

export interface HealthCheckResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  status: number | null;
  error: string | null;
}

export async function probeService(
  name: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<HealthCheckResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { name, ok: false, latencyMs, status: response.status, error: `HTTP ${response.status}` };
    }
    return { name, ok: true, latencyMs, status: response.status, error: null };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - started,
      status: null,
      error: error instanceof Error ? error.message : 'injoignable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAllServices(
  store: PlatformAdminStore,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthCheckResult[]> {
  const targets = [...store.services.values()];
  const results = await Promise.all(targets.map((service) => probeService(service.name, service.url, fetchImpl)));
  results.forEach((result) => applyHealthResult(store, result));
  return results;
}

export function applyHealthResult(store: PlatformAdminStore, result: HealthCheckResult): void {
  const service = store.services.get(result.name);
  if (!service) return;
  const previousStatus = service.status;
  service.checks += 1;
  service.lastCheckAt = nowIso();
  service.latencyMs = result.latencyMs;
  const sample: ServiceSample = { at: service.lastCheckAt, ok: result.ok, latencyMs: result.latencyMs };
  service.samples.push(sample);
  if (service.samples.length > healthSampleLimit()) service.samples.shift();

  if (result.ok) {
    service.status = 'up';
    service.consecutiveFailures = 0;
    if (previousStatus === 'down') {
      store.log('info', result.name, 'Service de nouveau disponible.', { latencyMs: result.latencyMs });
      for (const alert of store.alerts.values()) {
        if (alert.service === result.name && alert.code === 'service_unreachable' && alert.status !== 'resolved') {
          alert.status = 'resolved';
          alert.resolvedBy = 'system';
          alert.resolvedAt = nowIso();
        }
      }
    }
    if (result.latencyMs > 800) {
      store.raiseAlert({
        severity: 'warning',
        service: result.name,
        code: 'slow_response',
        message: `Latence élevée détectée sur ${result.name} (${result.latencyMs} ms).`,
      });
    }
    return;
  }

  service.status = 'down';
  service.failures += 1;
  service.consecutiveFailures += 1;
  store.log('error', result.name, `Contrôle de santé en échec : ${result.error ?? 'injoignable'}.`, {
    status: result.status,
    latencyMs: result.latencyMs,
  });
  if (service.consecutiveFailures >= 2) {
    store.raiseAlert({
      severity: 'critical',
      service: result.name,
      code: 'service_unreachable',
      message: `${result.name} injoignable depuis ${service.consecutiveFailures} contrôles consécutifs.`,
    });
  }
}
