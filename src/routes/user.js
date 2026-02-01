const { Router } = require('express');
const authMiddleware = require('../middleware/auth');
const { User, Wallet, Deposit } = require('../models');
const walletService = require('../services/walletService');

const router = Router();

// All routes require auth
router.use(authMiddleware);

// GET /api/user/info
router.get('/info', async (req, res) => {
  try {
    const user = await User.findByPk(req.userId, {
      attributes: ['id', 'username', 'balance', 'erc20_wallet_id', 'trc20_wallet_id'],
      include: [
        { model: Wallet, as: 'erc20Wallet', attributes: ['id', 'address', 'chain_type'] },
        { model: Wallet, as: 'trc20Wallet', attributes: ['id', 'address', 'chain_type'] },
      ],
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    console.error('User info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/user/recharge — get or create deposit addresses
router.post('/recharge', async (req, res) => {
  try {
    const result = await walletService.getOrCreateWallets(req.userId);
    res.json({
      erc20_address: result.erc20.address,
      trc20_address: result.trc20.address,
    });
  } catch (err) {
    console.error('Recharge error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/user/deposits
router.get('/deposits', async (req, res) => {
  try {
    const deposits = await Deposit.findAll({
      where: { user_id: req.userId },
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    res.json({ deposits });
  } catch (err) {
    console.error('Deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
