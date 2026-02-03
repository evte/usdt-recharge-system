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

// ==================== Collection Queue ====================

function createCollectionQueue(name, processor) {
  const queue = [];
  const pending = new Set();
  let processing = false;

  function enqueue(item) {
    if (pending.has(item.walletId)) return;
    pending.add(item.walletId);
    queue.push(item);
    console.log(`[${name}] Enqueued wallet ${item.address} (queue size: ${queue.length})`);
    drain();
  }

  async function drain() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await processor(item);
      } catch (err) {
        console.error(`[${name}] Queue error for wallet ${item.address}:`, err.message);
      } finally {
        pending.delete(item.walletId);
      }
    }

    processing = false;
  }

  function size() { return queue.length; }

  return { enqueue, size };
}

// ==================== Providers ====================

let ethProvider = null;

function getEthProvider() {
  if (!ethProvider) {
    ethProvider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  }
  return ethProvider;
}

function createTronWeb(privateKey) {
  return new TronWeb({
    fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
    headers: process.env.TRON_API_KEY
      ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
      : {},
    privateKey,
  });
}

// ==================== ERC20 Gas Provisioning ====================

async function provisionERC20Gas({ wallet, provider, usdtContract, collectionAddress, balance }) {
  const ethBalance = await provider.getBalance(wallet.address);

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

  if (ethBalance >= gasCost) return true;

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

async function provisionTRC20Gas({ wallet, tronWeb }) {
  const trxBalance = await tronWeb.trx.getBalance(wallet.address);
  const MIN_TRX = 15_000_000;

  if (trxBalance >= MIN_TRX) return true;

  // Step 1: Try external energy provider (trx-api.com)
  if (gasProvider.isEnabled()) {
    console.log(`[Collector] TRC20 requesting energy from external provider for ${wallet.address}`);
    const result = await gasProvider.requestGas({ address: wallet.address });

    if (result.success) {
      console.log(`[Collector] TRC20 external energy delegated, txid: ${result.txid || 'N/A'}, waiting 2s...`);
      await new Promise(r => setTimeout(r, 2000));
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

  const feeTronWeb = createTronWeb(collectionKey);
  console.log(`[Collector] TRC20 sending TRX (built-in) to ${wallet.address}`);
  const sendTrx = await feeTronWeb.trx.sendTransaction(wallet.address, MIN_TRX);
  console.log(`[Collector] TRC20 TRX sent, txid: ${sendTrx.txid}`);
  await new Promise(r => setTimeout(r, 5000));
  return true;
}

// ==================== Queue Processors ====================

async function processERC20({ wallet }) {
  const provider = getEthProvider();
  const collectionAddress = process.env.ERC20_COLLECTION_ADDRESS;
  const usdtAddress = process.env.ERC20_USDT_CONTRACT;
  const minCollect = parseFloat(process.env.MIN_COLLECT_AMOUNT) || 1;

  const privateKey = decrypt(wallet.encrypted_private_key);
  const userWallet = new ethers.Wallet(privateKey, provider);
  const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, userWallet);
  const balance = await usdtContract.balanceOf(wallet.address);
  const balanceNum = Number(balance) / 1e6;

  if (balanceNum < minCollect) {
    console.log(`[Collector] ERC20 wallet ${wallet.address} balance ${balanceNum} below min, skipping`);
    return;
  }

  const reserveUsdt = parseFloat(process.env.COLLECT_RESERVE_AMOUNT) || 0.1;
  const reserveRaw = BigInt(Math.round(reserveUsdt * 1e6));
  const transferAmount = balance - reserveRaw;

  if (transferAmount <= 0n) {
    console.log(`[Collector] ERC20 wallet ${wallet.address} balance ${balanceNum} not enough after reserve ${reserveUsdt}, skipping`);
    return;
  }

  const transferNum = Number(transferAmount) / 1e6;
  const gasReady = await provisionERC20Gas({ wallet, provider, usdtContract, collectionAddress, transferAmount });
  if (!gasReady) return;

  const tx = await usdtContract.transfer(collectionAddress, transferAmount);
  const receipt = await tx.wait();
  console.log(`[Collector] ERC20 collected ${transferNum} USDT from ${wallet.address} (reserved ${reserveUsdt}), txid: ${receipt.hash}`);

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
}

async function processTRC20({ wallet }) {
  const collectionAddress = process.env.TRC20_COLLECTION_ADDRESS;
  const usdtContractAddr = process.env.TRC20_USDT_CONTRACT;
  const minCollect = parseFloat(process.env.MIN_COLLECT_AMOUNT) || 1;

  const privateKey = decrypt(wallet.encrypted_private_key);
  const tronWeb = createTronWeb(privateKey);
  const contract = await tronWeb.contract().at(usdtContractAddr);
  const balanceRaw = await contract.methods.balanceOf(wallet.address).call();
  const balance = Number(balanceRaw) / 1e6;

  if (balance < minCollect) {
    console.log(`[Collector] TRC20 wallet ${wallet.address} balance ${balance} below min, skipping`);
    return;
  }

  const reserveUsdt = parseFloat(process.env.COLLECT_RESERVE_AMOUNT) || 0.1;
  const reserveRaw = BigInt(Math.round(reserveUsdt * 1e6));
  const transferRaw = BigInt(balanceRaw.toString()) - reserveRaw;

  if (transferRaw <= 0n) {
    console.log(`[Collector] TRC20 wallet ${wallet.address} balance ${balance} not enough after reserve ${reserveUsdt}, skipping`);
    return;
  }

  const transferNum = Number(transferRaw) / 1e6;
  const gasReady = await provisionTRC20Gas({ wallet, tronWeb });
  if (!gasReady) return;

  const tx = await contract.methods.transfer(
    collectionAddress,
    transferRaw
  ).send({ feeLimit: 50_000_000 });

  console.log(`[Collector] TRC20 collected ${transferNum} USDT from ${wallet.address} (reserved ${reserveUsdt}), txid: ${tx}`);

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
}

// ==================== Queues ====================

const erc20Queue = createCollectionQueue('ERC20-Collect', processERC20);
const trc20Queue = createCollectionQueue('TRC20-Collect', processTRC20);

// ==================== Scan & Enqueue ====================

async function scanAndEnqueue() {
  // ERC20
  const erc20CollAddr = process.env.ERC20_COLLECTION_ADDRESS;
  if (erc20CollAddr) {
    const erc20Deposits = await Deposit.findAll({
      where: { chain_type: 'ERC20', status: 'confirmed' },
      attributes: ['wallet_id'],
      group: ['wallet_id'],
    });
    const erc20Ids = erc20Deposits.map(d => d.wallet_id);
    if (erc20Ids.length > 0) {
      const wallets = await Wallet.findAll({ where: { id: erc20Ids, chain_type: 'ERC20' } });
      for (const wallet of wallets) {
        erc20Queue.enqueue({ walletId: wallet.id, address: wallet.address, wallet });
      }
    }
  }

  // TRC20
  const trc20CollAddr = process.env.TRC20_COLLECTION_ADDRESS;
  if (trc20CollAddr) {
    const trc20Deposits = await Deposit.findAll({
      where: { chain_type: 'TRC20', status: 'confirmed' },
      attributes: ['wallet_id'],
      group: ['wallet_id'],
    });
    const trc20Ids = trc20Deposits.map(d => d.wallet_id);
    if (trc20Ids.length > 0) {
      const wallets = await Wallet.findAll({ where: { id: trc20Ids, chain_type: 'TRC20' } });
      for (const wallet of wallets) {
        trc20Queue.enqueue({ walletId: wallet.id, address: wallet.address, wallet });
      }
    }
  }
}

// ==================== Lifecycle ====================

let collectorTimer = null;

function startCollector() {
  const interval = parseInt(process.env.COLLECT_INTERVAL_MS) || 60000;
  const trc20GasMode = gasProvider.isEnabled() ? 'external API + built-in fallback' : 'built-in only';
  console.log(`[Collector] Starting with interval ${interval}ms, ERC20 gas: built-in, TRC20 gas: ${trc20GasMode}`);

  setTimeout(() => {
    scanAndEnqueue();
    collectorTimer = setInterval(scanAndEnqueue, interval);
  }, 30000);
}

function stopCollector() {
  if (collectorTimer) clearInterval(collectorTimer);
  console.log('[Collector] Stopped');
}

module.exports = { startCollector, stopCollector };
