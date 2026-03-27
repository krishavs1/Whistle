/**
 * ArbiChain - Filecoin Storage Utilities
 * Helpers for uploading and retrieving evidence/deliverables via Filecoin
 *
 * This module provides abstraction over Filecoin storage services.
 * In production, wire up to: web3.storage, Lighthouse, or direct Filecoin deals.
 */

const axios = require('axios');

// ============ Configuration ============

const CONFIG = {
  // Web3.storage (default provider)
  web3storage: {
    apiUrl: 'https://api.web3.storage',
    gatewayUrl: 'https://w3s.link/ipfs'
  },
  // Lighthouse.storage (alternative)
  lighthouse: {
    apiUrl: 'https://node.lighthouse.storage/api/v0',
    gatewayUrl: 'https://gateway.lighthouse.storage/ipfs'
  },
  // IPFS gateway fallbacks
  gateways: [
    'https://w3s.link/ipfs',
    'https://gateway.lighthouse.storage/ipfs',
    'https://ipfs.io/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
    'https://dweb.link/ipfs'
  ]
};

// Active provider (can be changed at runtime)
let activeProvider = 'web3storage';
let apiToken = process.env.FILECOIN_API_TOKEN || '';

// In-memory store for mock uploads (development only)
const mockStore = new Map();

// ============ Provider Configuration ============

/**
 * Set the active storage provider
 * @param {string} provider - Provider name ('web3storage' or 'lighthouse')
 */
function setProvider(provider) {
  if (!CONFIG[provider]) {
    throw new Error(`Unknown provider: ${provider}. Available: web3storage, lighthouse`);
  }
  activeProvider = provider;
}

/**
 * Set the API token for the active provider
 * @param {string} token - API token
 */
function setApiToken(token) {
  apiToken = token;
}

/**
 * Get current provider configuration
 * @returns {Object} Provider config
 */
function getProviderConfig() {
  return {
    provider: activeProvider,
    config: CONFIG[activeProvider],
    hasToken: !!apiToken
  };
}

// ============ Upload Functions ============

/**
 * Upload JSON data to Filecoin/IPFS
 * @param {Object} data - JSON data to upload
 * @param {Object} options - Upload options
 * @param {string} options.name - Optional filename
 * @returns {Promise<Object>} Upload result with CID
 */
async function uploadJson(data, options = {}) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });

  return await uploadFile(blob, {
    ...options,
    name: options.name || 'data.json',
    contentType: 'application/json'
  });
}

/**
 * Upload a file to Filecoin/IPFS
 * @param {Buffer|Blob|string} content - File content
 * @param {Object} options - Upload options
 * @param {string} options.name - Filename
 * @param {string} options.contentType - MIME type
 * @returns {Promise<Object>} Upload result with CID
 */
async function uploadFile(content, options = {}) {
  if (!apiToken) {
    // Return mock CID for development/testing
    console.warn('[Filecoin] No API token set, returning mock CID');
    return createMockUploadResult(content, options);
  }

  const providerConfig = CONFIG[activeProvider];

  try {
    if (activeProvider === 'web3storage') {
      return await uploadToWeb3Storage(content, options);
    } else if (activeProvider === 'lighthouse') {
      return await uploadToLighthouse(content, options);
    }
  } catch (error) {
    console.error(`[Filecoin] Upload failed:`, error.message);
    throw error;
  }
}

/**
 * Upload to Web3.storage
 */
async function uploadToWeb3Storage(content, options) {
  const formData = new FormData();

  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: options.contentType || 'application/octet-stream' });

  formData.append('file', blob, options.name || 'file');

  const response = await axios.post(
    `${CONFIG.web3storage.apiUrl}/upload`,
    formData,
    {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'multipart/form-data'
      }
    }
  );

  return {
    cid: response.data.cid,
    url: `${CONFIG.web3storage.gatewayUrl}/${response.data.cid}`,
    provider: 'web3storage',
    timestamp: Date.now()
  };
}

/**
 * Upload to Lighthouse.storage
 */
async function uploadToLighthouse(content, options) {
  const formData = new FormData();

  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: options.contentType || 'application/octet-stream' });

  formData.append('file', blob, options.name || 'file');

  const response = await axios.post(
    `${CONFIG.lighthouse.apiUrl}/add`,
    formData,
    {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'multipart/form-data'
      }
    }
  );

  return {
    cid: response.data.Hash,
    url: `${CONFIG.lighthouse.gatewayUrl}/${response.data.Hash}`,
    provider: 'lighthouse',
    timestamp: Date.now()
  };
}

/**
 * Create a mock upload result for development
 * Stores content in memory for later retrieval
 */
function createMockUploadResult(content, options) {
  // Generate a deterministic mock CID based on content hash
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const mockCid = `bafybeig${generateMockHash(contentStr)}`;

  // Store in memory for retrieval
  mockStore.set(mockCid, {
    content: contentStr,
    contentType: options.contentType || 'application/json',
    uploadedAt: Date.now()
  });

  return {
    cid: mockCid,
    url: `${CONFIG.web3storage.gatewayUrl}/${mockCid}`,
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
 * Retrieve content by CID
 * @param {string} cid - Content identifier
 * @param {Object} options - Retrieval options
 * @param {boolean} options.asJson - Parse response as JSON
 * @returns {Promise<Object>} Retrieved content
 */
async function retrieve(cid, options = {}) {
  if (!cid) {
    throw new Error('CID is required');
  }

  // Clean up CID (remove any gateway prefix if present)
  const cleanCid = extractCid(cid);

  // Check mock store first (for development)
  if (mockStore.has(cleanCid)) {
    const stored = mockStore.get(cleanCid);
    let content = stored.content;

    // Parse as JSON if requested
    if (options.asJson && typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return {
      content,
      cid: cleanCid,
      gateway: 'mock-store',
      retrievedAt: Date.now()
    };
  }

  // Try each gateway in order
  for (const gateway of CONFIG.gateways) {
    try {
      const url = `${gateway}/${cleanCid}`;
      const response = await axios.get(url, {
        timeout: 30000,
        responseType: options.asJson ? 'json' : 'text'
      });

      return {
        content: response.data,
        cid: cleanCid,
        gateway: gateway,
        retrievedAt: Date.now()
      };
    } catch (error) {
      console.warn(`[Filecoin] Gateway ${gateway} failed:`, error.message);
      continue;
    }
  }

  throw new Error(`Failed to retrieve CID ${cleanCid} from all gateways`);
}

/**
 * Retrieve JSON content by CID
 * @param {string} cid - Content identifier
 * @returns {Promise<Object>} Parsed JSON content
 */
async function retrieveJson(cid) {
  const result = await retrieve(cid, { asJson: true });
  return result.content;
}

/**
 * Check if content exists (ping CID)
 * @param {string} cid - Content identifier
 * @returns {Promise<boolean>} Whether content is accessible
 */
async function exists(cid) {
  try {
    const cleanCid = extractCid(cid);

    for (const gateway of CONFIG.gateways) {
      try {
        await axios.head(`${gateway}/${cleanCid}`, { timeout: 10000 });
        return true;
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract CID from a URL or raw CID string
 * @param {string} cidOrUrl - CID or IPFS URL
 * @returns {string} Clean CID
 */
function extractCid(cidOrUrl) {
  if (!cidOrUrl) return '';

  // If it's already a clean CID
  if (cidOrUrl.startsWith('bafy') || cidOrUrl.startsWith('Qm')) {
    return cidOrUrl;
  }

  // Extract from URL
  const patterns = [
    /ipfs\/([a-zA-Z0-9]+)/,
    /\/([a-zA-Z0-9]+)$/
  ];

  for (const pattern of patterns) {
    const match = cidOrUrl.match(pattern);
    if (match) return match[1];
  }

  return cidOrUrl;
}

// ============ Task Spec & Deliverable Helpers ============

/**
 * Upload a task specification
 * @param {Object} taskSpec - Task specification object
 * @returns {Promise<Object>} Upload result with CID
 */
async function uploadTaskSpec(taskSpec) {
  const spec = {
    type: 'arbichain_task_spec',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    ...taskSpec
  };

  return await uploadJson(spec, { name: 'task_spec.json' });
}

/**
 * Upload a deliverable
 * @param {Object} deliverable - Deliverable object
 * @returns {Promise<Object>} Upload result with CID
 */
async function uploadDeliverable(deliverable) {
  const payload = {
    type: 'arbichain_deliverable',
    version: '1.0.0',
    submittedAt: new Date().toISOString(),
    ...deliverable
  };

  return await uploadJson(payload, { name: 'deliverable.json' });
}

/**
 * Upload dispute evidence
 * @param {Object} evidence - Evidence object
 * @returns {Promise<Object>} Upload result with CID
 */
async function uploadEvidence(evidence) {
  const payload = {
    type: 'arbichain_evidence',
    version: '1.0.0',
    uploadedAt: new Date().toISOString(),
    ...evidence
  };

  return await uploadJson(payload, { name: 'evidence.json' });
}

/**
 * Build a gateway URL for a CID
 * @param {string} cid - Content identifier
 * @param {number} gatewayIndex - Gateway index to use
 * @returns {string} Full gateway URL
 */
function getGatewayUrl(cid, gatewayIndex = 0) {
  const cleanCid = extractCid(cid);
  const gateway = CONFIG.gateways[gatewayIndex] || CONFIG.gateways[0];
  return `${gateway}/${cleanCid}`;
}

// ============ Exports ============

module.exports = {
  // Configuration
  setProvider,
  setApiToken,
  getProviderConfig,
  CONFIG,

  // Upload functions
  uploadJson,
  uploadFile,
  uploadTaskSpec,
  uploadDeliverable,
  uploadEvidence,

  // Retrieve functions
  retrieve,
  retrieveJson,
  exists,

  // Utilities
  extractCid,
  getGatewayUrl
};
