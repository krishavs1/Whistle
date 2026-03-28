/**
 * Whistle - TRON Network Utilities
 * TronWeb setup and helper functions for Nile testnet
 */

const TronWeb = require('tronweb');

// ============ Network Configuration ============

const NETWORKS = {
  nile: {
    fullHost: 'https://nile.trongrid.io',
    fullNode: 'https://nile.trongrid.io',
    solidityNode: 'https://nile.trongrid.io',
    eventServer: 'https://nile.trongrid.io',
    chainId: '0xcd8690dc',
    explorerUrl: 'https://nile.tronscan.org'
  },
  shasta: {
    fullHost: 'https://api.shasta.trongrid.io',
    fullNode: 'https://api.shasta.trongrid.io',
    solidityNode: 'https://api.shasta.trongrid.io',
    eventServer: 'https://api.shasta.trongrid.io',
    chainId: '0x94a9059e',
    explorerUrl: 'https://shasta.tronscan.org'
  },
  mainnet: {
    fullHost: 'https://api.trongrid.io',
    fullNode: 'https://api.trongrid.io',
    solidityNode: 'https://api.trongrid.io',
    eventServer: 'https://api.trongrid.io',
    chainId: '0x2b6653dc',
    explorerUrl: 'https://tronscan.org'
  }
};

// Default to Nile testnet
const DEFAULT_NETWORK = 'nile';

// ============ TronWeb Instance Factory ============

/**
 * Create a TronWeb instance for the specified network
 * @param {string} privateKey - Private key for signing transactions
 * @param {string} network - Network name (nile, shasta, mainnet)
 * @returns {TronWeb} Configured TronWeb instance
 */
function createTronWeb(privateKey, network = DEFAULT_NETWORK) {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(', ')}`);
  }

  const tronWeb = new TronWeb({
    fullHost: config.fullHost,
    privateKey: privateKey
  });

  // Attach network info for reference
  tronWeb.networkConfig = config;
  tronWeb.networkName = network;

  return tronWeb;
}

/**
 * Create a read-only TronWeb instance (no private key)
 * @param {string} network - Network name
 * @returns {TronWeb} Read-only TronWeb instance
 */
function createReadOnlyTronWeb(network = DEFAULT_NETWORK) {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }

  return new TronWeb({
    fullHost: config.fullHost
  });
}

// ============ Address Utilities ============

/**
 * Convert hex address to base58 format
 * @param {string} hexAddress - Hex format address (41...)
 * @returns {string} Base58 format address (T...)
 */
function toBase58(hexAddress) {
  return TronWeb.address.fromHex(hexAddress);
}

/**
 * Convert base58 address to hex format
 * @param {string} base58Address - Base58 format address (T...)
 * @returns {string} Hex format address (41...)
 */
function toHex(base58Address) {
  return TronWeb.address.toHex(base58Address);
}

/**
 * Validate a TRON address
 * @param {string} address - Address to validate
 * @returns {boolean} Whether the address is valid
 */
function isValidAddress(address) {
  return TronWeb.isAddress(address);
}

/**
 * Generate a new random wallet
 * @returns {Object} Object containing address and privateKey
 */
function generateWallet() {
  const account = TronWeb.createAccount();
  return {
    address: account.address.base58,
    addressHex: account.address.hex,
    privateKey: account.privateKey
  };
}

// ============ Balance & Transaction Utilities ============

/**
 * Get TRX balance for an address
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} address - Address to check
 * @returns {Promise<number>} Balance in TRX
 */
async function getBalance(tronWeb, address) {
  const balanceSun = await tronWeb.trx.getBalance(address);
  return tronWeb.fromSun(balanceSun);
}

/**
 * Get TRX balance in SUN (smallest unit)
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} address - Address to check
 * @returns {Promise<number>} Balance in SUN
 */
async function getBalanceSun(tronWeb, address) {
  return await tronWeb.trx.getBalance(address);
}

/**
 * Send TRX to an address
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} toAddress - Recipient address
 * @param {number} amountTrx - Amount in TRX
 * @returns {Promise<Object>} Transaction result
 */
async function sendTrx(tronWeb, toAddress, amountTrx) {
  const amountSun = tronWeb.toSun(amountTrx);
  return await tronWeb.trx.sendTransaction(toAddress, amountSun);
}

/**
 * Get transaction info by ID
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} txId - Transaction ID
 * @returns {Promise<Object>} Transaction info
 */
async function getTransaction(tronWeb, txId) {
  return await tronWeb.trx.getTransaction(txId);
}

/**
 * Get transaction info including receipt
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} txId - Transaction ID
 * @returns {Promise<Object>} Transaction info with receipt
 */
async function getTransactionInfo(tronWeb, txId) {
  return await tronWeb.trx.getTransactionInfo(txId);
}

/**
 * Wait for transaction confirmation
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} txId - Transaction ID
 * @param {number} maxAttempts - Maximum polling attempts
 * @param {number} interval - Polling interval in ms
 * @returns {Promise<Object>} Confirmed transaction info
 */
async function waitForConfirmation(tronWeb, txId, maxAttempts = 40, interval = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const info = await tronWeb.trx.getTransactionInfo(txId);
      if (info && info.id) {
        if (info.receipt && info.receipt.result === 'REVERT') {
          let reason = 'unknown';
          try {
            const hex = info.contractResult?.[0] || '';
            if (hex.length > 8) {
              const bytes = Buffer.from(hex, 'hex');
              const strOffset = 4 + 32;
              const strLen = parseInt(hex.slice(strOffset * 2, (strOffset + 32) * 2), 16);
              reason = bytes.slice(strOffset + 32, strOffset + 32 + strLen).toString('utf8');
            }
          } catch {}
          throw new Error(`Transaction reverted: ${reason} (tx: ${txId})`);
        }
        return info;
      }
    } catch (e) {
      if (e.message?.startsWith('Transaction reverted')) throw e;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Transaction ${txId} not confirmed after ${maxAttempts} attempts`);
}

// ============ Contract Utilities ============

/**
 * Deploy a contract
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {Object} options - Deployment options
 * @param {string} options.abi - Contract ABI
 * @param {string} options.bytecode - Contract bytecode
 * @param {Array} options.parameters - Constructor parameters
 * @param {string} options.name - Contract name
 * @param {number} options.feeLimit - Fee limit in SUN
 * @returns {Promise<Object>} Deployed contract info
 */
async function deployContract(tronWeb, options) {
  const { abi, bytecode, parameters = [], name = 'Contract', feeLimit = 1000000000 } = options;

  const tx = await tronWeb.transactionBuilder.createSmartContract({
    abi,
    bytecode,
    parameters,
    name,
    feeLimit
  });

  const signedTx = await tronWeb.trx.sign(tx);
  const result = await tronWeb.trx.sendRawTransaction(signedTx);

  if (result.result) {
    // Wait for contract to be deployed
    await waitForConfirmation(tronWeb, result.txid);
    const info = await tronWeb.trx.getTransactionInfo(result.txid);

    return {
      txId: result.txid,
      contractAddress: tronWeb.address.fromHex(info.contract_address),
      contractAddressHex: info.contract_address
    };
  }

  throw new Error(`Contract deployment failed: ${JSON.stringify(result)}`);
}

/**
 * Get a contract instance
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} address - Contract address
 * @param {Array} abi - Contract ABI (optional, will fetch if not provided)
 * @returns {Promise<Object>} Contract instance
 */
async function getContract(tronWeb, address, abi = null) {
  if (abi) {
    return await tronWeb.contract(abi, address);
  }
  return await tronWeb.contract().at(address);
}

// ============ Event Utilities ============

/**
 * Get contract events
 * @param {TronWeb} tronWeb - TronWeb instance
 * @param {string} contractAddress - Contract address
 * @param {Object} options - Event query options
 * @returns {Promise<Array>} Array of events
 */
async function getContractEvents(tronWeb, contractAddress, options = {}) {
  const {
    eventName = null,
    sinceTimestamp = 0,
    limit = 100
  } = options;

  return await tronWeb.getEventResult(contractAddress, {
    eventName,
    sinceTimestamp,
    size: limit
  });
}

// ============ Conversion Utilities ============

/**
 * Convert TRX to SUN
 * @param {number} trx - Amount in TRX
 * @returns {number} Amount in SUN
 */
function toSun(trx) {
  return TronWeb.toSun(trx);
}

/**
 * Convert SUN to TRX
 * @param {number} sun - Amount in SUN
 * @returns {number} Amount in TRX
 */
function fromSun(sun) {
  return TronWeb.fromSun(sun);
}

/**
 * Generate a task ID from parameters
 * @param {string} buyer - Buyer address
 * @param {string} seller - Seller address
 * @param {number} timestamp - Timestamp
 * @param {string} nonce - Random nonce
 * @returns {string} bytes32 task ID
 */
function generateTaskId(buyer, seller, timestamp, nonce) {
  const data = `${buyer}${seller}${timestamp}${nonce}`;
  return TronWeb.sha3(data);
}

/**
 * Get explorer URL for a transaction
 * @param {string} txId - Transaction ID
 * @param {string} network - Network name
 * @returns {string} Explorer URL
 */
function getExplorerTxUrl(txId, network = DEFAULT_NETWORK) {
  const config = NETWORKS[network];
  return `${config.explorerUrl}/#/transaction/${txId}`;
}

/**
 * Get explorer URL for an address
 * @param {string} address - Address
 * @param {string} network - Network name
 * @returns {string} Explorer URL
 */
function getExplorerAddressUrl(address, network = DEFAULT_NETWORK) {
  const config = NETWORKS[network];
  return `${config.explorerUrl}/#/address/${address}`;
}

// ============ Exports ============

module.exports = {
  // Network config
  NETWORKS,
  DEFAULT_NETWORK,

  // TronWeb factory
  createTronWeb,
  createReadOnlyTronWeb,

  // Address utilities
  toBase58,
  toHex,
  isValidAddress,
  generateWallet,

  // Balance & transactions
  getBalance,
  getBalanceSun,
  sendTrx,
  getTransaction,
  getTransactionInfo,
  waitForConfirmation,

  // Contract utilities
  deployContract,
  getContract,
  getContractEvents,

  // Conversions
  toSun,
  fromSun,
  generateTaskId,

  // Explorer
  getExplorerTxUrl,
  getExplorerAddressUrl
};
