export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export interface ApiOptions {
  token?: string;
  internalKey?: string;
  headers?: Record<string, string>;
}

export async function api<T = any>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  options: ApiOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.internalKey) headers['x-internal-key'] = options.internalKey;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // réponse non JSON conservée telle quelle
  }
  return { status: response.status, body: parsed as T };
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (attendu : ${JSON.stringify(expected)}, obtenu : ${JSON.stringify(actual)})`);
  }
}

export function assertStatus(result: ApiResult, expected: number, label: string): void {
  if (result.status !== expected) {
    throw new Error(
      `${label} — statut attendu ${expected}, obtenu ${result.status} : ${JSON.stringify(result.body).slice(0, 300)}`,
    );
  }
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition non satisfaite après ${timeoutMs} ms.`);
}

export interface TestCase {
  name: string;
  run: () => Promise<void>;
  skip?: boolean;
}

export async function runTests(title: string, cases: TestCase[]): Promise<void> {
  console.log(`\n${title}`);
  let failures = 0;
  let executed = 0;
  for (const testCase of cases) {
    if (testCase.skip) {
      console.log(`  ○ ${testCase.name} (ignoré)`);
      continue;
    }
    executed += 1;
    try {
      await testCase.run();
      console.log(`  ✓ ${testCase.name}`);
    } catch (error) {
      failures += 1;
      console.error(`  ✗ ${testCase.name}`);
      console.error(`    ${(error as Error).message}`);
    }
  }
  const passed = executed - failures;
  console.log(`\n${failures === 0 ? 'SUCCÈS' : 'ÉCHEC'} — ${passed}/${executed} tests d'isolation réussis.`);
  if (failures > 0) process.exitCode = 1;
}
