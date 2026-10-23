import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const app = await buildApp({ config });

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutdown requested; draining connections');

  // Flip readiness first so the load balancer stops routing new traffic here.
  app.deps.lifecycle.shuttingDown = true;

  const forceExit = setTimeout(() => {
    app.log.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  try {
    await app.close();
    app.log.info('shutdown complete');
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, (s) => void shutdown(s));
}
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start server');
  process.exit(1);
}
