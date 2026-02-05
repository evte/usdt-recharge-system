const { Router } = require('express');
const { Op, fn, col, literal } = require('sequelize');
const adminAuth = require('../middleware/adminAuth');
const { User, Wallet, Deposit, ScanState } = require('../models');

const router = Router();
router.use(adminAuth);

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.count();
    const totalDeposits = await Deposit.count();
    const totalBalance = await User.sum('balance') || 0;
    const pendingCollection = await Deposit.count({ where: { status: 'confirmed' } });

    const recentDeposits = await Deposit.findAll({
      include: [{ model: User, attributes: ['username'] }],
      order: [['created_at', 'DESC']],
      limit: 10,
    });

    const scanState = await ScanState.findAll();

    res.json({
      stats: { totalUsers, totalDeposits, totalBalance, pendingCollection },
      recentDeposits,
      scanState,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users?page=1&pageSize=20&search=
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const search = req.query.search || '';

    const where = search
      ? { username: { [Op.like]: `%${search}%` } }
      : {};

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'username', 'balance', 'erc20_wallet_id', 'trc20_wallet_id', 'is_admin', 'created_at'],
      include: [
        { model: Wallet, as: 'erc20Wallet', attributes: ['id', 'address', 'chain_type'] },
        { model: Wallet, as: 'trc20Wallet', attributes: ['id', 'address', 'chain_type'] },
      ],
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({ total: count, page, pageSize, rows });
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: Wallet, as: 'erc20Wallet' },
        { model: Wallet, as: 'trc20Wallet' },
      ],
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error('User detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id/balance
router.put('/users/:id/balance', async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount === undefined || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance = Number(user.balance) + Number(amount);
    if (user.balance < 0) {
      return res.status(400).json({ error: 'Balance cannot be negative' });
    }
    await user.save();

    res.json({ message: 'Balance updated', balance: user.balance });
  } catch (err) {
    console.error('Balance update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/deposits?page=1&pageSize=20&chain_type=&status=&user_id=
router.get('/deposits', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));

    const where = {};
    if (req.query.token_type) where.token_type = req.query.token_type;
    if (req.query.chain_type) where.chain_type = req.query.chain_type;
    if (req.query.status) where.status = req.query.status;
    if (req.query.user_id) where.user_id = req.query.user_id;

    const { count, rows } = await Deposit.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ['username'] },
        { model: Wallet, attributes: ['address'] },
      ],
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({ total: count, page, pageSize, rows });
  } catch (err) {
    console.error('Deposits list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/wallets?page=1&pageSize=20
router.get('/wallets', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));

    const { count, rows } = await Wallet.findAndCountAll({
      attributes: ['id', 'user_id', 'address', 'chain_type', 'created_at'],
      include: [{ model: User, attributes: ['username'] }],
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({ total: count, page, pageSize, rows });
  } catch (err) {
    console.error('Wallets list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/collections?page=1&pageSize=20
router.get('/collections', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));

    const { count, rows } = await Deposit.findAndCountAll({
      where: { status: 'collected' },
      include: [
        { model: User, attributes: ['username'] },
        { model: Wallet, attributes: ['address'] },
      ],
      order: [['updated_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({ total: count, page, pageSize, rows });
  } catch (err) {
    console.error('Collections list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/scan-state
router.get('/scan-state', async (req, res) => {
  try {
    const states = await ScanState.findAll();
    res.json({ states });
  } catch (err) {
    console.error('Scan state error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
