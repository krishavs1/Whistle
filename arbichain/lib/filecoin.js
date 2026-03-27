/**
 * ArbiChain - Filecoin Storage Utilities
 * Powered by Synapse SDK for Filecoin Onchain Cloud
 *
 * Features:
 * - On-chain verifiable storage proofs (PDP)
 * - Permanent storage on Filecoin network
 * - CommP (PieceCID) based addressing
 */

require('dotenv').config();
const { ethers } = require('ethers');

// ============ Configuration ============

const CONFIG = {
  calibration: {
    rpcUrl: 'https://api.calibration.node.glif.io/rpc/v1',
    chainId: 314159,
    explorer: 'https://calibration.filfox.info'
  },
  mainnet: {
    rpcUrl: 'https://api.node.glif.io/rpc/v1',
    chainId: 314,
    explorer: 'https://filfox.info'
  }
};

// In-memory store for mock uploads
const mockStore = new Map();

// Synapse instances (lazy initialized)
let synapseInstance = null;
let isSetupComplete = false;

// ============ Synapse SDK ============

/**
 * Initialize Synapse SDK with payment setup
 */
async function initSynapse() {
  if (synapseInstance && isSetupComplete) return synapseInstance;

  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[Synapse] FILECOIN_PRIVATE_KEY not set');
    return null;
  }

  try {
    const { Synapse, RPC_URLS, TOKENS, CONTRACT_ADDRESSES } = await import('@filoz/synapse-sdk');

    const network = process.env.FILECOIN_NETWORK || 'calibration';
    const rpcUrl = network === 'mainnet' ? RPC_URLS.mainnet.http : RPC_URLS.calibration.http;

    console.log('[Synapse] Initializing SDK...');

    synapseInstance = await Synapse.create({
      privateKey: privateKey,
      rpcURL: rpcUrl
    });

    const wallet = new ethers.Wallet(privateKey);
    console.log(`[Synapse] Connected as: ${wallet.address}`);
    console.log(`[Synapse] Network: ${network}`);

    // Check USDFC balance
    const balance = await synapseInstance.payments.getBalance();
    console.log(`[Synapse] USDFC Balance: ${ethers.formatUnits(balance, 18)} USDFC`);

    if (balance === 0n) {
      console.log('[Synapse] No USDFC deposited. Get tokens from:');
      console.log('         https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
      console.log('         Then run: node scripts/setup-synapse.js');
      return null;
    }

    isSetupComplete = true;
    return synapseInstance;

  } catch (error) {
    console.error('[Synapse] Init failed:', error.message);
    return null;
  }
}

/**
 * Setup Synapse payments (deposit + approve)
 * Run this once after getting USDFC from faucet
 */
async function setupPayments(depositAmount = '2.5') {
  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('FILECOIN_PRIVATE_KEY not set');
  }

  const { Synapse, RPC_URLS, TOKENS, CONTRACT_ADDRESSES } = await import('@filoz/synapse-sdk');

  const network = process.env.FILECOIN_NETWORK || 'calibration';
  const rpcUrl = network === 'mainnet' ? RPC_URLS.mainnet.http : RPC_URLS.calibration.http;

  console.log('[Synapse] Setting up payments...');

  const synapse = await Synapse.create({
    privateKey: privateKey,
    rpcURL: rpcUrl
  });

  // Get address from private key using ethers
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  console.log(`[Synapse] Address: ${address}`);

  // Check current USDFC wallet balance (not deposited yet)
  const httpRpcUrl = network === 'mainnet'
    ? 'https://api.node.glif.io/rpc/v1'
    : 'https://api.calibration.node.glif.io/rpc/v1';
  const provider = new ethers.JsonRpcProvider(httpRpcUrl);

  // USDFC token addresses (hardcoded since SDK returns symbol not address)
  const networkKey = network === 'mainnet' ? 'mainnet' : 'calibration';
  const USDFC_ADDRESSES = {
    calibration: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
    mainnet: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045' // TODO: update for mainnet
  };
  const usdfcAddress = USDFC_ADDRESSES[networkKey];

  console.log(`[Synapse] USDFC token address: ${usdfcAddress}`);

  const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
  const usdfc = new ethers.Contract(usdfcAddress, erc20Abi, provider);
  const walletBalance = await usdfc.balanceOf(address);

  console.log(`[Synapse] Wallet USDFC: ${ethers.formatUnits(walletBalance, 18)}`);

  if (walletBalance === 0n) {
    console.log('\n❌ No USDFC in wallet!');
    console.log('   Get USDFC from: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
    console.log(`   Your address: ${address}`);
    return false;
  }

  // Deposit USDFC
  const amount = ethers.parseUnits(depositAmount, 18);
  console.log(`[Synapse] Depositing ${depositAmount} USDFC...`);

  // Pass USDFC token - SDK expects the token object or address
  const depositTx = await synapse.payments.deposit(amount);
  console.log(`[Synapse] Deposit TX: ${depositTx.hash}`);
  await depositTx.wait();
  console.log('[Synapse] Deposit confirmed!');

  // Approve Warm Storage service (formerly Pandora)
  const warmStorageAddress = CONTRACT_ADDRESSES.PANDORA_SERVICE?.[networkKey] ||
    CONTRACT_ADDRESSES.WARM_STORAGE_SERVICE?.[networkKey];

  if (warmStorageAddress) {
    console.log('[Synapse] Approving Warm Storage service...');
    console.log(`[Synapse] Service address: ${warmStorageAddress}`);

    const rateAllowance = ethers.parseUnits('10', 18);    // 10 USDFC per epoch
    const lockupAllowance = ethers.parseUnits('100', 18); // 100 USDFC max lockup

    const approveTx = await synapse.payments.approveService(
      warmStorageAddress,
      rateAllowance,
      lockupAllowance
    );
    console.log(`[Synapse] Approve TX: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('[Synapse] Service approved!');
  } else {
    console.log('[Synapse] Warning: Could not find Warm Storage service address');
    console.log('[Synapse] Available addresses:', JSON.stringify(CONTRACT_ADDRESSES, null, 2));
  }

  // Check final balance
  const finalBalance = await synapse.payments.getBalance();
  console.log(`[Synapse] Deposited balance: ${ethers.formatUnits(finalBalance, 18)} USDFC`);

  console.log('\n✅ Synapse setup complete! You can now upload files.');
  return true;
}

/**
 * Get Synapse instance for storage operations
 */
async function getStorage() {
  const synapse = await initSynapse();
  return synapse;
}

// ============ Upload Functions ============

/**
 * Upload JSON to Filecoin
 */
async function uploadJson(data, options = {}) {
  const jsonString = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(jsonString);

  return await uploadBytes(bytes, { ...options, contentType: 'application/json' });
}

/**
 * Upload bytes to Filecoin
 */
async function uploadBytes(data, options = {}) {
  const synapse = await getStorage();

  if (!synapse) {
    console.log('[Synapse] Falling back to mock storage');
    return createMockUploadResult(data, options);
  }

  try {
    console.log(`[Synapse] Uploading ${data.length} bytes...`);

    const result = await synapse.storage.upload(data);

    console.log('[Synapse] Upload successful!');
    console.log(`[Synapse] PieceCID: ${result.pieceCid}`);

    return {
      cid: result.pieceCid,
      commp: result.pieceCid,
      size: data.length,
      provider: 'synapse',
      network: process.env.FILECOIN_NETWORK || 'calibration',
      timestamp: Date.now(),
      dataSetId: result.dataSetId || null
    };
  } catch (error) {
    console.error('[Synapse] Upload failed:', error.message);
    return createMockUploadResult(data, options);
  }
}

/**
 * Create mock upload for development
 */
function createMockUploadResult(content, options = {}) {
  const contentStr = content instanceof Uint8Array
    ? new TextDecoder().decode(content)
    : (typeof content === 'string' ? content : JSON.stringify(content));

  const mockCid = `baga6ea4seaq${generateMockHash(contentStr)}`;

  mockStore.set(mockCid, {
    content: contentStr,
    uploadedAt: Date.now()
  });

  console.log('[Filecoin] Using mock storage');

  return {
    cid: mockCid,
    commp: mockCid,
    size: contentStr.length,
    provider: 'mock',
    timestamp: Date.now(),
    _isMock: true
  };
}

function generateMockHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).padStart(32, '0').slice(0, 32);
}

// ============ Retrieve Functions ============

/**
 * Retrieve content by CID/CommP
 */
async function retrieve(cid, options = {}) {
  if (!cid) throw new Error('CID required');

  // Check mock store
  if (mockStore.has(cid)) {
    const stored = mockStore.get(cid);
    let content = stored.content;
    if (options.asJson && typeof content === 'string') {
      try { content = JSON.parse(content); } catch {}
    }
    return { content, cid, provider: 'mock-store', retrievedAt: Date.now() };
  }

  // Try Synapse download
  const synapse = await initSynapse();
  if (synapse) {
    try {
      console.log(`[Synapse] Downloading ${cid}...`);
      const data = await synapse.storage.download(cid);
      let content = options.asJson ? JSON.parse(new TextDecoder().decode(data)) : data;
      console.log('[Synapse] Download complete');
      return { content, cid, provider: 'synapse', retrievedAt: Date.now() };
    } catch (error) {
      console.error('[Synapse] Download failed:', error.message);
    }
  }

  throw new Error(`Failed to retrieve ${cid}`);
}

async function retrieveJson(cid) {
  const result = await retrieve(cid, { asJson: true });
  return result.content;
}

async function exists(cid) {
  if (mockStore.has(cid)) return true;
  try { await retrieve(cid); return true; } catch { return false; }
}

// ============ ArbiChain Helpers ============

async function uploadTaskSpec(taskSpec) {
  const spec = {
    type: 'arbichain_task_spec',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    ...taskSpec
  };
  const result = await uploadJson(spec, { name: 'task_spec.json' });
  console.log(`[ArbiChain] Task spec: ${result.cid}`);
  return result;
}

async function uploadDeliverable(deliverable) {
  const payload = {
    type: 'arbichain_deliverable',
    version: '1.0.0',
    submittedAt: new Date().toISOString(),
    ...deliverable
  };
  const result = await uploadJson(payload, { name: 'deliverable.json' });
  console.log(`[ArbiChain] Deliverable: ${result.cid}`);
  return result;
}

async function uploadEvidence(evidence) {
  const payload = {
    type: 'arbichain_evidence',
    version: '1.0.0',
    uploadedAt: new Date().toISOString(),
    ...evidence
  };
  const result = await uploadJson(payload, { name: 'evidence.json' });
  console.log(`[ArbiChain] Evidence: ${result.cid}`);
  return result;
}

// ============ Status ============

async function getStatus() {
  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    return {
      provider: 'mock',
      configured: false,
      message: 'Set FILECOIN_PRIVATE_KEY in .env'
    };
  }

  try {
    const synapse = await initSynapse();
    if (!synapse) {
      return {
        provider: 'synapse',
        configured: true,
        ready: false,
        message: 'Run: node scripts/setup-synapse.js'
      };
    }

    const balance = await synapse.payments.getBalance();
    return {
      provider: 'synapse',
      configured: true,
      ready: true,
      balance: ethers.formatUnits(balance, 18) + ' USDFC',
      network: process.env.FILECOIN_NETWORK || 'calibration'
    };
  } catch (error) {
    return {
      provider: 'synapse',
      configured: true,
      ready: false,
      error: error.message
    };
  }
}

// ============ Exports ============

module.exports = {
  initSynapse,
  setupPayments,
  getStorage,
  getStatus,

  uploadJson,
  uploadBytes,
  uploadTaskSpec,
  uploadDeliverable,
  uploadEvidence,

  retrieve,
  retrieveJson,
  exists,

  CONFIG
};
