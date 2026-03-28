/**
 * Whistle - Agent Configuration
 * Configuration for buyer, seller, and arbitrator agents
 */

require('dotenv').config();

// ============ Network Configuration ============

const network = {
  name: process.env.TRON_NETWORK || 'nile',
  fullHost: process.env.TRON_FULL_HOST || 'https://nile.trongrid.io',
  explorerUrl: process.env.TRON_NETWORK === 'mainnet'
    ? 'https://tronscan.org'
    : 'https://nile.tronscan.org'
};

// ============ Contract Addresses ============

const contracts = {
  escrow: process.env.ESCROW_ADDRESS || '',
  reputationGate: process.env.REPUTATION_GATE_ADDRESS || ''
};

// Validate contract addresses
function validateContracts() {
  if (!contracts.escrow) {
    console.warn('Warning: ESCROW_ADDRESS not set in environment');
  }
  if (!contracts.reputationGate) {
    console.warn('Warning: REPUTATION_GATE_ADDRESS not set in environment');
  }
}

// ============ Agent Wallets ============

const agents = {
  buyer: {
    name: 'Buyer Agent',
    privateKey: process.env.BUYER_PRIVATE_KEY || '',
    role: 'buyer'
  },
  seller: {
    name: 'Seller Agent',
    privateKey: process.env.SELLER_PRIVATE_KEY || '',
    role: 'seller'
  },
  arbitrator: {
    name: 'Arbitrator Agent',
    privateKey: process.env.ARBITRATOR_PRIVATE_KEY || '',
    role: 'arbitrator'
  }
};

// ============ Filecoin Configuration ============

const filecoin = {
  provider: process.env.FILECOIN_PROVIDER || 'web3storage',
  apiToken: process.env.FILECOIN_API_TOKEN || '',
  gatewayUrl: process.env.FILECOIN_GATEWAY || 'https://w3s.link/ipfs'
};

// ============ Agent Behavior Settings ============

const behavior = {
  // Polling intervals (ms)
  pollInterval: parseInt(process.env.POLL_INTERVAL_MS) || 5000,
  txConfirmTimeout: parseInt(process.env.TX_CONFIRM_TIMEOUT_MS) || 60000,

  // Auto-actions
  autoApproveEnabled: process.env.AUTO_APPROVE === 'true',
  autoDisputeThreshold: parseFloat(process.env.AUTO_DISPUTE_THRESHOLD) || 0.5,

  // Arbitrator: when false (default), disputes are never resolved on-chain from the listen loop;
  // human runs: node arbitrator.js recommend <taskId> then resolve <taskId> 0|1
  arbitratorAutoResolve: process.env.ARBITRATOR_AUTO_RESOLVE === 'true',

  // Arbitrator settings
  minEvidenceForRuling: parseInt(process.env.MIN_EVIDENCE_FOR_RULING) || 1,

  // Logging
  verbose: process.env.VERBOSE === 'true',
  logLevel: process.env.LOG_LEVEL || 'info'
};

// ============ Task Defaults ============

const taskDefaults = {
  minAmount: parseInt(process.env.MIN_TASK_AMOUNT) || 1000000, // 1 TRX in SUN
  maxAmount: parseInt(process.env.MAX_TASK_AMOUNT) || 1000000000000, // 1M TRX
  defaultDeadlineHours: parseInt(process.env.DEFAULT_DEADLINE_HOURS) || 72
};

// ============ Helper Functions ============

/**
 * Get agent config by role
 * @param {string} role - Agent role (buyer, seller, arbitrator)
 * @returns {Object} Agent configuration
 */
function getAgentConfig(role) {
  const agent = agents[role];
  if (!agent) {
    throw new Error(`Unknown agent role: ${role}`);
  }
  return agent;
}

/**
 * Check if all required environment variables are set
 * @returns {Object} Validation result
 */
function validateConfig() {
  const errors = [];
  const warnings = [];

  // Check contract addresses
  if (!contracts.escrow) errors.push('ESCROW_ADDRESS is required');
  if (!contracts.reputationGate) errors.push('REPUTATION_GATE_ADDRESS is required');

  // Check at least one agent key
  const hasAnyAgent = agents.buyer.privateKey ||
    agents.seller.privateKey ||
    agents.arbitrator.privateKey;

  if (!hasAnyAgent) {
    warnings.push('No agent private keys configured');
  }

  // Check Filecoin token for uploads
  if (!filecoin.apiToken) {
    warnings.push('FILECOIN_API_TOKEN not set - uploads will use mock CIDs');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Print current configuration (masks sensitive data)
 */
function printConfig() {
  console.log('\n=== Whistle Agent Configuration ===\n');

  console.log('Network:');
  console.log(`  Name: ${network.name}`);
  console.log(`  Host: ${network.fullHost}`);
  console.log(`  Explorer: ${network.explorerUrl}`);

  console.log('\nContracts:');
  console.log(`  Escrow: ${contracts.escrow || '(not set)'}`);
  console.log(`  ReputationGate: ${contracts.reputationGate || '(not set)'}`);

  console.log('\nAgents:');
  for (const [role, agent] of Object.entries(agents)) {
    const hasKey = agent.privateKey ? '✓' : '✗';
    console.log(`  ${agent.name}: ${hasKey}`);
  }

  console.log('\nFilecoin:');
  console.log(`  Provider: ${filecoin.provider}`);
  console.log(`  API Token: ${filecoin.apiToken ? '✓ (set)' : '✗ (not set)'}`);

  console.log('\nBehavior:');
  console.log(`  Poll Interval: ${behavior.pollInterval}ms`);
  console.log(`  Auto Approve: ${behavior.autoApproveEnabled}`);
  console.log(`  Verbose: ${behavior.verbose}`);

  console.log('\n=====================================\n');
}

// ============ Exports ============

module.exports = {
  network,
  contracts,
  agents,
  filecoin,
  behavior,
  taskDefaults,

  // Functions
  getAgentConfig,
  validateConfig,
  validateContracts,
  printConfig
};
