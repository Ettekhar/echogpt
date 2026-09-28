/* eslint-disable */
/**
 * Verifies that the hand-authored init migration actually produces the schema
 * that schema.prisma describes.
 *
 * Applies the migration to a throwaway database with the real Prisma migration
 * engine (`prisma migrate deploy`), then asks Prisma to diff the result against
 * the datamodel. Any drift is printed and exits non-zero.
 *
 * Note: this must go through the migration engine rather than
 * `$executeRawUnsafe` - a multi-statement SQL string does not run through
 * Prisma's extended query protocol, which silently applies nothing.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRATCH = 'echogpt_migration_check';
const ADMIN_URL = 'postgresql://postgres:password@localhost:5432/postgres';
const SCRATCH_URL = `postgresql://postgres:password@localhost:5432/${SCRATCH}?schema=public`;

function run(args, env) {
  // Invoke the Prisma CLI through the current Node binary rather than `npx`,
  // which is a shell shim and is not resolvable via spawnSync on Windows.
  const prismaCli = require.resolve('prisma/build/index.js');
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

async function dropScratch() {
  try {
    const { PrismaClient } = require('@prisma/client');
    const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await admin.$disconnect();
    console.log(`\nCleaned up scratch database "${SCRATCH}".`);
  } catch (e) {
    console.warn(`\nCould not drop scratch database "${SCRATCH}": ${e.message}`);
  }
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });

  console.log(`Recreating scratch database "${SCRATCH}"...`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${SCRATCH}`);
  await admin.$disconnect();

  console.log('Applying migrations with the Prisma migration engine...');
  const deployOut = run(['migrate', 'deploy'], { DATABASE_URL: SCRATCH_URL });
  console.log(deployOut.trim().split('\n').map((l) => '  ' + l).join('\n'));

  console.log('\nDiffing migrated database against prisma/schema.prisma...');
  try {
    const diff = run(
      [
        'migrate',
        'diff',
        '--from-url',
        SCRATCH_URL,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { DATABASE_URL: SCRATCH_URL },
    );
    console.log(diff || '  (no differences)');
    console.log('\nRESULT: PASS - migration matches schema.prisma exactly.');
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    console.log(out);
    console.log('\nRESULT: FAIL - the migration does not match schema.prisma.');
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await dropScratch();
    process.exit(process.exitCode || 0);
  })
  .catch(async (e) => {
    console.error(e);
    await dropScratch();
    process.exit(1);
  });
