const { ethers } = require('ethers');
const TronWeb = require('tronweb');
const { User, Wallet } = require('../models');
const sequelize = require('../config/database');
const { encrypt } = require('../utils/crypto');

function getTronWeb() {
  return new TronWeb({
    fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
    headers: process.env.TRON_API_KEY
      ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
      : {},
  });
}

async function generateERC20Wallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function generateTRC20Wallet() {
  const tronWeb = getTronWeb();
  const account = await tronWeb.createAccount();
  return {
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

async function getOrCreateWallets(userId) {
  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) throw new Error('User not found');

    let erc20Wallet, trc20Wallet;

    // ERC20 wallet
    if (user.erc20_wallet_id) {
      erc20Wallet = await Wallet.findByPk(user.erc20_wallet_id, { transaction: t });
    } else {
      const { address, privateKey } = await generateERC20Wallet();
      erc20Wallet = await Wallet.create({
        user_id: userId,
        address,
        encrypted_private_key: encrypt(privateKey),
        chain_type: 'ERC20',
      }, { transaction: t });
      user.erc20_wallet_id = erc20Wallet.id;
    }

    // TRC20 wallet
    if (user.trc20_wallet_id) {
      trc20Wallet = await Wallet.findByPk(user.trc20_wallet_id, { transaction: t });
    } else {
      const { address, privateKey } = await generateTRC20Wallet();
      trc20Wallet = await Wallet.create({
        user_id: userId,
        address,
        encrypted_private_key: encrypt(privateKey),
        chain_type: 'TRC20',
      }, { transaction: t });
      user.trc20_wallet_id = trc20Wallet.id;

      // Activate new TRC20 address by sending 1.001 TRX
      const gasKey = process.env.TRC20_COLLECTION_PRIVATE_KEY;
      if (gasKey) {
        try {
          const gasTronWeb = new TronWeb({
            fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
            headers: process.env.TRON_API_KEY
              ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
              : {},
            privateKey: gasKey,
          });
          const activateTx = await gasTronWeb.trx.sendTransaction(address, 1_001_000); // 1.001 TRX
          console.log(`[Wallet] TRC20 activated ${address}, txid: ${activateTx.txid}`);
        } catch (activateErr) {
          console.error(`[Wallet] TRC20 activation failed for ${address}: ${activateErr.message}`);
        }
      }
    }

    await user.save({ transaction: t });
    await t.commit();

    return {
      erc20: { id: erc20Wallet.id, address: erc20Wallet.address },
      trc20: { id: trc20Wallet.id, address: trc20Wallet.address },
    };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = {
  generateERC20Wallet,
  generateTRC20Wallet,
  getOrCreateWallets,
  getTronWeb,
};
