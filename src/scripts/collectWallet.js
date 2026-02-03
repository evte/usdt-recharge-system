#!/usr/bin/env node

/**
 * Manual TRC20 USDT collection for a specific wallet address.
 *
 * Usage:
 *   node src/scripts/collectWallet.js <TRC20_WALLET_ADDRESS>
 */

require('dotenv').config();

const TronWeb = require('tronweb');
const sequelize = require('../config/database');
const { Wallet, Deposit } = require('../models');
const { decrypt } = require('../utils/crypto');
const gasProvider = require('../services/gasProviderService');

const address = process.argv[2];

if (!address) {
  console.error('Usage: node src/scripts/collectWallet.js <TRC20_WALLET_ADDRESS>');
  process.exit(1);
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

async function provisionGas(wallet, tronWeb) {
  const trxBalance = await tronWeb.trx.getBalance(wallet.address);
  const MIN_TRX = 15_000_000;

  console.log(`[Manual] TRX balance: ${trxBalance / 1e6} TRX`);

  if (trxBalance >= MIN_TRX) {
    console.log('[Manual] TRX sufficient, skipping gas provision');
    return true;
  }

  // Step 1: Try external energy provider
  if (gasProvider.isEnabled()) {
    console.log(`[Manual] Requesting energy from external provider for ${wallet.address}`);
    const result = await gasProvider.requestGas({ address: wallet.address });

    if (result.success) {
      console.log(`[Manual] External energy delegated, txid: ${result.txid || 'N/A'}, waiting 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      return true;
    }

    console.warn(`[Manual] External energy failed: ${result.message}, falling back to built-in`);
  } else {
    console.log('[Manual] External gas provider not enabled');
  }

  // Step 2: Fallback to built-in self-fund
  const collectionKey = process.env.TRC20_COLLECTION_PRIVATE_KEY;
  if (!collectionKey) {
    console.error('[Manual] TRC20_COLLECTION_PRIVATE_KEY not configured, cannot send TRX');
    return false;
  }

  const feeTronWeb = createTronWeb(collectionKey);
  console.log(`[Manual] Sending ${MIN_TRX / 1e6} TRX (built-in) to ${wallet.address}`);
  const sendTrx = await feeTronWeb.trx.sendTransaction(wallet.address, MIN_TRX);
  console.log(`[Manual] TRX sent, txid: ${sendTrx.txid}`);
  await new Promise(r => setTimeout(r, 5000));
  return true;
}

async function main() {
  console.log(`[Manual] Starting TRC20 collection for ${address}`);

  await sequelize.authenticate();
  console.log('[Manual] Database connected');

  // 1. Look up wallet
  const wallet = await Wallet.findOne({ where: { address, chain_type: 'TRC20' } });
  if (!wallet) {
    console.error(`[Manual] Wallet not found: ${address}`);
    process.exit(1);
  }
  console.log(`[Manual] Wallet found: id=${wallet.id}, user_id=${wallet.user_id}`);

  // 2. Check USDT balance
  const collectionAddress = process.env.TRC20_COLLECTION_ADDRESS;
  const usdtContractAddr = process.env.TRC20_USDT_CONTRACT;
  const minCollect = parseFloat(process.env.MIN_COLLECT_AMOUNT) || 1;

  const privateKey = decrypt(wallet.encrypted_private_key);
  const tronWeb = createTronWeb(privateKey);
  const contract = await tronWeb.contract().at(usdtContractAddr);
  const balanceRaw = await contract.methods.balanceOf(wallet.address).call();
  const balance = Number(balanceRaw) / 1e6;

  console.log(`[Manual] USDT balance: ${balance}, min collect: ${minCollect}, collection address: ${collectionAddress}`);

  if (balance < minCollect) {
    console.log(`[Manual] Balance ${balance} below minimum ${minCollect}, nothing to collect`);
    process.exit(0);
  }

  const reserveUsdt = parseFloat(process.env.COLLECT_RESERVE_AMOUNT) || 0.1;
  const reserveRaw = BigInt(Math.round(reserveUsdt * 1e6));
  const transferRaw = BigInt(balanceRaw.toString()) - reserveRaw;

  if (transferRaw <= 0n) {
    console.log(`[Manual] Balance ${balance} not enough after reserve ${reserveUsdt}, nothing to collect`);
    process.exit(0);
  }

  const transferNum = Number(transferRaw) / 1e6;

  // 3. Provision gas
  const gasReady = await provisionGas(wallet, tronWeb);
  if (!gasReady) {
    console.error('[Manual] Gas provision failed, aborting');
    process.exit(1);
  }

  // 4. Transfer USDT
  console.log(`[Manual] Transferring ${transferNum} USDT to ${collectionAddress} (reserving ${reserveUsdt})...`);
  const tx = await contract.methods.transfer(
    collectionAddress,
    transferRaw
  ).send({ feeLimit: 50_000_000 });

  console.log(`[Manual] Transfer success, txid: ${tx}`);

  // 5. Update deposit status
  const t = await sequelize.transaction();
  try {
    const [count] = await Deposit.update(
      { status: 'collected' },
      { where: { wallet_id: wallet.id, chain_type: 'TRC20', status: 'confirmed' }, transaction: t }
    );
    await t.commit();
    console.log(`[Manual] Updated ${count} deposit(s) to 'collected'`);
  } catch (dbErr) {
    await t.rollback();
    console.error(`[Manual] DB update error: ${dbErr.message}`);
  }

  console.log('[Manual] Done');
}

main()
  .catch(err => console.error(`[Manual] Fatal error: ${err.message}`))
  .finally(() => sequelize.close().then(() => process.exit()));
