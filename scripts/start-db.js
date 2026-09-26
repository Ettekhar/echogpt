const EmbeddedPostgres = require('embedded-postgres').default;
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '.pgdata');

const pg = new EmbeddedPostgres({
  port: 5432,
  databaseDir: dataDir,
  user: 'postgres',
  password: 'password',
  initialDatabase: 'echogpt',
  persistent: true,
});

async function main() {
  if (!fs.existsSync(dataDir)) {
    console.log('[DB] Initialising database cluster...');
    await pg.initialise();
  }
  console.log('[DB] Starting PostgreSQL on port 5432...');
  await pg.start();
  console.log('[DB] PostgreSQL is running on port 5432 (database: echogpt, user: postgres, pass: password)');

  const shutdown = async () => {
    console.log('\n[DB] Stopping PostgreSQL...');
    try {
      await pg.stop();
      console.log('[DB] PostgreSQL stopped.');
    } catch (e) {
      console.error('[DB] Error stopping PostgreSQL:', e);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[DB] Fatal error:', err);
  process.exit(1);
});
