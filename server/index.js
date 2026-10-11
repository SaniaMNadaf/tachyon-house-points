const path = require('path');
const { openDb, ensureSuperAdmin, seedSample } = require('./db');
const { createApp } = require('./app');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file, that is fine */ }

const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tachyon.db'));
const first = ensureSuperAdmin(db);
if (first) {
  console.log('\n  First run: super admin created.');
  console.log(`  username: ${first.username}`);
  if (first.generated) console.log(`  password: ${first.password}   (random, shown once; you must change it at first login)`);
  else console.log('  password: the ADMIN_PASSWORD you set');
  console.log('');
}
if (process.env.SEED_SAMPLE !== 'false' && seedSample(db)) console.log('  Loaded sample points (set SEED_SAMPLE=false to skip).\n');

const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => console.log(`  Tachyon House Points running at http://localhost:${port}`));
