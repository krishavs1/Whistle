/**
 * ArbiChain - Demo Script
 * Demonstrates the full escrow flow: happy path + dispute path
 */

require('dotenv').config();
const BuyerAgent = require('../agents/buyer');
const SellerAgent = require('../agents/seller');
const ArbitratorAgent = require('../agents/arbitrator');
const { TaskState } = require('../lib/types');

// Demo configuration
const DEMO_AMOUNT_TRX = 10; // Amount to escrow
const DEMO_DELAY_MS = 3000; // Delay between steps for visibility

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function printDivider(title) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60) + '\n');
}

async function runHappyPath(buyer, seller) {
  await printDivider('🎯 HAPPY PATH: Task → Deliver → Approve');

  // Step 1: Buyer creates task
  console.log('📌 Step 1: Buyer creates task with escrow\n');

  const taskSpec = {
    title: 'Write a blockchain article',
    description: 'Create a 200-word article explaining blockchain technology',
    requirements: [
      'Minimum 200 words',
      'Include introduction',
      'Explain key concepts',
      'Original content'
    ],
    deliverableFormat: 'JSON with content field'
  };

  const task = await buyer.createTask(taskSpec, seller.address, DEMO_AMOUNT_TRX);
  const taskId = task.taskId;

  await sleep(DEMO_DELAY_MS);

  // Step 2: Seller processes the task
  console.log('📌 Step 2: Seller accepts and completes task\n');
  await seller.processTask(taskId);

  await sleep(DEMO_DELAY_MS);

  // Step 3: Buyer reviews and approves
  console.log('📌 Step 3: Buyer reviews deliverable\n');
  const review = await buyer.reviewDeliverable(taskId);

  await sleep(DEMO_DELAY_MS);

  console.log('📌 Step 4: Buyer approves deliverable\n');
  await buyer.approveDeliverable(taskId);

  // Verify final state
  await sleep(DEMO_DELAY_MS);
  const finalTask = await buyer.checkTask(taskId);

  console.log('\n📊 Final Task State:');
  console.log(`   State: ${finalTask.stateLabel}`);
  console.log(`   Seller paid: ${finalTask.state === TaskState.APPROVED ? 'YES ✓' : 'NO'}`);

  return taskId;
}

async function runDisputePath(buyer, seller, arbitrator) {
  await printDivider('⚠️ DISPUTE PATH: Task → Deliver → Dispute → Resolve');

  // Step 1: Buyer creates task
  console.log('📌 Step 1: Buyer creates task with escrow\n');

  const taskSpec = {
    title: 'Generate minimal content',
    description: 'Create something very short',
    requirements: [
      'At least 500 words',
      'Include references',
      'Academic quality'
    ],
    deliverableFormat: 'JSON with content field'
  };

  const task = await buyer.createTask(taskSpec, seller.address, DEMO_AMOUNT_TRX);
  const taskId = task.taskId;

  await sleep(DEMO_DELAY_MS);

  // Step 2: Seller submits (minimal deliverable)
  console.log('📌 Step 2: Seller submits deliverable\n');
  await seller.processTask(taskId);

  await sleep(DEMO_DELAY_MS);

  // Step 3: Buyer disputes
  console.log('📌 Step 3: Buyer opens dispute\n');
  await buyer.openDispute(taskId, 'Deliverable does not meet requirements - too short');

  await sleep(DEMO_DELAY_MS);

  // Step 4: Arbitrator resolves
  console.log('📌 Step 4: Arbitrator reviews and resolves dispute\n');
  const result = await arbitrator.resolveDispute(taskId);

  // Verify final state
  await sleep(DEMO_DELAY_MS);
  const finalTask = await buyer.checkTask(taskId);

  console.log('\n📊 Final Task State:');
  console.log(`   State: ${finalTask.stateLabel}`);
  console.log(`   Ruling: ${result.ruling === 0 ? 'REFUND_BUYER' : 'PAY_SELLER'}`);
  console.log(`   Winner: ${result.winner}`);

  return taskId;
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     █████╗ ██████╗ ██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗ ║
║    ██╔══██╗██╔══██╗██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗║
║    ███████║██████╔╝██████╔╝██║██║     ███████║███████║██║██╔██║
║    ██╔══██║██╔══██╗██╔══██╗██║██║     ██╔══██║██╔══██║██║██║██║
║    ██║  ██║██║  ██║██████╔╝██║╚██████╗██║  ██║██║  ██║██║██║██║
║    ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝╚═╝
║                                                               ║
║         Autonomous Escrow for AI Agent Commerce               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);

  console.log('Initializing agents...\n');

  // Initialize all agents
  const buyer = await new BuyerAgent().init();
  const seller = await new SellerAgent().init();
  const arbitrator = await new ArbitratorAgent().init();

  await printDivider('📋 AGENT SUMMARY');
  console.log(`  Buyer:      ${buyer.address}`);
  console.log(`  Seller:     ${seller.address}`);
  console.log(`  Arbitrator: ${arbitrator.address}`);
  console.log(`  Network:    ${process.env.TRON_NETWORK || 'nile'}`);

  await sleep(2000);

  // Parse command line args
  const args = process.argv.slice(2);
  const mode = args[0] || 'both';

  try {
    if (mode === 'happy' || mode === 'both') {
      await runHappyPath(buyer, seller);
    }

    if (mode === 'dispute' || mode === 'both') {
      await sleep(3000);
      await runDisputePath(buyer, seller, arbitrator);
    }

    await printDivider('✅ DEMO COMPLETE');

    console.log('Summary:');
    console.log(`  Buyer Tasks: ${buyer.activeTasks.size}`);
    console.log(`  Seller Completed: ${seller.completedTasks.size}`);
    console.log(`  Arbitrator Resolved: ${arbitrator.resolvedDisputes.size}`);

    console.log('\nAll transactions can be viewed on:');
    console.log(`  ${process.env.TRON_NETWORK === 'mainnet' ? 'https://tronscan.org' : 'https://nile.tronscan.org'}`);

  } catch (error) {
    console.error('\n❌ Demo error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// CLI help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
ArbiChain Demo Script

Usage:
  node scripts/demo.js [mode]

Modes:
  happy     Run only the happy path (task → deliver → approve)
  dispute   Run only the dispute path (task → deliver → dispute → resolve)
  both      Run both paths (default)

Examples:
  node scripts/demo.js
  node scripts/demo.js happy
  node scripts/demo.js dispute

Requirements:
  - BUYER_PRIVATE_KEY, SELLER_PRIVATE_KEY, ARBITRATOR_PRIVATE_KEY in .env
  - ESCROW_ADDRESS and REPUTATION_GATE_ADDRESS in .env
  - Sufficient TRX balance in buyer wallet (at least 30 TRX for both demos)
  `);
  process.exit(0);
}

main().catch(console.error);
