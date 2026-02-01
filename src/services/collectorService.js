const { ethers } = require('ethers');
const TronWeb = require('tronweb');
const { Wallet, Deposit } = require('../models');
const sequelize = require('../config/database');
const { decrypt } = require('../utils/crypto');
const gasProvider = require('./gasProviderService');

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

let collecting = false;

// ==================== ERC20 Gas Provisioning ====================

/**
 * Ensure target wallet has enough ETH gas before USDT transfer.
 * Uses dedicated gas master wallet (ERC20_GAS_PRIVATE_KEY) to send ETH.
 * Returns true if gas is ready, false to skip this wallet.
 */
async function provisionERC20Gas({ wallet, provider, usdtContract, collectionAddress, balance }) {
  const ethBalance = await provider.getBalance(wallet.address);

  // Estimate gas needed
  let gasEstimate;
  try {
    gasEstimate = await usdtContract.transfer.estimateGas(collectionAddress, balance);
    gasEstimate = gasEstimate * 12n / 10n;
  } catch (_) {
    gasEstimate = 80000n;
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
  const gasCost = gasEstimate * gasPrice;

  // Already have enough gas
  if (ethBalance >= gasCost) return true;

  // Send ETH from dedicated gas master wallet
  const gasPrivateKey = process.env.ERC20_GAS_PRIVATE_KEY;
  if (!gasPrivateKey) {
    console.error(`[Collector] ERC20_GAS_PRIVATE_KEY not configured, cannot send gas to ${wallet.address}, skipping`);
    return false;
  }

  const gasWallet = new ethers.Wallet(gasPrivateKey, provider);
  console.log(`[Collector] ERC20 sending ETH gas from ${gasWallet.address} to ${wallet.address}`);
  const gasTx = await gasWallet.sendTransaction({
    to: wallet.address,
    value: gasCost * 2n,
  });
  await gasTx.wait();
  console.log(`[Collector] ERC20 gas sent, txid: ${gasTx.hash}`);
  return true;
}

// ==================== TRC20 Gas Provisioning ====================

/**
 * Ensure target wallet has enough TRX for energy/bandwidth before USDT transfer.
 * Priority: external gas provider API > built-in self-fund.
 * Returns true if ready, false to skip.
 */
async function provisionTRC20Gas({ wallet, balance, tronWeb }) {
  const trxBalance = await tronWeb.trx.getBalance(wallet.address);
  const MIN_TRX = 15_000_000; // 15 TRX in Sun

  // Already have enough TRX
  if (trxBalance >= MIN_TRX) return true;

  // Step 1: Try external gas provider
  if (gasProvider.isEnabled()) {
    console.log(`[Collector] TRC20 requesting energy from external provider for ${wallet.address}`);
    const result = await gasProvider.requestGas({
      chain: 'TRON',
      address: wallet.address,
      amountUsdt: String(balance),
    });

    if (result.success) {
      console.log(`[Collector] TRC20 external energy provisioned, txid: ${result.txid || 'N/A'}, waiting...`);
      // Wait for TRX to arrive
      await waitForTrxBalance(tronWeb, wallet.address, MIN_TRX, 60000);
      return true;
    }

    console.warn(`[Collector] TRC20 external energy failed: ${result.message}, falling back to built-in`);
  }

  // Step 2: Fallback to built-in self-fund
  const collectionKey = process.env.TRC20_COLLECTION_PRIVATE_KEY;
  if (!collectionKey) {
    console.error(`[Collector] TRC20 no TRX available for ${wallet.address}, skipping`);
    return false;
  }

  const feeTronWeb = new TronWeb({
    fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
    headers: process.env.TRON_API_KEY
      ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
      : {},
    privateKey: collectionKey,
  });

  console.log(`[Collector] TRC20 sending TRX (built-in) to ${wallet.address}`);
  const sendTrx = await feeTronWeb.trx.sendTransaction(wallet.address, MIN_TRX);
  console.log(`[Collector] TRC20 TRX sent, txid: ${sendTrx.txid}`);
  await new Promise(r => setTimeout(r, 5000));
  return true;
}

// ==================== Balance Wait Helpers ====================

async function waitForGasBalance(provider, address, minBalance, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bal = await provider.getBalance(address);
    if (bal >= minBalance) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  console.warn(`[Collector] ETH gas wait timeout for ${address}`);
}

async function waitForTrxBalance(tronWeb, address, minBalance, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bal = await tronWeb.trx.getBalance(address);
    if (bal >= minBalance) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  console.warn(`[Collector] TRX balance wait timeout for ${address}`);
}

// ==================== Collection Logic ====================

async function collectERC20() {
  const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  const collectionAddress = process.env.ERC20_COLLECTION_ADDRESS;
  const usdtAddress = process.env.ERC20_USDT_CONTRACT;
  const minCollect = parseFloat(process.env.MIN_COLLECT_AMOUNT) || 1;

  if (!collectionAddress) {
    console.log('[Collector] ERC20 collection address not configured, skipping');
    return;
  }

  const deposits = await Deposit.findAll({
    where: { chain_type: 'ERC20', status: 'confirmed' },
    attributes: ['wallet_id'],
    group: ['wallet_id'],
  });

  const walletIds = deposits.map(d => d.wallet_id);
  if (walletIds.length === 0) return;

  const wallets = await Wallet.findAll({
    where: { id: walletIds, chain_type: 'ERC20' },
  });

  for (const wallet of wallets) {
    try {
      const privateKey = decrypt(wallet.encrypted_private_key);
      const userWallet = new ethers.Wallet(privateKey, provider);

      const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, userWallet);
      const balance = await usdtContract.balanceOf(wallet.address);
      const balanceNum = Number(balance) / 1e6;

      if (balanceNum < minCollect) {
        console.log(`[Collector] ERC20 wallet ${wallet.address} balance ${balanceNum} below min, skipping`);
        continue;
      }

      // ---- Gas provisioning (from dedicated gas master wallet) ----
      const gasReady = await provisionERC20Gas({
        wallet, provider,
        usdtContract, collectionAddress, balance,
      });
      if (!gasReady) continue;

      // ---- Transfer USDT ----
      const tx = await usdtContract.transfer(collectionAddress, balance);
      const receipt = await tx.wait();
      console.log(`[Collector] ERC20 collected ${balanceNum} USDT from ${wallet.address}, txid: ${receipt.hash}`);

      // Mark deposits as collected
      const t = await sequelize.transaction();
      try {
        await Deposit.update(
          { status: 'collected' },
          { where: { wallet_id: wallet.id, chain_type: 'ERC20', status: 'confirmed' }, transaction: t }
        );
        await t.commit();
      } catch (dbErr) {
        await t.rollback();
        console.error(`[Collector] ERC20 DB update error for wallet ${wallet.address}:`, dbErr.message);
      }
    } catch (err) {
      console.error(`[Collector] ERC20 collect error for wallet ${wallet.address}:`, err.message);
    }
  }
}

async function collectTRC20() {
  const collectionAddress = process.env.TRC20_COLLECTION_ADDRESS;
  const usdtContractAddr = process.env.TRC20_USDT_CONTRACT;
  const minCollect = parseFloat(process.env.MIN_COLLECT_AMOUNT) || 1;

  if (!collectionAddress) {
    console.log('[Collector] TRC20 collection address not configured, skipping');
    return;
  }

  const deposits = await Deposit.findAll({
    where: { chain_type: 'TRC20', status: 'confirmed' },
    attributes: ['wallet_id'],
    group: ['wallet_id'],
  });

  const walletIds = deposits.map(d => d.wallet_id);
  if (walletIds.length === 0) return;

  const wallets = await Wallet.findAll({
    where: { id: walletIds, chain_type: 'TRC20' },
  });

  for (const wallet of wallets) {
    try {
      const privateKey = decrypt(wallet.encrypted_private_key);

      const tronWeb = new TronWeb({
        fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
        headers: process.env.TRON_API_KEY
          ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
          : {},
        privateKey,
      });

      const contract = await tronWeb.contract().at(usdtContractAddr);
      const balanceRaw = await contract.methods.balanceOf(wallet.address).call();
      const balance = Number(balanceRaw) / 1e6;

      if (balance < minCollect) {
        console.log(`[Collector] TRC20 wallet ${wallet.address} balance ${balance} below min, skipping`);
        continue;
      }

      // ---- Gas/Energy provisioning (external API first, then built-in) ----
      const gasReady = await provisionTRC20Gas({ wallet, balance, tronWeb });
      if (!gasReady) continue;

      // ---- Transfer USDT ----
      const tx = await contract.methods.transfer(
        collectionAddress,
        BigInt(balanceRaw.toString())
      ).send({ feeLimit: 50_000_000 });

      console.log(`[Collector] TRC20 collected ${balance} USDT from ${wallet.address}, txid: ${tx}`);

      // Mark deposits as collected
      const t = await sequelize.transaction();
      try {
        await Deposit.update(
          { status: 'collected' },
          { where: { wallet_id: wallet.id, chain_type: 'TRC20', status: 'confirmed' }, transaction: t }
        );
        await t.commit();
      } catch (dbErr) {
        await t.rollback();
        console.error(`[Collector] TRC20 DB update error for wallet ${wallet.address}:`, dbErr.message);
      }
    } catch (err) {
      console.error(`[Collector] TRC20 collect error for wallet ${wallet.address}:`, err.message);
    }
  }
}

async function runCollection() {
  if (collecting) return;
  collecting = true;

  try {
    await collectERC20();
    await collectTRC20();
  } catch (err) {
    console.error('[Collector] Error:', err.message);
  } finally {
    collecting = false;
  }
}

let collectorTimer = null;

function startCollector() {
  const interval = parseInt(process.env.COLLECT_INTERVAL_MS) || 60000;
  const trc20GasMode = gasProvider.isEnabled() ? 'external API + built-in fallback' : 'built-in only';
  console.log(`[Collector] Starting with interval ${interval}ms, ERC20 gas: built-in, TRC20 gas: ${trc20GasMode}`);

  setTimeout(() => {
    runCollection();
    collectorTimer = setInterval(runCollection, interval);
  }, 30000);
}

function stopCollector() {
  if (collectorTimer) clearInterval(collectorTimer);
  console.log('[Collector] Stopped');
}

module.exports = { startCollector, stopCollector };
