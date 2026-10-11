// Unified end-to-end smoke runner.
//
// Runs every smoke suite in order against a live backend on :3000 and exits
// non-zero on the first failure. Each suite is a standalone script so it can
// also be run on its own (see README).
//
// NOTE: /login and /register are rate-limited (default 20 req / 15 min per IP).
// A full run easily exceeds that, so start the dev server with a raised limit:
//   AUTH_RATE_LIMIT_MAX=1000 npm run dev
// (or run this once against a freshly restarted server).
const { spawnSync } = require('child_process');
const path = require('path');

const HTTP = process.env.SMOKE_HTTP || 'http://localhost:3000';

const suites = [
  'ws-smoke.cjs',
  'fixes-smoke.cjs',
  'features-smoke.cjs',
  'crm-smoke.cjs',
  'crm-tenant-detail-smoke.cjs',
];

async function serverUp() {
  try {
    const res = await fetch(HTTP + '/health');
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  if (!(await serverUp())) {
    console.error(`Backend is not responding at ${HTTP}. Start it with: npm run dev`);
    process.exit(1);
  }

  for (const suite of suites) {
    console.log(`\n### ${suite} ###`);
    const res = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
    if (res.status !== 0) {
      console.error(`\nE2E FAILED at ${suite}`);
      console.error('If failures look like 429s, raise AUTH_RATE_LIMIT_MAX and restart the server.');
      process.exit(1);
    }
  }

  console.log('\n=== E2E OK ===');
})();
