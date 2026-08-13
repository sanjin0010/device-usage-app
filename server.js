const path = require('node:path');
const fs = require('node:fs');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');
const db = openDb(dbPath);
const app = createApp(db);

function start(port, attempts = 10) {
  const server = app.listen(port, () => {
    console.log(`设备使用登记 APP 已启动: http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) {
      server.close(() => start(port + 1, attempts - 1));
    } else {
      console.error('启动失败:', err.message);
      process.exit(1);
    }
  });
}

start(Number(process.env.PORT || 3000));
