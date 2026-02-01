/**
 * Gas/Energy Provisioning Service
 *
 * Calls an external third-party API to provision gas (ETH) or energy (TRX)
 * to a target wallet address before USDT collection.
 *
 * .env config:
 *   GAS_PROVIDER_ENABLED=true                   # Enable/disable external gas provider
 *   GAS_PROVIDER_API_URL=https://xxx.com/api     # Base URL
 *   GAS_PROVIDER_API_KEY=your-api-key            # Auth key (sent as header)
 *   GAS_PROVIDER_TIMEOUT=30000                   # Request timeout in ms
 *
 * Expected external API contract:
 *
 *   POST {GAS_PROVIDER_API_URL}/provision
 *   Headers: { "x-api-key": GAS_PROVIDER_API_KEY, "Content-Type": "application/json" }
 *   Body: {
 *     "chain": "ETH" | "TRON",
 *     "address": "0x... | T...",
 *     "amount_usdt": "100.000000"   // USDT amount to be collected (for fee calculation)
 *   }
 *   Response 200: { "success": true, "txid": "0x...", "message": "..." }
 *   Response 4xx/5xx: { "success": false, "message": "reason" }
 *
 * If GAS_PROVIDER_ENABLED is not "true", falls back to the built-in
 * self-funded gas transfer (original behavior).
 */

const axios = require('axios');

function isEnabled() {
  return process.env.GAS_PROVIDER_ENABLED === 'true' && !!process.env.GAS_PROVIDER_API_URL;
}

/**
 * Request gas/energy provisioning from external provider.
 *
 * @param {object} params
 * @param {'ETH'|'TRON'} params.chain
 * @param {string} params.address   - Target wallet to receive gas/energy
 * @param {string} params.amountUsdt - USDT amount about to be collected
 * @returns {Promise<{success: boolean, txid?: string, message?: string}>}
 */
async function requestGas({ chain, address, amountUsdt }) {
  if (!isEnabled()) {
    return { success: false, message: 'Gas provider not enabled, use built-in' };
  }

  const baseUrl = process.env.GAS_PROVIDER_API_URL.replace(/\/+$/, '');
  const apiKey = process.env.GAS_PROVIDER_API_KEY || '';
  const timeout = parseInt(process.env.GAS_PROVIDER_TIMEOUT) || 30000;

  try {
    console.log(`[GasProvider] Requesting ${chain} gas for ${address}, usdt=${amountUsdt}`);

    const { data } = await axios.post(
      `${baseUrl}/provision`,
      {
        chain,
        address,
        amount_usdt: amountUsdt,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        timeout,
      }
    );

    if (data && data.success) {
      console.log(`[GasProvider] ${chain} gas provisioned for ${address}, txid: ${data.txid || 'N/A'}`);
      return { success: true, txid: data.txid, message: data.message };
    }

    console.warn(`[GasProvider] ${chain} gas provision failed: ${data?.message || 'unknown'}`);
    return { success: false, message: data?.message || 'Provider returned failure' };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error(`[GasProvider] ${chain} request error for ${address}: ${msg}`);
    return { success: false, message: msg };
  }
}

module.exports = { isEnabled, requestGas };
