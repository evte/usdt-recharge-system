const { ethers } = require('ethers');
const TronWeb = require('tronweb');
const { Wallet, Deposit, User, ScanState } = require('../models');
const sequelize = require('../config/database');
const { toDecimalString } = require('../utils/crypto');

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const TOKEN_DECIMALS = 6; // Both USDT and USDC use 6 decimals
const SCAN_INTERVAL = 3000; // 3 seconds
const MAX_BLOCKS_PER_TICK = 50; // Max blocks to enqueue per tick, prevent request explosion
const BLOCK_PROCESS_DELAY = 100; // ms delay between processing blocks
const MAX_ERROR_BACKOFF = 30000; // Max backoff delay on consecutive errors (30s)

// Token contract configs: [{ address, tokenType }]
function getERC20Tokens() {
  const tokens = [];
  if (process.env.ERC20_USDT_CONTRACT) tokens.push({ address: process.env.ERC20_USDT_CONTRACT, tokenType: 'USDT' });
  if (process.env.ERC20_USDC_CONTRACT) tokens.push({ address: process.env.ERC20_USDC_CONTRACT, tokenType: 'USDC' });
  return tokens;
}

function getTRC20Tokens() {
  const tokens = [];
  if (process.env.TRC20_USDT_CONTRACT) tokens.push({ address: process.env.TRC20_USDT_CONTRACT, tokenType: 'USDT' });
  if (process.env.TRC20_USDC_CONTRACT) tokens.push({ address: process.env.TRC20_USDC_CONTRACT, tokenType: 'USDC' });
  return tokens;
}

// ==================== Simple Block Queue ====================

function createBlockQueue(name, processor) {
  const queue = [];
  let processing = false;
  let consecutiveErrors = 0;

  function enqueue(blockNum) {
    queue.push(blockNum);
    drain();
  }

  function enqueueBatch(from, to) {
    for (let i = from; i <= to; i++) {
      queue.push(i);
    }
    drain();
  }

  async function drain() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const blockNum = queue.shift();
      try {
        await processor(blockNum);
        consecutiveErrors = 0;
        // Small delay between blocks to avoid hammering the RPC
        if (queue.length > 0) {
          await new Promise(r => setTimeout(r, BLOCK_PROCESS_DELAY));
        }
      } catch (err) {
        consecutiveErrors++;
        const backoff = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), MAX_ERROR_BACKOFF);
        console.error(`[${name}] Queue process error at block ${blockNum} (errors: ${consecutiveErrors}, backoff: ${backoff}ms):`, err.message);
        // Put the failed block back at the front of the queue for retry
        queue.unshift(blockNum);
        await new Promise(r => setTimeout(r, backoff));
        // After too many consecutive errors, stop processing and let next tick retry
        if (consecutiveErrors >= 10) {
          console.error(`[${name}] Too many consecutive errors (${consecutiveErrors}), pausing queue`);
          break;
        }
      }
    }

    processing = false;
  }

  function size() { return queue.length; }

  return { enqueue, enqueueBatch, size };
}

// ==================== Address Cache ====================

let erc20AddrMap = new Map();
let trc20AddrMap = new Map();

async function refreshAddressCache() {
  const erc20Wallets = await Wallet.findAll({
    where: { chain_type: 'ERC20' },
    attributes: ['id', 'address', 'user_id'],
  });
  const newErc20 = new Map();
  for (const w of erc20Wallets) {
    newErc20.set(w.address.toLowerCase(), { walletId: w.id, userId: w.user_id });
  }
  erc20AddrMap = newErc20;

  const trc20Wallets = await Wallet.findAll({
    where: { chain_type: 'TRC20' },
    attributes: ['id', 'address', 'user_id'],
  });
  const newTrc20 = new Map();
  for (const w of trc20Wallets) {
    newTrc20.set(w.address, { walletId: w.id, userId: w.user_id });
  }
  trc20AddrMap = newTrc20;
}

// ==================== Deposit Helper ====================

async function saveDeposit({ userId, walletId, txid, amount, chainType, tokenType, fromAddress, blockNumber }) {
  const t = await sequelize.transaction();
  try {
    const [deposit, created] = await Deposit.findOrCreate({
      where: { txid },
      defaults: {
        user_id: userId,
        wallet_id: walletId,
        txid,
        amount,
        token_type: tokenType || 'USDT',
        chain_type: chainType,
        from_address: fromAddress,
        block_number: blockNumber,
        status: 'confirmed',
      },
      transaction: t,
    });

    if (created) {
      await User.increment('balance', {
        by: amount,
        where: { id: userId },
        transaction: t,
      });
      console.log(`[${chainType}] Deposit: ${amount} ${tokenType} -> user ${userId}, tx: ${txid.slice(0, 16)}...`);
    } else if (deposit.status !== 'confirmed') {
      await deposit.update({ status: 'confirmed' }, { transaction: t });
      console.log(`[${chainType}] Deposit status fixed -> confirmed, tx: ${txid.slice(0, 16)}...`);
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    console.error(`[${chainType}] Deposit save error tx ${txid.slice(0, 16)}:`, err.message);
  }
}

// ==================== ERC20 Block Processor ====================

let ethProvider = null;

function getEthProvider() {
  if (!ethProvider) {
    ethProvider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  }
  return ethProvider;
}

async function processERC20Block(blockNum) {
  const provider = getEthProvider();
  const tokens = getERC20Tokens();

  for (const { address: contractAddr, tokenType } of tokens) {
    const logs = await provider.getLogs({
      address: contractAddr,
      topics: [TRANSFER_TOPIC],
      fromBlock: blockNum,
      toBlock: blockNum,
    });

    for (const log of logs) {
      try {
        const from = ethers.getAddress('0x' + log.topics[1].slice(26));
        const to = ethers.getAddress('0x' + log.topics[2].slice(26));
        const value = BigInt(log.data);
        const amount = toDecimalString(value, TOKEN_DECIMALS);

        const match = erc20AddrMap.get(to.toLowerCase());
        if (!match) continue;

        await saveDeposit({
          userId: match.userId,
          walletId: match.walletId,
          txid: log.transactionHash,
          amount,
          chainType: 'ERC20',
          tokenType,
          fromAddress: from,
          blockNumber: blockNum,
        });
      } catch (decodeErr) {
        console.error(`[ERC20] Decode error block ${blockNum}:`, decodeErr.message);
      }
    }
  }

  await setLastBlock('ERC20', blockNum);
}

// ==================== TRC20 Block Processor ====================

let tronWebInstance = null;

function getTronWeb() {
  if (!tronWebInstance) {
    tronWebInstance = new TronWeb({
      fullHost: process.env.TRON_API_URL || 'https://api.trongrid.io',
      headers: process.env.TRON_API_KEY
        ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
        : {},
    });
  }
  return tronWebInstance;
}

async function processTRC20Block(blockNum) {
  const tronWeb = getTronWeb();
  const tokens = getTRC20Tokens();
  // Build a map: base58 contract address -> tokenType
  const tokenMap = new Map();
  for (const { address, tokenType } of tokens) {
    tokenMap.set(address, tokenType);
  }

  const block = await tronWeb.trx.getBlock(blockNum);
  if (!block || !block.transactions) {
    await setLastBlock('TRC20', blockNum);
    return;
  }

  for (const tx of block.transactions) {
    if (!tx.raw_data?.contract?.length) continue;

    const contract = tx.raw_data.contract[0];
    if (contract.type !== 'TriggerSmartContract') continue;

    const param = contract.parameter.value;

    let contractAddr;
    try {
      contractAddr = tronWeb.address.fromHex(param.contract_address);
    } catch (_) { continue; }

    const tokenType = tokenMap.get(contractAddr);
    if (!tokenType) continue;

    const data = param.data;
    if (!data || data.length < 136) continue;
    if (data.slice(0, 8) !== 'a9059cbb') continue;

    let toAddr;
    try {
      toAddr = tronWeb.address.fromHex('41' + data.slice(32, 72));
    } catch (_) { continue; }

    const match = trc20AddrMap.get(toAddr);
    if (!match) continue;

    // Check transaction success
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS') continue;

    const valueBig = BigInt('0x' + data.slice(72, 136));
    const amount = toDecimalString(valueBig, TOKEN_DECIMALS);

    let fromAddr = '';
    try { fromAddr = tronWeb.address.fromHex(param.owner_address); } catch (_) {}

    await saveDeposit({
      userId: match.userId,
      walletId: match.walletId,
      txid: tx.txID,
      amount,
      chainType: 'TRC20',
      tokenType,
      fromAddress: fromAddr,
      blockNumber: blockNum,
    });
  }

  await setLastBlock('TRC20', blockNum);
}

// ==================== Scan State ====================

async function getLastBlock(chainType) {
  const [state] = await ScanState.findOrCreate({
    where: { chain_type: chainType },
    defaults: { last_block: 0 },
  });
  return Number(state.last_block);
}

async function setLastBlock(chainType, blockNumber) {
  await ScanState.update(
    { last_block: blockNumber },
    { where: { chain_type: chainType } }
  );
}

// Reset to latest block on startup (only if no existing state or explicitly provided)
async function initScanState(chainType, latestBlock) {
  const existing = await ScanState.findOne({ where: { chain_type: chainType } });
  if (existing && existing.last_block > 0) {
    console.log(`[${chainType}] Keeping existing scan state at block ${existing.last_block}`);
    return;
  }
  await ScanState.upsert({ chain_type: chainType, last_block: latestBlock });
  console.log(`[${chainType}] Scan state initialized to block ${latestBlock}`);
}

// ==================== Scanner Loops ====================

const erc20Queue = createBlockQueue('ERC20', processERC20Block);
const trc20Queue = createBlockQueue('TRC20', processTRC20Block);

let erc20Timer = null;
let trc20Timer = null;
let addressCacheTimer = null;

async function tickERC20() {
  try {
    const provider = getEthProvider();
    const currentBlock = await provider.getBlockNumber();
    const lastBlock = await getLastBlock('ERC20');

    if (currentBlock <= lastBlock) return;

    const from = lastBlock + 1;
    const pending = erc20Queue.size();
    // Don't enqueue too much if queue is backed up
    if (pending > 200) {
      console.log(`[ERC20] Queue backed up (${pending}), waiting...`);
      return;
    }

    // Cap the batch size to prevent request explosion
    const to = Math.min(currentBlock, from + MAX_BLOCKS_PER_TICK - 1);
    const behind = currentBlock - from + 1;
    if (behind > MAX_BLOCKS_PER_TICK) {
      console.log(`[ERC20] Behind ${behind} blocks, capping to ${MAX_BLOCKS_PER_TICK} per tick`);
    }

    console.log(`[ERC20] Enqueuing blocks ${from} -> ${to} (${to - from + 1} blocks)`);
    erc20Queue.enqueueBatch(from, to);
  } catch (err) {
    console.error('[ERC20] Tick error:', err.message);
  }
}

async function tickTRC20() {
  try {
    const tronWeb = getTronWeb();
    const blockInfo = await tronWeb.trx.getCurrentBlock();
    const currentBlock = blockInfo.block_header.raw_data.number;
    const lastBlock = await getLastBlock('TRC20');

    if (currentBlock <= lastBlock) return;

    const from = lastBlock + 1;
    const pending = trc20Queue.size();
    if (pending > 200) {
      console.log(`[TRC20] Queue backed up (${pending}), waiting...`);
      return;
    }

    // Cap the batch size to prevent request explosion
    const to = Math.min(currentBlock, from + MAX_BLOCKS_PER_TICK - 1);
    const behind = currentBlock - from + 1;
    if (behind > MAX_BLOCKS_PER_TICK) {
      console.log(`[TRC20] Behind ${behind} blocks, capping to ${MAX_BLOCKS_PER_TICK} per tick`);
    }

    console.log(`[TRC20] Enqueuing blocks ${from} -> ${to} (${to - from + 1} blocks)`);
    trc20Queue.enqueueBatch(from, to);
  } catch (err) {
    console.error('[TRC20] Tick error:', err.message);
  }
}

async function startScanner() {
  console.log(`[Scanner] Starting with ${SCAN_INTERVAL}ms interval, queue-based processing`);

  // Load address cache
  await refreshAddressCache();
  console.log(`[Scanner] Address cache loaded: ERC20=${erc20AddrMap.size}, TRC20=${trc20AddrMap.size}`);

  // Refresh address cache every 30s to pick up new wallets
  addressCacheTimer = setInterval(refreshAddressCache, 30000);

  // Initialize scan state — keep existing DB state if available, only set latest block for first-time setup
  try {
    const provider = getEthProvider();
    const ethBlock = await provider.getBlockNumber();
    await initScanState('ERC20', ethBlock);
  } catch (err) {
    console.error('[ERC20] Init error (will use existing DB state or retry on tick):', err.message);
    // Do NOT reset to 0 — let tick pick up from existing DB state
  }

  try {
    const tronWeb = getTronWeb();
    const blockInfo = await tronWeb.trx.getCurrentBlock();
    const trcBlock = blockInfo.block_header.raw_data.number;
    await initScanState('TRC20', trcBlock);
  } catch (err) {
    console.error('[TRC20] Init error (will use existing DB state or retry on tick):', err.message);
    // Do NOT reset to 0 — let tick pick up from existing DB state
  }

  // Start tick loops — 3 seconds
  erc20Timer = setInterval(tickERC20, SCAN_INTERVAL);
  trc20Timer = setInterval(tickTRC20, SCAN_INTERVAL);
}

function stopScanner() {
  if (erc20Timer) clearInterval(erc20Timer);
  if (trc20Timer) clearInterval(trc20Timer);
  if (addressCacheTimer) clearInterval(addressCacheTimer);
  console.log('[Scanner] Stopped');
}

module.exports = { startScanner, stopScanner };
