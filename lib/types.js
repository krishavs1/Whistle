/**
 * Whistle - Shared Types and Constants
 * Common definitions used across agents, contracts, and frontend
 */

// ============ Task States ============

/**
 * Task state enum (mirrors Escrow.sol TaskState)
 */
const TaskState = {
  CREATED: 0,
  FUNDED: 1,
  DELIVERED: 2,
  APPROVED: 3,
  DISPUTED: 4,
  RESOLVED: 5,
  CANCELLED: 6
};

/**
 * Human-readable task state labels
 */
const TaskStateLabels = {
  [TaskState.CREATED]: 'Created',
  [TaskState.FUNDED]: 'Funded',
  [TaskState.DELIVERED]: 'Delivered',
  [TaskState.APPROVED]: 'Approved',
  [TaskState.DISPUTED]: 'Disputed',
  [TaskState.RESOLVED]: 'Resolved',
  [TaskState.CANCELLED]: 'Cancelled'
};

/**
 * Task state colors for UI
 */
const TaskStateColors = {
  [TaskState.CREATED]: '#9CA3AF',    // Gray
  [TaskState.FUNDED]: '#3B82F6',     // Blue
  [TaskState.DELIVERED]: '#F59E0B',  // Amber
  [TaskState.APPROVED]: '#10B981',   // Green
  [TaskState.DISPUTED]: '#EF4444',   // Red
  [TaskState.RESOLVED]: '#8B5CF6',   // Purple
  [TaskState.CANCELLED]: '#6B7280'   // Gray
};

// ============ Dispute States ============

/**
 * Dispute ruling enum (mirrors Escrow.sol DisputeRuling)
 */
const DisputeRuling = {
  NONE: 0,
  REFUND_BUYER: 1,
  PAY_SELLER: 2
};

/**
 * Human-readable dispute ruling labels
 */
const DisputeRulingLabels = {
  [DisputeRuling.NONE]: 'Pending',
  [DisputeRuling.REFUND_BUYER]: 'Refund to Buyer',
  [DisputeRuling.PAY_SELLER]: 'Payment to Seller'
};

const DisputeReason = {
  NONE: 0,
  QUALITY_ISSUE: 1,
  BUYER_SILENCE: 2,
  SELLER_ABUSE: 3,
  SCOPE_CHANGE: 4,
  OTHER: 5
};

const DisputeReasonLabels = {
  [DisputeReason.NONE]: 'None',
  [DisputeReason.QUALITY_ISSUE]: 'Quality issue',
  [DisputeReason.BUYER_SILENCE]: 'Buyer silence',
  [DisputeReason.SELLER_ABUSE]: 'Seller abuse',
  [DisputeReason.SCOPE_CHANGE]: 'Scope change',
  [DisputeReason.OTHER]: 'Other'
};

// ============ Agent Types ============

/**
 * Agent role types
 */
const AgentRole = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ARBITRATOR: 'arbitrator'
};

/**
 * Agent status
 */
const AgentStatus = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  DISPUTING: 'disputing',
  OFFLINE: 'offline'
};

// ============ Reputation Thresholds ============

const ReputationThresholds = {
  MIN: 0,
  MAX: 1000,
  INITIAL: 500,
  LOW: 300,
  MEDIUM: 500,
  HIGH: 700,
  EXCELLENT: 900
};

const ReputationTiers = {
  UNTRUSTED: { min: 0, max: 299, label: 'Untrusted', color: '#EF4444' },
  NEW: { min: 300, max: 499, label: 'New', color: '#F59E0B' },
  ESTABLISHED: { min: 500, max: 699, label: 'Established', color: '#3B82F6' },
  TRUSTED: { min: 700, max: 899, label: 'Trusted', color: '#10B981' },
  ELITE: { min: 900, max: 1000, label: 'Elite', color: '#8B5CF6' }
};

/**
 * Get reputation tier for a score
 * @param {number} score - Reputation score
 * @returns {Object} Tier info
 */
function getReputationTier(score) {
  for (const [key, tier] of Object.entries(ReputationTiers)) {
    if (score >= tier.min && score <= tier.max) {
      return { key, ...tier };
    }
  }
  return ReputationTiers.UNTRUSTED;
}

// ============ Event Types ============

/**
 * Contract event names
 */
const ContractEvents = {
  // Escrow events
  TASK_CREATED: 'TaskCreated',
  DELIVERABLE_SUBMITTED: 'DeliverableSubmitted',
  DELIVERABLE_APPROVED: 'DeliverableApproved',
  DISPUTE_OPENED: 'DisputeOpened',
  DISPUTE_RESOLVED: 'DisputeResolved',

  // Reputation events
  AGENT_REGISTERED: 'AgentRegistered',
  REPUTATION_UPDATED: 'ReputationUpdated',
  TASK_RECORDED: 'TaskRecorded'
};

// ============ Filecoin Content Types ============

const FilecoinContentType = {
  TASK_SPEC: 'whistle_task_spec',
  DELIVERABLE: 'whistle_deliverable',
  EVIDENCE: 'whistle_evidence',
  ARBITRATION_REPORT: 'whistle_arbitration_report'
};

// ============ Error Codes ============

const ErrorCodes = {
  // Contract errors
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_STATE: 'INVALID_STATE',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  TRANSFER_FAILED: 'TRANSFER_FAILED',

  // Agent errors
  AGENT_NOT_REGISTERED: 'AGENT_NOT_REGISTERED',
  LOW_REPUTATION: 'LOW_REPUTATION',
  TASK_ALREADY_EXISTS: 'TASK_ALREADY_EXISTS',

  // Filecoin errors
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  RETRIEVE_FAILED: 'RETRIEVE_FAILED',
  INVALID_CID: 'INVALID_CID',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  TX_FAILED: 'TX_FAILED'
};

// ============ ArbitratorPool ============

const PanelVote = {
  NOT_VOTED: 0,
  REFUND_BUYER: 1,
  PAY_SELLER: 2
};

const PanelVoteLabels = {
  [PanelVote.NOT_VOTED]: 'Not Voted',
  [PanelVote.REFUND_BUYER]: 'Refund Buyer',
  [PanelVote.PAY_SELLER]: 'Pay Seller'
};

const ArbitratorPoolConstants = {
  PANEL_SIZE: 3,
  VOTE_THRESHOLD: 2,
  MIN_STAKE_ARBI: 100,
  REWARD_PER_CORRECT_VOTE: 10,
  SLASH_PER_WRONG_VOTE: 5
};

// ============ Default Configuration ============

const Defaults = {
  // Escrow settings
  PLATFORM_FEE_BPS: 100, // 1%
  MIN_TASK_AMOUNT_SUN: 1000000, // 1 TRX minimum
  MAX_TASK_AMOUNT_SUN: 1000000000000, // 1M TRX maximum

  // Timing
  DELIVERY_WINDOW_HOURS: 72,
  REVIEW_WINDOW_HOURS: 72,
  MIN_WINDOW_SECONDS: 60,

  // Polling
  POLL_INTERVAL_MS: 5000,
  TX_CONFIRM_TIMEOUT_MS: 60000,
  TX_CONFIRM_ATTEMPTS: 20,

  // Reputation
  INITIAL_REPUTATION: 500,
  TASK_COMPLETE_BONUS: 10,
  DISPUTE_WIN_BONUS: 5,
  DISPUTE_LOSS_PENALTY: 50,

  // ArbiToken
  ARBI_INITIAL_SUPPLY: '1000000',
  ARBI_DECIMALS: 18
};

// ============ Task Spec Schema ============

/**
 * Example task specification structure
 */
const TaskSpecSchema = {
  type: 'object',
  required: ['title', 'description', 'requirements'],
  properties: {
    title: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    requirements: {
      type: 'array',
      items: { type: 'string' }
    },
    deadline: { type: 'string', format: 'date-time' },
    deliverableFormat: { type: 'string' },
    additionalNotes: { type: 'string' }
  }
};

/**
 * Example deliverable structure
 */
const DeliverableSchema = {
  type: 'object',
  required: ['taskId', 'content'],
  properties: {
    taskId: { type: 'string' },
    content: { type: 'object' },
    notes: { type: 'string' },
    attachments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cid: { type: 'string' },
          mimeType: { type: 'string' }
        }
      }
    }
  }
};

// ============ Helper Functions ============

/**
 * Check if a task state allows dispute
 * @param {number} state - Current task state
 * @returns {boolean}
 */
function canDispute(state) {
  return state === TaskState.DELIVERED;
}

/**
 * Check if a task state allows approval
 * @param {number} state - Current task state
 * @returns {boolean}
 */
function canApprove(state) {
  return state === TaskState.DELIVERED;
}

/**
 * Check if a task is finalized
 * @param {number} state - Current task state
 * @returns {boolean}
 */
function isFinalized(state) {
  return (
    state === TaskState.APPROVED ||
    state === TaskState.RESOLVED ||
    state === TaskState.CANCELLED
  );
}

/**
 * Format TRX amount for display
 * @param {number} sun - Amount in SUN
 * @param {number} decimals - Decimal places
 * @returns {string}
 */
function formatTrx(sun, decimals = 2) {
  const trx = sun / 1000000;
  return trx.toFixed(decimals) + ' TRX';
}

/**
 * Generate a unique task ID
 * @returns {string} Hex string (bytes32 compatible)
 */
function generateTaskId() {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(16).slice(2);
  const combined = timestamp + random;
  return '0x' + combined.padEnd(64, '0').slice(0, 64);
}

// ============ Exports ============

module.exports = {
  // Task states
  TaskState,
  TaskStateLabels,
  TaskStateColors,

  // Dispute
  DisputeRuling,
  DisputeRulingLabels,
  DisputeReason,
  DisputeReasonLabels,

  // Agents
  AgentRole,
  AgentStatus,

  // Reputation
  ReputationThresholds,
  ReputationTiers,
  getReputationTier,

  // Events
  ContractEvents,

  // Filecoin
  FilecoinContentType,

  // Errors
  ErrorCodes,

  // Defaults
  Defaults,

  // Schemas
  TaskSpecSchema,
  DeliverableSchema,

  // ArbitratorPool
  PanelVote,
  PanelVoteLabels,
  ArbitratorPoolConstants,

  // Helpers
  canDispute,
  canApprove,
  isFinalized,
  formatTrx,
  generateTaskId
};
