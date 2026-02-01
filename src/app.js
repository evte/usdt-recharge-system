require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { sequelize, User } = require('./models');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const { startScanner, stopScanner } = require('./services/scannerService');
const { startCollector, stopCollector } = require('./services/collectorService');

// Validate required env vars at startup
const REQUIRED_ENV = [
  'DB_HOST', 'DB_USER', 'DB_NAME',
  'JWT_SECRET', 'ENCRYPT_KEY',
  'ETH_RPC_URL', 'ERC20_USDT_CONTRACT',
  'TRON_API_URL', 'TRC20_USDT_CONTRACT',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}
if (process.env.ENCRYPT_KEY.length !== 64) {
  console.error('ENCRYPT_KEY must be a 64-char hex string (32 bytes)');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rate limit on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/auth', authLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve admin SPA static files
const adminDist = path.join(__dirname, '..', 'admin', 'dist');
app.use('/admin', express.static(adminDist));
app.get('/admin/{*splat}', (req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'));
});

// Serve user portal SPA static files (at root /)
const portalDist = path.join(__dirname, '..', 'portal', 'dist');
app.use(express.static(portalDist));
// SPA fallback: any non-API, non-admin route serves portal index.html
app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(portalDist, 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Seed default admin account if none exists
async function seedAdmin() {
  const adminCount = await User.count({ where: { is_admin: true } });
  if (adminCount === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', password_hash: hash, is_admin: true });
    console.log('Default admin created: admin / admin123');
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    await sequelize.sync({ alter: true });
    console.log('Tables synced');

    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`User portal: http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });

    startScanner();
    startCollector();
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopScanner();
  stopCollector();
  sequelize.close().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stopScanner();
  stopCollector();
  sequelize.close().then(() => process.exit(0));
});

start();
