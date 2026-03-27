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

// ============ Configuration ============

const CONFIG = {
  // Filecoin Calibration testnet (for development)
  calibration: {
    rpcUrl: 'https://api.calibration.node.glif.io/rpc/v1',
    wsUrl: 'wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1',
    chainId: 314159,
    explorer: 'https://calibration.filfox.info'
  },
  // Filecoin Mainnet (for production)
  mainnet: {
    rpcUrl: 'https://api.node.glif.io/rpc/v1',
    wsUrl: 'wss://wss.node.glif.io/apigw/lotus/rpc/v1',
    chainId: 314,
    explorer: 'https://filfox.info'
  }
};

// In-memory store for mock uploads (fallback when Synapse not configured)
const mockStore = new Map();

// Synapse SDK instance (lazy initialized)
let synapseInstance = null;
let storageInstance = null;

// ============ Synapse SDK Initialization ============

/**
 * Initialize Synapse SDK
 * @returns {Promise<Object>} Synapse instance
 */
async function initSynapse() {
  if (synapseInstance) return synapseInstance;

  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[Synapse] FILECOIN_PRIVATE_KEY not set, using mock storage');
    return null;
  }

  try {
    const { Synapse, RPC_URLS } = await import('@filoz/synapse-sdk');

    const network = process.env.FILECOIN_NETWORK || 'calibration';
    const rpcUrl = network === 'mainnet' ? RPC_URLS.mainnet.http : RPC_URLS.calibration.http;

    synapseInstance = await Synapse.create({
      privateKey: privateKey,
      rpcURL: rpcUrl
    });

    console.log('[Synapse] SDK initialized successfully');
    console.log(`[Synapse] Network: ${network}`);
    console.log(`[Synapse] Address: ${synapseInstance.getAddress()}`);

    return synapseInstance;
  } catch (error) {
    console.error('[Synapse] Failed to initialize:', error.message);
    return null;
  }
}

/**
 * Get or create storage manager
 * @returns {Promise<Object>} Storage manager instance
 */
async function getStorage() {
  if (storageInstance) return storageInstance;

  const synapse = await initSynapse();
  if (!synapse) return null;

  try {
    storageInstance = await synapse.createStorage();
    console.log('[Synapse] Storage manager created');
    return storageInstance;
  } catch (error) {
    console.error('[Synapse] Failed to create storage:', error.message);
    return null;
  }
}

// ============ Upload Functions ============

/**
 * Upload JSON data to Filecoin via Synapse
 * @param {Object} data - JSON data to upload
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result with CommP
 */
async function uploadJson(data, options = {}) {
  const jsonString = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(jsonString);

  return await uploadBytes(bytes, {
    ...options,
    contentType: 'application/json'
  });
}

/**
 * Upload raw bytes to Filecoin
 * @param {Uint8Array} data - Data to upload
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result with CommP
 */
async function uploadBytes(data, options = {}) {
  const storage = await getStorage();

  // Fallback to mock storage if Synapse not available
  if (!storage) {
    return createMockUploadResult(data, options);
  }

  try {
    console.log(`[Synapse] Uploading ${data.length} bytes...`);

    const result = await storage.upload(data);

    console.log(`[Synapse] Upload successful!`);
    console.log(`[Synapse] CommP: ${result.commp}`);

    return {
      cid: result.commp,
      commp: result.commp,
      size: data.length,
      provider: 'synapse',
      network: process.env.FILECOIN_NETWORK || 'calibration',
      timestamp: Date.now(),
      // On-chain proof info
      proofSet: result.proofSetId || null,
      explorerUrl: `${CONFIG[process.env.FILECOIN_NETWORK || 'calibration'].explorer}/message/${result.commp}`
    };
  } catch (error) {
    console.error('[Synapse] Upload failed:', error.message);

    // Fallback to mock for demo purposes
    console.log('[Synapse] Falling back to mock storage');
    return createMockUploadResult(data, options);
  }
}

/**
 * Upload a file to Filecoin
 * @param {Buffer|Uint8Array|string} content - File content
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result
 */
async function uploadFile(content, options = {}) {
  let bytes;
  if (typeof content === 'string') {
    bytes = new TextEncoder().encode(content);
  } else if (Buffer.isBuffer(content)) {
    bytes = new Uint8Array(content);
  } else {
    bytes = content;
  }

  return await uploadBytes(bytes, options);
}

/**
 * Create a mock upload result for development
 */
function createMockUploadResult(content, options = {}) {
  const contentStr = content instanceof Uint8Array
    ? new TextDecoder().decode(content)
    : (typeof content === 'string' ? content : JSON.stringify(content));

  const mockCid = `baga6ea4seaq${generateMockHash(contentStr)}`;

  // Store in memory for retrieval
  mockStore.set(mockCid, {
    content: contentStr,
    contentType: options.contentType || 'application/json',
    uploadedAt: Date.now()
  });

  console.log('[Filecoin] Using mock storage (no Synapse config)');

  return {
    cid: mockCid,
    commp: mockCid,
    size: contentStr.length,
    provider: 'mock',
    timestamp: Date.now(),
    _isMock: true
  };
}

/**
 * Generate a mock hash for development CIDs
 */
function generateMockHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).padStart(32, '0').slice(0, 32);
}

// ============ Retrieve Functions ============

/**
 * Retrieve content by CommP/CID
 * @param {string} cid - CommP or CID
 * @param {Object} options - Retrieval options
 * @returns {Promise<Object>} Retrieved content
 */
async function retrieve(cid, options = {}) {
  if (!cid) {
    throw new Error('CID/CommP is required');
  }

  // Check mock store first
  if (mockStore.has(cid)) {
    const stored = mockStore.get(cid);
    let content = stored.content;

    if (options.asJson && typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (e) {
        // Keep as string
      }
    }

    return {
      content,
      cid,
      provider: 'mock-store',
      retrievedAt: Date.now()
    };
  }

  // Try Synapse download
  const synapse = await initSynapse();
  if (synapse) {
    try {
      console.log(`[Synapse] Downloading ${cid}...`);
      const data = await synapse.download(cid);

      let content;
      if (options.asJson) {
        const text = new TextDecoder().decode(data);
        content = JSON.parse(text);
      } else {
        content = data;
      }

      console.log('[Synapse] Download successful');

      return {
        content,
        cid,
        provider: 'synapse',
        retrievedAt: Date.now()
      };
    } catch (error) {
      console.error('[Synapse] Download failed:', error.message);
    }
  }

  throw new Error(`Failed to retrieve ${cid}`);
}

/**
 * Retrieve JSON content by CID
 * @param {string} cid - CommP or CID
 * @returns {Promise<Object>} Parsed JSON content
 */
async function retrieveJson(cid) {
  const result = await retrieve(cid, { asJson: true });
  return result.content;
}

/**
 * Check if content exists
 * @param {string} cid - CommP or CID
 * @returns {Promise<boolean>}
 */
async function exists(cid) {
  if (mockStore.has(cid)) return true;

  try {
    await retrieve(cid);
    return true;
  } catch {
    return false;
  }
}

// ============ Task Spec & Deliverable Helpers ============

/**
 * Upload a task specification
 * @param {Object} taskSpec - Task specification object
 * @returns {Promise<Object>} Upload result with CommP
 */
async function uploadTaskSpec(taskSpec) {
  const spec = {
    type: 'arbichain_task_spec',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    ...taskSpec
  };

  const result = await uploadJson(spec);

  console.log(`[ArbiChain] Task spec uploaded: ${result.cid}`);

  return result;
}

/**
 * Upload a deliverable
 * @param {Object} deliverable - Deliverable object
 * @returns {Promise<Object>} Upload result with CommP
 */
async function uploadDeliverable(deliverable) {
  const payload = {
    type: 'arbichain_deliverable',
    version: '1.0.0',
    submittedAt: new Date().toISOString(),
    ...deliverable
  };

  const result = await uploadJson(payload);

  console.log(`[ArbiChain] Deliverable uploaded: ${result.cid}`);

  return result;
}

/**
 * Upload dispute evidence
 * @param {Object} evidence - Evidence object
 * @returns {Promise<Object>} Upload result with CommP
 */
async function uploadEvidence(evidence) {
  const payload = {
    type: 'arbichain_evidence',
    version: '1.0.0',
    uploadedAt: new Date().toISOString(),
    ...evidence
  };

  const result = await uploadJson(payload);

  console.log(`[ArbiChain] Evidence uploaded: ${result.cid}`);

  return result;
}

// ============ Synapse Payment Setup ============

/**
 * Check if Synapse payments are configured
 * @returns {Promise<Object>} Payment status
 */
async function checkPaymentStatus() {
  const synapse = await initSynapse();
  if (!synapse) {
    return { configured: false, reason: 'Synapse not initialized' };
  }

  try {
    const balance = await synapse.payments.getBalance();
    return {
      configured: true,
      balance: balance.toString(),
      address: synapse.getAddress()
    };
  } catch (error) {
    return { configured: false, reason: error.message };
  }
}

/**
 * Get Synapse SDK status and info
 * @returns {Promise<Object>} Status info
 */
async function getStatus() {
  const synapse = await initSynapse();

  if (!synapse) {
    return {
      provider: 'mock',
      configured: false,
      message: 'Set FILECOIN_PRIVATE_KEY to enable Synapse SDK'
    };
  }

  return {
    provider: 'synapse',
    configured: true,
    network: process.env.FILECOIN_NETWORK || 'calibration',
    address: synapse.getAddress(),
    explorerBase: CONFIG[process.env.FILECOIN_NETWORK || 'calibration'].explorer
  };
}

// ============ Exports ============

module.exports = {
  // Initialization
  initSynapse,
  getStorage,
  getStatus,
  checkPaymentStatus,

  // Upload functions
  uploadJson,
  uploadBytes,
  uploadFile,
  uploadTaskSpec,
  uploadDeliverable,
  uploadEvidence,

  // Retrieve functions
  retrieve,
  retrieveJson,
  exists,

  // Config
  CONFIG
};
