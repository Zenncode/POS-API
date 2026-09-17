// Fail-closed guard for ALL E2E entry points (bootstrap + start:e2e).
// Refuses to run unless the process targets the isolated E2E stack:
//   - DATABASE_URL (the value Prisma actually uses) must parse as a
//     postgres/postgresql URL with hostname exactly 127.0.0.1 or localhost,
//     port exactly 55433, and pathname exactly /pos_e2e
//   - NODE_ENV must be exactly `test`
//   - if PORT is set, it must equal the E2E API port (3101)
//   - E2E_EXPECT_* / E2E_DATABASE_URL overrides that disagree are rejected
// This guarantees `pnpm run e2e:bootstrap` / `start:e2e` can never push,
// seed, or boot against the dev (`pos` on :5433) or any production DB.
// It never prints the DB URL (secret) — failures name only the bad field.
// It also never reads `.env` — only the explicit env vars above.

const EXPECT_DB_PATH = '/pos_e2e';
const EXPECT_PORT = '55433';
const EXPECT_API_PORT = '3101';
const EXPECT_HOSTS = new Set(['127.0.0.1', 'localhost']);

function fail(reason) {
  process.stderr.write(`E2E guard: REFUSING — ${reason}\n`);
  process.exit(1);
}

// Reject override attempts that would weaken the checks below.
if (process.env.E2E_EXPECT_DB && process.env.E2E_EXPECT_DB !== 'pos_e2e') {
  fail('E2E_EXPECT_DB override is not allowed (must be pos_e2e).');
}
if (process.env.E2E_EXPECT_HOSTPORT && process.env.E2E_EXPECT_HOSTPORT !== EXPECT_PORT) {
  fail('E2E_EXPECT_HOSTPORT override is not allowed (must be 55433).');
}
if (process.env.E2E_EXPECT_PORT && process.env.E2E_EXPECT_PORT !== EXPECT_API_PORT) {
  fail('E2E_EXPECT_PORT override is not allowed (must be 3101).');
}

// Validate the ACTUAL url Prisma uses — never an alternate Prisma ignores.
const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl) {
  fail('DATABASE_URL is not set. Export the E2E env first (see .env.e2e.example).');
}
// A divergent alternate means the operator thinks Prisma reads it — refuse.
if (process.env.E2E_DATABASE_URL && process.env.E2E_DATABASE_URL !== dbUrl) {
  fail('E2E_DATABASE_URL diverges from DATABASE_URL. Prisma uses DATABASE_URL — align them.');
}

let parsed;
try {
  parsed = new URL(dbUrl);
} catch {
  fail('DATABASE_URL is not a valid URL. Wrong database — aborting.');
}
if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
  fail('DATABASE_URL must use the postgres/postgresql scheme. Wrong database — aborting.');
}
if (!EXPECT_HOSTS.has(parsed.hostname)) {
  fail('DATABASE_URL hostname must be 127.0.0.1 or localhost. Wrong database — aborting.');
}
if (parsed.port !== EXPECT_PORT) {
  fail(`DATABASE_URL port must be ${EXPECT_PORT}. Wrong database — aborting.`);
}
if (parsed.pathname !== EXPECT_DB_PATH) {
  fail(`DATABASE_URL database must be ${EXPECT_DB_PATH}. Wrong database — aborting.`);
}
// Query allowlist: Prisma only needs `schema` here. Any other query key
// (host overrides, sslmode toggles, connection-limit tricks) is rejected so a
// crafted DATABASE_URL cannot silently retarget the network layer.
for (const key of parsed.searchParams.keys()) {
  if (key !== 'schema') {
    fail(`DATABASE_URL query parameter "${key}" is not allowed (only "schema").`);
  }
}
if (process.env.NODE_ENV !== 'test') {
  fail('NODE_ENV must be exactly "test" for E2E targets.');
}
if (process.env.PORT && process.env.PORT !== EXPECT_API_PORT) {
  fail(`PORT must match the E2E port ${EXPECT_API_PORT}. Wrong target — aborting.`);
}

process.stdout.write('E2E guard: OK (local pos_e2e on 127.0.0.1:55433, NODE_ENV=test).\n');
