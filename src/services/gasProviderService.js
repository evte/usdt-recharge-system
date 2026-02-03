/**
 * TRC20 Energy Provisioning Service (trx-api.com)
 *
 * Delegates energy to a target wallet via trx-api.com before TRC20 USDT collection.
 *
 * .env config:
 *   GAS_PROVIDER_ENABLED=true                        # Enable/disable
 *   GAS_PROVIDER_API_URL=https://api.trx-api.com     # Base URL
 *   GAS_PROVIDER_API_KEY=your-bearer-token            # Bearer token
 *   GAS_PROVIDER_TIMEOUT=30000                        # Request timeout in ms
 *
 * API contract (trx-api.com):
 *   POST {baseUrl}/api/tron/delegate-resource
 *   Headers: { "Authorization": "Bearer {token}", "Content-Type": "application/json" }
 *   Body: { "receiver_address": "T...", "amount": 1, "time": 10 }
 *   Response 200: { "success": true, "txid": "...", "message": "...", "cost": 3 }
 */

const axios = require('axios');

function isEnabled() {
  return process.env.GAS_PROVIDER_ENABLED === 'true' && !!process.env.GAS_PROVIDER_API_URL;
}

/**
 * Request energy delegation from trx-api.com.
 *
 * @param {object} params
 * @param {string} params.address - Target TRON wallet to receive energy
 * @returns {Promise<{success: boolean, txid?: string, message?: string}>}
 */
async function requestGas({ address }) {
  if (!isEnabled()) {
    return { success: false, message: 'Gas provider not enabled, use built-in' };
  }

  const baseUrl = process.env.GAS_PROVIDER_API_URL.replace(/\/+$/, '');
  const apiKey = process.env.GAS_PROVIDER_API_KEY || '';
  const timeout = parseInt(process.env.GAS_PROVIDER_TIMEOUT) || 30000;

  try {
    const url = `${baseUrl}/api/tron/delegate-resource`;
    const body = { receiver_address: address, amount: 1, time: 10, activate_address: 1 };
    console.log(`[GasProvider] POST ${url}`, JSON.stringify(body));

    const { data } = await axios.post(
      url,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout,
      }
    );

    if (data && data.success) {
      console.log(`[GasProvider] TRC20 energy delegated to ${address}, txid: ${data.txid || 'N/A'}, cost: ${data.cost || 'N/A'} TRX`);
      return { success: true, txid: data.txid, message: data.message };
    }

    console.warn(`[GasProvider] TRC20 energy delegation failed: ${data?.message || 'unknown'}`);
    return { success: false, message: data?.message || 'Provider returned failure' };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error(`[GasProvider] TRC20 request error for ${address}: ${msg}`);
    return { success: false, message: msg };
  }
}

module.exports = { isEnabled, requestGas };
