/**
 * Whistle - Seller Agent
 * Autonomous agent that accepts tasks, generates deliverables, and uploads to Filecoin
 */

require('dotenv').config();
const { createTronWeb, getBalance, waitForConfirmation, getContractEvents } = require('../lib/tron');
const { uploadDeliverable, retrieveJson } = require('../lib/filecoin');
const { TaskState, TaskStateLabels } = require('../lib/types');
const llm = require('../lib/llm');
const config = require('./config');

// Contract ABIs
const ESCROW_ABI = [
  {
    "inputs": [{"name": "taskId", "type": "bytes32"}, {"name": "deliverableCID", "type": "string"}],
    "name": "submitDeliverable",
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
    "inputs": [{"name": "taskId", "type": "bytes32"}],
    "name": "taskExistsCheck",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  }
];

class SellerAgent {
  constructor() {
    this.tronWeb = null;
    this.escrow = null;
    this.address = null;
    this.assignedTasks = new Map(); // taskId -> task info
    this.completedTasks = new Map();
    this.isRunning = false;
    this.lastEventTimestamp = 0;
  }

  /**
   * Initialize the seller agent
   */
  async init() {
    console.log('\n🏪 Initializing Seller Agent...');

    if (!config.agents.seller.privateKey) {
      throw new Error('SELLER_PRIVATE_KEY not set in environment');
    }
    if (!config.contracts.escrow) {
      throw new Error('ESCROW_ADDRESS not set in environment');
    }

    this.tronWeb = createTronWeb(config.agents.seller.privateKey, config.network.name);
    this.address = this.tronWeb.defaultAddress.base58;

    this.escrow = await this.tronWeb.contract(ESCROW_ABI, config.contracts.escrow);

    const balance = await getBalance(this.tronWeb, this.address);

    console.log(`   Address: ${this.address}`);
    console.log(`   Balance: ${balance} TRX`);
    console.log(`   Escrow Contract: ${config.contracts.escrow}`);
    console.log('✅ Seller Agent initialized\n');

    return this;
  }

  /**
   * Check task details
   * @param {string} taskId - Task ID
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
   * Accept a task (fetch spec and prepare to work)
   * @param {string} taskId - Task ID to accept
   */
  async acceptTask(taskId) {
    console.log(`\n📋 Accepting task ${taskId.slice(0, 10)}...`);

    const task = await this.checkTask(taskId);

    // Verify this task is assigned to us
    if (task.seller !== this.address) {
      throw new Error(`Task not assigned to this seller. Expected ${this.address}, got ${task.seller}`);
    }

    if (task.state !== TaskState.FUNDED) {
      throw new Error(`Task is not in FUNDED state (current: ${task.stateLabel})`);
    }

    // Fetch task spec from Filecoin
    console.log('   Fetching task specification from Filecoin...');
    const taskSpec = await retrieveJson(task.taskSpecCID);

    console.log(`   Title: ${taskSpec.title}`);
    console.log(`   Description: ${taskSpec.description}`);
    console.log(`   Amount: ${task.amount} TRX`);

    // Track the task
    this.assignedTasks.set(taskId, {
      taskId,
      task,
      taskSpec,
      acceptedAt: Date.now()
    });

    console.log('✅ Task accepted!\n');

    return { task, taskSpec };
  }

  /**
   * Generate a deliverable for a task
   * This is a simulation - in production, this would be actual AI work
   * @param {string} taskId - Task ID
   */
  async generateDeliverable(taskId) {
    console.log(`\n🔧 Generating deliverable for task ${taskId.slice(0, 10)}...`);

    const assigned = this.assignedTasks.get(taskId);
    if (!assigned) {
      throw new Error('Task not found in assigned tasks. Accept it first.');
    }

    const { taskSpec } = assigned;

    console.log('   Processing task requirements...');
    await this.sleep(500);

    let content;
    if (llm.useLlmSeller()) {
      try {
        console.log('   Using OpenAI seller (model:', llm.getModel() + ')...');
        const draft = await llm.generateSellerDeliverable(taskSpec, taskId, this.address);
        content = draft.content;
        if (draft.notes) {
          console.log('   Seller notes:', draft.notes.slice(0, 120) + (draft.notes.length > 120 ? '…' : ''));
        }
      } catch (err) {
        console.warn('   LLM seller failed, falling back to simulateWork:', err.message);
        content = this.simulateWork(taskSpec);
      }
    } else {
      await this.sleep(500);
      content = this.simulateWork(taskSpec);
    }

    console.log('   Deliverable generated.');
    console.log(`   Content preview: ${JSON.stringify(content).slice(0, 100)}...`);

    return {
      taskId,
      content,
      generatedAt: new Date().toISOString(),
      agentId: this.address
    };
  }

  /**
   * Simulate work based on task spec
   * Replace with actual AI/work logic in production
   */
  simulateWork(taskSpec) {
    const title = taskSpec.title || 'Task';

    // Generate mock content based on task type
    if (title.toLowerCase().includes('article') || title.toLowerCase().includes('content')) {
      return {
        type: 'article',
        title: `Understanding ${taskSpec.description?.split(' ').slice(0, 3).join(' ') || 'Blockchain'}`,
        body: `This is a comprehensive article about blockchain technology.
               Blockchain is a distributed ledger technology that enables secure, transparent,
               and immutable record-keeping. It was first introduced with Bitcoin in 2008
               by the pseudonymous Satoshi Nakamoto. Since then, blockchain has evolved
               to support smart contracts, decentralized applications, and various other
               use cases beyond cryptocurrency. The technology relies on cryptographic
               hashing, consensus mechanisms, and peer-to-peer networking to maintain
               its security and decentralization properties.`,
        wordCount: 85,
        requirements_met: taskSpec.requirements || []
      };
    } else if (title.toLowerCase().includes('code') || title.toLowerCase().includes('develop')) {
      return {
        type: 'code',
        language: 'javascript',
        code: `// Generated code for: ${title}\nfunction solution() {\n  console.log("Task completed");\n  return true;\n}`,
        tests_passed: true
      };
    } else {
      return {
        type: 'general',
        result: `Completed task: ${title}`,
        details: taskSpec.description || 'Task completed successfully',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Submit a deliverable to the blockchain
   * @param {string} taskId - Task ID
   * @param {Object} deliverable - Deliverable content (optional, will generate if not provided)
   */
  async submitDeliverable(taskId, deliverable = null) {
    console.log(`\n📤 Submitting deliverable for task ${taskId.slice(0, 10)}...`);

    // Generate deliverable if not provided
    if (!deliverable) {
      deliverable = await this.generateDeliverable(taskId);
    }

    // Upload to Filecoin
    console.log('   Uploading deliverable to Filecoin...');
    const upload = await uploadDeliverable(deliverable);
    console.log(`   Deliverable CID: ${upload.cid}`);

    // Submit on-chain
    console.log('   Submitting to blockchain...');
    const tx = await this.escrow.submitDeliverable(taskId, upload.cid).send({
      feeLimit: 50000000
    });

    console.log(`   Transaction: ${tx}`);
    await waitForConfirmation(this.tronWeb, tx);

    // Update tracking
    if (this.assignedTasks.has(taskId)) {
      const taskInfo = this.assignedTasks.get(taskId);
      taskInfo.deliverableCID = upload.cid;
      taskInfo.submittedAt = Date.now();
      taskInfo.state = TaskState.DELIVERED;
      this.completedTasks.set(taskId, taskInfo);
    }

    console.log('✅ Deliverable submitted!');
    console.log(`   View on explorer: ${config.network.explorerUrl}/#/transaction/${tx}\n`);

    return {
      taskId,
      deliverableCID: upload.cid,
      txHash: tx
    };
  }

  /**
   * Process a task end-to-end: accept, generate, submit
   * @param {string} taskId - Task ID
   */
  async processTask(taskId) {
    console.log(`\n🔄 Processing task ${taskId.slice(0, 10)} end-to-end...`);

    // Accept the task
    await this.acceptTask(taskId);

    // Generate deliverable
    const deliverable = await this.generateDeliverable(taskId);

    // Submit deliverable
    const result = await this.submitDeliverable(taskId, deliverable);

    console.log('✅ Task processed successfully!\n');

    return result;
  }

  /**
   * Listen for new tasks assigned to this seller
   */
  async listenForTasks() {
    console.log('👂 Listening for new tasks...');

    try {
      const events = await getContractEvents(this.tronWeb, config.contracts.escrow, {
        eventName: 'TaskCreated',
        sinceTimestamp: this.lastEventTimestamp,
        limit: 50
      });

      for (const event of events) {
        const seller = this.tronWeb.address.fromHex(event.result.seller);

        // Check if this task is assigned to us
        if (seller === this.address) {
          const taskId = event.result.taskId;

          // Skip if already processing
          if (this.assignedTasks.has(taskId) || this.completedTasks.has(taskId)) {
            continue;
          }

          console.log(`\n📬 New task received: ${taskId.slice(0, 10)}`);
          console.log(`   Buyer: ${this.tronWeb.address.fromHex(event.result.buyer)}`);
          console.log(`   Amount: ${this.tronWeb.fromSun(event.result.amount)} TRX`);

          // Auto-process if in autonomous mode
          if (config.behavior.autoApproveEnabled) {
            await this.processTask(taskId);
          }
        }

        // Update last timestamp
        if (event.timestamp > this.lastEventTimestamp) {
          this.lastEventTimestamp = event.timestamp;
        }
      }
    } catch (error) {
      console.error('Error listening for tasks:', error.message);
    }
  }

  /**
   * Monitor assigned tasks for status changes
   */
  async monitorTasks() {
    for (const [taskId, info] of this.completedTasks) {
      if (info.state === TaskState.DELIVERED) {
        const task = await this.checkTask(taskId);

        if (task.state === TaskState.APPROVED) {
          console.log(`\n🎉 Task ${taskId.slice(0, 10)} approved! Payment received.`);
          info.state = TaskState.APPROVED;
        } else if (task.state === TaskState.DISPUTED) {
          console.log(`\n⚠️ Task ${taskId.slice(0, 10)} disputed! Awaiting arbitration.`);
          info.state = TaskState.DISPUTED;
        } else if (task.state === TaskState.RESOLVED) {
          console.log(`\n⚖️ Task ${taskId.slice(0, 10)} resolved. Ruling: ${task.ruling === 1 ? 'PAID' : 'REFUNDED'}`);
          info.state = TaskState.RESOLVED;
        }
      }
    }
  }

  /**
   * Start autonomous mode
   */
  async start() {
    console.log('🚀 Starting Seller Agent in autonomous mode...\n');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.listenForTasks();
        await this.monitorTasks();
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
    console.log('🛑 Stopping Seller Agent...');
    this.isRunning = false;
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      address: this.address,
      assignedTasks: this.assignedTasks.size,
      completedTasks: this.completedTasks.size,
      tasks: {
        assigned: Array.from(this.assignedTasks.values()),
        completed: Array.from(this.completedTasks.values())
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
  const agent = new SellerAgent();
  await agent.init();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'accept': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node seller.js accept <task_id>');
        process.exit(1);
      }
      await agent.acceptTask(taskId);
      break;
    }

    case 'submit': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node seller.js submit <task_id>');
        process.exit(1);
      }
      await agent.submitDeliverable(taskId);
      break;
    }

    case 'process': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node seller.js process <task_id>');
        process.exit(1);
      }
      await agent.processTask(taskId);
      break;
    }

    case 'check': {
      const taskId = args[1];
      if (!taskId) {
        console.log('Usage: node seller.js check <task_id>');
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
Whistle Seller Agent

Commands:
  accept <taskId>   Accept a task and fetch spec
  submit <taskId>   Generate and submit deliverable
  process <taskId>  Accept, generate, and submit (full flow)
  check <taskId>    Check task status
  listen            Start autonomous listening mode

Examples:
  node seller.js process 0x1234...
  node seller.js check 0x1234...
  node seller.js listen
      `);
  }
}

module.exports = SellerAgent;

if (require.main === module) {
  main().catch(console.error);
}
