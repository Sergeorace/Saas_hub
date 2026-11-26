import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const services = [
  { entry: join(root, 'services/identity-service/dist/main.js') },
  {
    entry: join(root, 'services/tenant-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4013' },
  },
  { entry: join(root, 'services/catalog-service/dist/main.js') },
  {
    entry: join(root, 'services/floor-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4011,http://127.0.0.1:4012' },
  },
  {
    entry: join(root, 'services/order-service/dist/main.js'),
    env: {
      EVENT_SUBSCRIBERS:
        'http://127.0.0.1:4006,http://127.0.0.1:4007,http://127.0.0.1:4008,http://127.0.0.1:4010,http://127.0.0.1:4011,http://127.0.0.1:4012',
    },
  },
  {
    entry: join(root, 'services/loyalty-marketing-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4011,http://127.0.0.1:4012' },
  },
  {
    entry: join(root, 'services/payment-service/dist/main.js'),
    env: {
      EVENT_SUBSCRIBERS:
        'http://127.0.0.1:4008,http://127.0.0.1:4010,http://127.0.0.1:4011,http://127.0.0.1:4012,http://127.0.0.1:4013',
    },
  },
  {
    entry: join(root, 'services/staff-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4009' },
  },
  {
    entry: join(root, 'services/payroll-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4011,http://127.0.0.1:4012' },
  },
  {
    entry: join(root, 'services/inventory-service/dist/main.js'),
    env: { EVENT_SUBSCRIBERS: 'http://127.0.0.1:4011' },
  },
  { entry: join(root, 'services/notification-service/dist/main.js') },
  { entry: join(root, 'services/reporting-service/dist/main.js') },
  { entry: join(root, 'services/platform-admin-service/dist/main.js') },
];

const children = services.map(({ entry, env }) => {
  const child = spawn(process.execPath, [entry], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) process.exitCode = code;
  });
  return child;
});

function shutdown() {
  for (const child of children) child.kill();
}
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
