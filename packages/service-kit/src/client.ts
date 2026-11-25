import { HttpError } from './errors.js';

export interface ServiceClientOptions {
  baseUrl: string;
  internalKey: string;
  fetchImpl?: typeof fetch;
}

export interface ServiceClient {
  get: <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  del: <T = unknown>(path: string) => Promise<T>;
}

export function createServiceClient(options: ServiceClientOptions): ServiceClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-key': options.internalKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code: string; message: string; details?: unknown };
    };
    if (!response.ok) {
      throw new HttpError(
        response.status,
        payload.error?.code ?? 'service_error',
        payload.error?.message ?? `Service indisponible (${response.status}).`,
        payload.error?.details,
      );
    }
    return payload as T;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
}
