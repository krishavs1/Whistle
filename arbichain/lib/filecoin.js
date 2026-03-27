/**
 * ArbiChain - Filecoin Storage Utilities
 * Powered by Synapse SDK v0.40+ for Filecoin Onchain Cloud
 *
 * Features:
 * - On-chain verifiable storage proofs (PDP)
 * - Permanent storage on Filecoin network
 * - CommP (PieceCID) based addressing
 */

require('dotenv').config();

const MIN_UPLOAD_BYTES = 127;

const mockStore = new Map();
const retrievalUrlStore = new Map();

let synapseInstance = null;
let isSetupComplete = false;

// ============ Synapse SDK (v0.40+) ============

async function getSynapseChain() {
  const { calibration, mainnet } = await import('@filoz/synapse-sdk');
  const network = process.env.FILECOIN_NETWORK || 'calibration';
  return network === 'mainnet' ? mainnet : calibration;
}

async function createSynapseClient() {
  const { Synapse } = await import('@filoz/synapse-sdk');
  const { privateKeyToAccount } = await import('viem/accounts');

  const pk = process.env.FILECOIN_PRIVATE_KEY;
  if (!pk) return null;

  const account = privateKeyToAccount(pk);
  const chain = await getSynapseChain();
  return { synapse: Synapse.create({ chain, account }), account };
}

async function initSynapse() {
  if (synapseInstance && isSetupComplete) return synapseInstance;

  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[Synapse] FILECOIN_PRIVATE_KEY not set');
    return null;
  }

  try {
    const result = await createSynapseClient();
    if (!result) return null;

    const { synapse, account } = result;
    const network = process.env.FILECOIN_NETWORK || 'calibration';

    console.log('[Synapse] Initializing SDK...');
    console.log(`[Synapse] Connected as: ${account.address}`);
    console.log(`[Synapse] Network: ${network}`);

    const info = await synapse.payments.accountInfo();
    const { formatUnits } = await import('viem');
    const balanceStr = formatUnits(info.funds, 18);
    console.log(`[Synapse] USDFC Balance: ${balanceStr} USDFC`);

    if (info.funds === 0n) {
      console.log('[Synapse] No USDFC deposited. Get tokens from:');
      console.log('         https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
      console.log('         Then run: node scripts/setup-synapse.js');
      return null;
    }

    synapseInstance = synapse;
    isSetupComplete = true;
    return synapse;
  } catch (error) {
    console.error('[Synapse] Init failed:', error.message);
    return null;
  }
}

/**
 * Setup Synapse payments (deposit USDFC).
 * The v0.40 SDK handles service approval automatically on upload.
 */
async function setupPayments(depositAmount = '5') {
  const result = await createSynapseClient();
  if (!result) throw new Error('FILECOIN_PRIVATE_KEY not set');

  const { synapse, account } = result;
  const { parseUnits, formatUnits } = await import('viem');

  console.log(`[Synapse] Setting up payments...`);
  console.log(`[Synapse] Address: ${account.address}`);

  const walletBal = await synapse.payments.walletBalance();
  console.log(`[Synapse] Wallet USDFC: ${formatUnits(walletBal, 18)}`);

  if (walletBal === 0n) {
    console.log('\n❌ No USDFC in wallet!');
    console.log('   Get USDFC from: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
    console.log(`   Your address: ${account.address}`);
    return false;
  }

  const amount = parseUnits(depositAmount, 18);
  console.log(`[Synapse] Depositing ${depositAmount} USDFC...`);

  const depositTx = await synapse.payments.deposit({ amount });
  console.log(`[Synapse] Deposit TX: ${depositTx}`);

  console.log('[Synapse] Waiting for confirmation...');
  await new Promise(r => setTimeout(r, 45000));

  const info = await synapse.payments.accountInfo();
  console.log(`[Synapse] Deposited balance: ${formatUnits(info.funds, 18)} USDFC`);
  console.log('\n✅ Synapse setup complete! You can now upload files.');
  return true;
}

async function getStorage() {
  return await initSynapse();
}

// ============ Upload Functions ============

function padPayload(data) {
  if (data.length >= MIN_UPLOAD_BYTES) return data;
  const padded = new Uint8Array(MIN_UPLOAD_BYTES);
  padded.set(data);
  return padded;
}

async function uploadJson(data, options = {}) {
  const jsonString = JSON.stringify(data, null, 2);
  const raw = new TextEncoder().encode(jsonString);
  return await uploadBytes(raw, { ...options, contentType: 'application/json' });
}

async function uploadBytes(data, options = {}) {
  const synapse = await getStorage();
  if (synapse) {
    try {
      const payload = padPayload(data);
      console.log(`[Synapse] Uploading ${payload.length} bytes...`);
      const uploadOpts = { providerIds: [4], copies: 1 };
      const result = await synapse.storage.upload(payload, uploadOpts);
      console.log('[Synapse] Upload successful!');

      const pieceCid = result.pieceCid?.toString?.() || String(result.pieceCid);

      console.log(`[Synapse] PieceCID: ${pieceCid}`);

      const retrievalUrl = result.copies?.[0]?.retrievalUrl || null;
      if (retrievalUrl) {
        retrievalUrlStore.set(pieceCid, retrievalUrl);
      }

      return {
        cid: pieceCid,
        commp: pieceCid,
        size: data.length,
        provider: 'synapse',
        network: process.env.FILECOIN_NETWORK || 'calibration',
        timestamp: Date.now(),
        copies: result.copies || [],
        retrievalUrl
      };
    } catch (error) {
      console.error('[Synapse] Upload failed:', error.message);
    }
  }

  console.log('[Filecoin] Falling back to mock storage');
  return createMockUploadResult(data, options);
}

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

async function retrieve(cid, options = {}) {
  if (!cid) throw new Error('CID required');

  if (mockStore.has(cid)) {
    const stored = mockStore.get(cid);
    let content = stored.content;
    if (options.asJson && typeof content === 'string') {
      try { content = JSON.parse(content); } catch {}
    }
    return { content, cid, provider: 'mock-store', retrievedAt: Date.now() };
  }

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

  const url = options.retrievalUrl || retrievalUrlStore.get(cid);
  if (url) {
    try {
      console.log(`[Synapse] Fetching from retrieval URL...`);
      const response = await fetch(url);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let content = options.asJson ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
        return { content, cid, provider: 'synapse-http', retrievedAt: Date.now() };
      }
    } catch (error) {
      console.error('[Synapse] HTTP retrieval failed:', error.message);
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

    const info = await synapse.payments.accountInfo();
    const { formatUnits } = await import('viem');

    return {
      provider: 'synapse',
      configured: true,
      ready: true,
      balance: formatUnits(info.funds, 18) + ' USDFC',
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
};
