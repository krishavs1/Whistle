/**
 * ArbiChain - Arbitrator Agent
 * Autonomous agent that monitors disputes, reviews evidence, and makes rulings
 */

require('dotenv').config();
const { createTronWeb, getBalance, waitForConfirmation, getContractEvents } = require('../lib/tron');
const { retrieveJson, uploadEvidence } = require('../lib/filecoin');
const { TaskState, TaskStateLabels, DisputeRuling, DisputeRulingLabels } = require('../lib/types');
const llm = require('../lib/llm');
const config = require('./config');

// Contract ABIs
const ESCROW_ABI = [
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}, {"name": "ruling", "type": "uint8"}],
    "name": "resolveDispute",
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}],
    "name": "getTask",
    "outputs": [{"components": [
      {"name": "buyer", "type": "address"},
      {"name": "seller", "type": "address"},
      {"name": "amount", "type": "uint256"},
      {"name": "taskSpecCID", "type": "string"},
      {"name": "deliverableCID", "type": "string"},
      {"name": "state", "type": "uint8"},
      {"name": "ruling", "type": "uint8"},
      {"name": "createdAt", "type": "uint256"},
      {"name": "deliveredAt", "type": "uint256"},
      {"name": "resolvedAt", "type": "uint256"}
    ], "name": "", "type": "tuple"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitrator",
    "outputs": [{"name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
];

const REPUTATION_ABI = [
  {
    "inputs": [{"name": "winner", "type": "address"}, {"name": "loser", "type": "address"}],
    "name": "recordDisputeResolution",
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "agent", "type": "address"}],
    "name": "getReputation",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

class ArbitratorAgent {
  constructor() {
    this.tronWeb = null;
    this.escrow = null;
    this.reputation = null;
    this.address = null;
    this.pendingDisputes = new Map(); // taskId -> dispute info
    this.resolvedDisputes = new Map();
    this.isRunning = false;
    this.lastEventTimestamp = 0;
  }

  /**
   * Initialize the arbitrator agent
   */
  async init() {
    console.log('\n⚖️ Initializing Arbitrator Agent...');

    if (!config.agents.arbitrator.privateKey) {
      throw new Error('ARBITRATOR_PRIVATE_KEY not set in environment');
    }
    if (!config.contracts.escrow) {
      throw new Error('ESCROW_ADDRESS not set in environment');
    }

    this.tronWeb = createTronWeb(config.agents.arbitrator.privateKey, config.network.name);
    this.address = this.tronWeb.defaultAddress.base58;

    this.escrow = await this.tronWeb.contract(ESCROW_ABI, config.contracts.escrow);

    if (config.contracts.reputationGate) {
      this.reputation = await this.tronWeb.contract(REPUTATION_ABI, config.contracts.reputationGate);
    }

    // Verify this agent is the designated arbitrator
    const contractArbitrator = await this.escrow.arbitrator().call();
    const arbitratorAddress = this.tronWeb.address.fromHex(contractArbitrator);

    if (arbitratorAddress !== this.address) {
      console.warn(`⚠️ Warning: This agent (${this.address}) is not the contract arbitrator (${arbitratorAddress})`);
    }

    const balance = await getBalance(this.tronWeb, this.address);

    console.log(`   Address: ${this.address}`);
    console.log(`   Balance: ${balance} TRX`);
    console.log(`   Escrow Contract: ${config.contracts.escrow}`);
    console.log(`   Is Designated Arbitrator: ${arbitratorAddress === this.address}`);
    console.log('✅ Arbitrator Agent initialized\n');

    return this;
  }

  /**
   * Check task details
   */
  async checkTask(taskId) {
    const task = await this.escrow.getTask(taskId).call();

    return {
      taskId,
      buyer: this.tronWeb.address.fromHex(task.buyer),
      seller: this.tronWeb.address.fromHex(task.seller),
      amount: this.tronWeb.fromSun(task.amount.toString()),
      taskSpecCID: task.taskSpecCID,
      deliverableCID: task.deliverableCID,
      state: Number(task.state),
      stateLabel: TaskStateLabels[Number(task.state)],
      ruling: Number(task.ruling),
      createdAt: Number(task.createdAt) * 1000,
      deliveredAt: Number(task.deliveredAt) * 1000,
      resolvedAt: Number(task.resolvedAt) * 1000
    };
  }

  /**
   * Review a disputed task and gather evidence
   * @param {string} taskId - Task ID to review
   */
  async reviewDispute(taskId) {
    console.log(`\n🔍 Reviewing dispute for task ${taskId.slice(0, 10)}...`);

    const task = await this.checkTask(taskId);

    if (task.state !== TaskState.DISPUTED) {
      console.log(`   Task is not in DISPUTED state (current: ${task.stateLabel})`);
      return null;
    }

    console.log(`   Buyer: ${task.buyer}`);
    console.log(`   Seller: ${task.seller}`);
    console.log(`   Amount: ${task.amount} TRX`);

    // Fetch evidence from Filecoin
    console.log('\n   📥 Fetching evidence from Filecoin...');

    let taskSpec = null;
    let deliverable = null;

    try {
      console.log(`   Task Spec CID: ${task.taskSpecCID}`);
      taskSpec = await retrieveJson(task.taskSpecCID);
      console.log('   ✓ Task spec retrieved');
    } catch (error) {
      console.log(`   ✗ Failed to retrieve task spec: ${error.message}`);
    }

    try {
      console.log(`   Deliverable CID: ${task.deliverableCID}`);
      deliverable = await retrieveJson(task.deliverableCID);
      console.log('   ✓ Deliverable retrieved');
    } catch (error) {
      console.log(`   ✗ Failed to retrieve deliverable: ${error.message}`);
    }

    // Get reputation scores
    let buyerRep = 500, sellerRep = 500;
    if (this.reputation) {
      try {
        buyerRep = Number(await this.reputation.getReputation(task.buyer).call());
        sellerRep = Number(await this.reputation.getReputation(task.seller).call());
      } catch (e) {
        console.log('   Could not fetch reputation scores');
      }
    }

    const evidence = {
      taskId,
      task,
      taskSpec,
      deliverable,
      buyerReputation: buyerRep,
      sellerReputation: sellerRep,
      reviewedAt: Date.now()
    };

    // Store for review
    this.pendingDisputes.set(taskId, evidence);

    console.log('\n   📋 Evidence Summary:');
    console.log(`   Task Title: ${taskSpec?.title || 'N/A'}`);
    console.log(`   Requirements: ${taskSpec?.requirements?.length || 0} items`);
    console.log(`   Deliverable Type: ${deliverable?.content?.type || 'N/A'}`);
    console.log(`   Buyer Reputation: ${buyerRep}`);
    console.log(`   Seller Reputation: ${sellerRep}`);

    return evidence;
  }

  /**
   * Evaluate evidence and determine ruling
   * @param {Object} evidence - Dispute evidence
   * @returns {Object} Evaluation result
   */
  evaluateEvidence(evidence) {
    console.log('\n   🤔 Evaluating evidence...');

    const { taskSpec, deliverable, buyerReputation, sellerReputation } = evidence;
    let score = 50; // Start neutral
    const reasons = [];

    // Check if deliverable exists
    if (!deliverable || !deliverable.content) {
      score -= 40;
      reasons.push('No deliverable content found');
    } else {
      score += 10;
      reasons.push('Deliverable was submitted');
    }

    // Check if deliverable has substance
    if (deliverable?.content) {
      const contentStr = JSON.stringify(deliverable.content);
      if (contentStr.length > 100) {
        score += 15;
        reasons.push('Deliverable has substantial content');
      } else {
        score -= 10;
        reasons.push('Deliverable content is minimal');
      }
    }

    // Check if requirements are addressed
    if (taskSpec?.requirements && deliverable?.content?.requirements_met) {
      const reqCount = taskSpec.requirements.length;
      const metCount = deliverable.content.requirements_met.length;
      if (metCount >= reqCount * 0.8) {
        score += 20;
        reasons.push(`Requirements addressed (${metCount}/${reqCount})`);
      } else {
        score -= 15;
        reasons.push(`Incomplete requirements (${metCount}/${reqCount})`);
      }
    }

    // Consider reputation
    if (sellerReputation > buyerReputation + 100) {
      score += 10;
      reasons.push('Seller has higher reputation');
    } else if (buyerReputation > sellerReputation + 100) {
      score -= 10;
      reasons.push('Buyer has higher reputation');
    }

    // Determine ruling
    // Score > 50: favor seller, Score <= 50: favor buyer
    const ruling = score > 50 ? 1 : 0; // 0 = RefundBuyer, 1 = PaySeller
    const confidence = Math.abs(score - 50) / 50; // 0 to 1

    return {
      score,
      ruling,
      rulingLabel: ruling === 1 ? 'PAY_SELLER' : 'REFUND_BUYER',
      confidence,
      reasons
    };
  }

  /**
   * Heuristic + optional OpenAI drafts for the human arbitrator (nothing submitted on-chain).
   * @param {string} taskId
   */
  async printDisputeRecommendations(taskId) {
    let evidence = this.pendingDisputes.get(taskId);
    if (!evidence) {
      evidence = await this.reviewDispute(taskId);
    }
    if (!evidence) {
      return;
    }

    const heuristic = this.evaluateEvidence(evidence);
    console.log('\n--- Heuristic draft (not submitted on-chain) ---');
    console.log(JSON.stringify(heuristic, null, 2));

    if (llm.useLlmArbitratorAssist()) {
      try {
        console.log('\n--- OpenAI assistant draft (advisory only; not submitted) ---');
        const assist = await llm.arbitratorAssist(evidence);
        console.log(JSON.stringify(assist, null, 2));
      } catch (err) {
        console.warn('OpenAI arbitrator assist failed:', err.message);
      }
    } else if (llm.isLlmConfigured()) {
      console.log('\n(LLM assist off: set USE_LLM_ARBITRATOR_ASSIST=true to enable.)');
    } else {
      console.log('\n(Set OPENAI_API_KEY + USE_LLM_ARBITRATOR_ASSIST=true for an LLM draft.)');
    }

    console.log('\n📌 Human: submit the ruling you approve on-chain:');
    console.log(`   node arbitrator.js resolve ${taskId} 0   # refund buyer`);
    console.log(`   node arbitrator.js resolve ${taskId} 1   # pay seller\n`);
  }

  /**
   * Resolve a dispute with a ruling (human must pass 0|1 unless ARBITRATOR_AUTO_RESOLVE=true).
   * @param {string} taskId - Task ID
   * @param {number|null|undefined} ruling - 0 = refund buyer, 1 = pay seller
   */
  async resolveDispute(taskId, ruling = null) {
    console.log(`\n⚖️ Resolving dispute for task ${taskId.slice(0, 10)}...`);

    // Get or fetch evidence
    let evidence = this.pendingDisputes.get(taskId);
    if (!evidence) {
      evidence = await this.reviewDispute(taskId);
    }

    if (!evidence) {
      throw new Error('Could not gather evidence for dispute');
    }

    let finalRuling = ruling;
    let evaluation = null;

    if (finalRuling === null || finalRuling === undefined) {
      if (!config.behavior.arbitratorAutoResolve) {
        throw new Error(
          'Human-in-the-loop: pass explicit ruling 0 (refund buyer) or 1 (pay seller). ' +
            `Run: node arbitrator.js recommend ${taskId}`
        );
      }
      evaluation = this.evaluateEvidence(evidence);
      finalRuling = evaluation.ruling;

      console.log(`\n   📊 Auto evaluation (ARBITRATOR_AUTO_RESOLVE=true):`);
      console.log(`   Score: ${evaluation.score}/100`);
      console.log(`   Ruling: ${evaluation.rulingLabel}`);
      console.log(`   Confidence: ${(evaluation.confidence * 100).toFixed(1)}%`);
      console.log(`   Reasons:`);
      evaluation.reasons.forEach((r) => console.log(`     - ${r}`));
    }

    // Submit ruling on-chain
    console.log(`\n   📝 Submitting ruling to blockchain...`);
    console.log(`   Ruling: ${finalRuling === 0 ? 'REFUND_BUYER' : 'PAY_SELLER'}`);

    const tx = await this.escrow.resolveDispute(taskId, finalRuling).send({
      feeLimit: 100000000
    });

    console.log(`   Transaction: ${tx}`);
    await waitForConfirmation(this.tronWeb, tx);

    // Upload arbitration report to Filecoin
    const report = {
      type: 'arbitration_report',
      taskId,
      ruling: finalRuling,
      rulingLabel: finalRuling === 0 ? 'REFUND_BUYER' : 'PAY_SELLER',
      evaluation,
      evidence: {
        taskSpecCID: evidence.task.taskSpecCID,
        deliverableCID: evidence.task.deliverableCID
      },
      arbitrator: this.address,
      resolvedAt: new Date().toISOString()
    };

    try {
      const reportUpload = await uploadEvidence(report);
      console.log(`   Arbitration Report CID: ${reportUpload.cid}`);
    } catch (e) {
      console.log('   Could not upload arbitration report');
    }

    // Move to resolved
    this.resolvedDisputes.set(taskId, {
      ...evidence,
      ruling: finalRuling,
      resolvedAt: Date.now(),
      txHash: tx
    });
    this.pendingDisputes.delete(taskId);

    const winner = finalRuling === 0 ? evidence.task.buyer : evidence.task.seller;
    console.log(`\n✅ Dispute resolved!`);
    console.log(`   Winner: ${winner}`);
    console.log(`   View on explorer: ${config.network.explorerUrl}/#/transaction/${tx}\n`);

    return { taskId, ruling: finalRuling, txHash: tx, winner };
  }

  /**
   * Listen for new disputes
   */
  async listenForDisputes() {
    try {
      const events = await getContractEvents(this.tronWeb, config.contracts.escrow, {
        eventName: 'DisputeOpened',
        sinceTimestamp: this.lastEventTimestamp,
        limit: 50
      });

      for (const event of events) {
        const taskId = event.result.taskId;

        // Skip if already processed
        if (this.pendingDisputes.has(taskId) || this.resolvedDisputes.has(taskId)) {
          continue;
        }

        console.log(`\n🚨 New dispute detected: ${taskId.slice(0, 10)}`);
        console.log(`   Buyer: ${this.tronWeb.address.fromHex(event.result.buyer)}`);
        console.log(`   Seller: ${this.tronWeb.address.fromHex(event.result.seller)}`);

        await this.reviewDispute(taskId);
        await this.printDisputeRecommendations(taskId);

        if (config.behavior.arbitratorAutoResolve) {
          const ev = this.pendingDisputes.get(taskId);
          if (ev) {
            const evaluation = this.evaluateEvidence(ev);
            await this.resolveDispute(taskId, evaluation.ruling);
          }
        }

        if (event.timestamp > this.lastEventTimestamp) {
          this.lastEventTimestamp = event.timestamp;
        }
      }
    } catch (error) {
      console.error('Error listening for disputes:', error.message);
    }
  }

  /**
   * Start autonomous mode
   */
  async start() {
    console.log('🚀 Starting Arbitrator Agent in autonomous mode...\n');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.listenForDisputes();
      } catch (error) {
        console.error('Loop error:', error.message);
      }

      await this.sleep(config.behavior.pollInterval);
    }
  }

  /**
   * Stop the agent
   */
  stop() {
    console.log('🛑 Stopping Arbitrator Agent...');
    this.isRunning = false;
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      address: this.address,
      pendingDisputes: this.pendingDisputes.size,
      resolvedDisputes: this.resolvedDisputes.size,
      disputes: {
        pending: Array.from(this.pendingDisputes.keys()),
        resolved: Array.from(this.resolvedDisputes.values())
      },
      isRunning: this.isRunning
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const agent = new ArbitratorAgent();
  await agent.init();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'review':
    case 'recommend': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node arbitrator.js recommend <task_id>');
        process.exit(1);
      }
      await agent.printDisputeRecommendations(taskId);
      break;
    }

    case 'resolve': {
      const taskId = args[1];
      const rulingArg = args[2];
      if (!taskId) {
        console.log('Usage: node arbitrator.js resolve <task_id> <0|1>');
        console.log('  0 = refund buyer, 1 = pay seller');
        process.exit(1);
      }
      if (rulingArg === undefined || rulingArg === '') {
        console.error('\nHuman-in-the-loop: you must pass an explicit ruling.');
        console.error('  0 = refund buyer, 1 = pay seller');
        console.error(`  Example: node arbitrator.js resolve ${taskId} 1`);
        console.error(`  Drafts:  node arbitrator.js recommend ${taskId}`);
        console.error('  (Set ARBITRATOR_AUTO_RESOLVE=true only if you want auto-submit from heuristics.)\n');
        process.exit(1);
      }
      const ruling = parseInt(rulingArg, 10);
      if (Number.isNaN(ruling) || (ruling !== 0 && ruling !== 1)) {
        console.error('Ruling must be 0 or 1.');
        process.exit(1);
      }
      await agent.resolveDispute(taskId, ruling);
      break;
    }

    case 'check': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node arbitrator.js check <task_id>');
        process.exit(1);
      }
      const task = await agent.checkTask(taskId);
      console.log('\nTask Details:', JSON.stringify(task, null, 2));
      break;
    }

    case 'listen': {
      await agent.start();
      break;
    }

    default:
      console.log(`
Whistle Arbitrator Agent

Commands:
  recommend <taskId>   Heuristic + optional OpenAI drafts (human decides next)
  resolve <taskId> <0|1>  Submit ruling on-chain (0=refund buyer, 1=pay seller)
  check <taskId>       Check task status
  listen               Watch disputes; prints drafts (auto-resolve only if ARBITRATOR_AUTO_RESOLVE=true)

Examples:
  node arbitrator.js recommend 0x1234...
  node arbitrator.js resolve 0x1234... 1
  node arbitrator.js listen
      `);
  }
}

module.exports = ArbitratorAgent;

if (require.main === module) {
  main().catch(console.error);
}
