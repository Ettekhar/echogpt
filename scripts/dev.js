const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const EmbeddedPostgres = require('embedded-postgres').default;

const dataDir = path.join(__dirname, '..', '.pgdata');
const pidFile = path.join(dataDir, 'postmaster.pid');

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function cleanStalePid() {
  if (fs.existsSync(pidFile)) {
    try {
      const content = fs.readFileSync(pidFile, 'utf8');
      const lines = content.split('\n');
      const pid = parseInt(lines[0].trim(), 10);
      let isAlive = false;
      if (pid) {
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch (e) {
          isAlive = false;
        }
      }
      const isStopping = content.includes('stopping');
      if (!isAlive || isStopping) {
        console.log('[DB] Removing stale postmaster.pid (PID ' + pid + (isStopping ? ', stopping' : '') + ')...');
        fs.unlinkSync(pidFile);
      }
    } catch (_) {}
  }
}

async function main() {
  cleanStalePid();

  let startedPg = false;
  let pg = null;
  const inUse = await isPortInUse(5432);

  if (inUse) {
    console.log('[DB] PostgreSQL is already listening on port 5432.');
  } else {
    pg = new EmbeddedPostgres({
      port: 5432,
      databaseDir: dataDir,
      user: 'postgres',
      password: 'password',
      initialDatabase: 'echogpt',
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
    });

    if (!fs.existsSync(dataDir)) {
      console.log('[DB] Initialising database cluster in .pgdata with UTF-8 encoding...');
      await pg.initialise();
    }

    console.log('[DB] Starting PostgreSQL on port 5432...');
    try {
      await pg.start();
      startedPg = true;
      console.log('[DB] PostgreSQL started successfully on port 5432.');
      try {
        await pg.createDatabase('echogpt');
      } catch (_) {}
    } catch (err) {
      console.log('[DB] Notice:', err && err.message ? err.message : String(err));
    }
  }

  console.log('[App] Starting EchoGPT backend on http://localhost:3001/api/v1 ...');
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  const app = spawn(npmCmd, ['run', 'start:dev'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..'),
  });

  const cleanup = async () => {
    console.log('\n[App] Stopping...');
    app.kill('SIGINT');
    if (startedPg && pg) {
      try {
        console.log('[DB] Stopping PostgreSQL...');
        await pg.stop();
      } catch (_) {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  app.on('exit', (code) => {
    if (startedPg && pg) {
      pg.stop().catch(() => {}).finally(() => process.exit(code || 0));
    } else {
      process.exit(code || 0);
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
