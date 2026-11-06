import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runFlows } from './flows';
import { cleanup, seed } from './seed';

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const port = new URL(baseURL).port || '3000';
const webDir = fileURLToPath(new URL('../../../apps/web', import.meta.url));
const artifacts = fileURLToPath(new URL('../artifacts', import.meta.url));
const selected = process.argv.slice(2).filter((a) => /^[A-Z]$/.test(a));
const only = selected.length > 0 ? selected : undefined; // no arguments = all flows

async function waitForServer(url: string, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

if (!existsSync(`${webDir}/.next`)) {
  throw new Error(
    'No production build found. Run `pnpm build` first (the suite tests the built app).',
  );
}
mkdirSync(artifacts, { recursive: true });

let server: ChildProcess | undefined;
let exitCode: number;
try {
  await cleanup(); // leftovers from an interrupted run
  const data = await seed();

  server = spawn('node_modules/.bin/next', ['start', '-p', port], {
    cwd: webDir,
    // Never send real e-mail from the test run.
    env: { ...process.env, MAIL_TRANSPORT: 'console' },
    stdio: 'ignore',
  });
  await waitForServer(`${baseURL}/en/sign-in`);

  const { passed, failed, errors } = await runFlows({
    baseURL,
    seed: data,
    artifacts,
    ...(only ? { only } : {}),
  });
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${artifacts}`);
  console.log(`Browser console/page errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(' -', e.slice(0, 200));
  exitCode = passed > 0 && failed === 0 && errors.length === 0 ? 0 : 1; // zero checks is a failure too
} finally {
  server?.kill();
  console.log('Cleaned up:', await cleanup());
}
process.exit(exitCode);
