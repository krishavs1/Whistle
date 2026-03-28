/**
 * Whistle - Full Demo Script
 * Demonstrates: Happy path → Dispute path → Reputation consequences
 *
 * Run: node scripts/demo.js [happy|dispute|both]
 */

require('dotenv').config();
const TronWeb = require('tronweb');
const { createTronWeb, getBalance, waitForConfirmation } = require('../lib/tron');
const { uploadTaskSpec, uploadDeliverable, uploadEvidence, retrieveJson, getStatus } = require('../lib/filecoin');
const { TaskState, TaskStateLabels, generateTaskId } = require('../lib/types');

const DEMO_AMOUNT_TRX = 10;
const EXPLORER = process.env.TRON_NETWORK === 'mainnet'
  ? 'https://tronscan.org'
  : 'https://nile.tronscan.org';

// ============ ABIs ============

const ESCROW_ABI = [
  { inputs:[{name:'taskId',type:'bytes32'},{name:'seller',type:'address'},{name:'taskSpecCID',type:'string'},{name:'deliverByTimestamp',type:'uint256'},{name:'reviewWindowSeconds',type:'uint256'}], name:'createTask', stateMutability:'payable', type:'function' },
  { inputs:[{name:'taskId',type:'bytes32'},{name:'deliverableCID',type:'string'}], name:'submitDeliverable', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'taskId',type:'bytes32'}], name:'approveDeliverable', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'taskId',type:'bytes32'},{name:'reason',type:'uint8'}], name:'openDisputeByBuyer', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'taskId',type:'bytes32'},{name:'ruling',type:'uint8'}], name:'resolveDispute', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'taskId',type:'bytes32'}], name:'getTask', outputs:[{components:[
    {name:'buyer',type:'address'},{name:'seller',type:'address'},{name:'amount',type:'uint256'},
    {name:'taskSpecCID',type:'string'},{name:'deliverableCID',type:'string'},
    {name:'state',type:'uint8'},{name:'ruling',type:'uint8'},
    {name:'createdAt',type:'uint256'},{name:'deliveredAt',type:'uint256'},{name:'resolvedAt',type:'uint256'}
  ],name:'',type:'tuple'}], stateMutability:'view', type:'function' },
  { inputs:[], name:'arbitrator', outputs:[{name:'',type:'address'}], stateMutability:'view', type:'function' }
];

const REPGATE_ABI = [
  { inputs:[{name:'buyer',type:'address'},{name:'seller',type:'address'},{name:'amount',type:'uint256'}], name:'recordTaskCompletion', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'buyer',type:'address'},{name:'seller',type:'address'}], name:'recordDisputeOpened', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'winner',type:'address'},{name:'loser',type:'address'}], name:'recordDisputeResolution', stateMutability:'nonpayable', type:'function' },
  { inputs:[{name:'agent',type:'address'}], name:'getReputation', outputs:[{name:'',type:'uint256'}], stateMutability:'view', type:'function' },
  { inputs:[{name:'agent',type:'address'}], name:'getAgentStats', outputs:[{components:[
    {name:'reputation',type:'uint256'},{name:'tasksCompleted',type:'uint256'},
    {name:'tasksDisputed',type:'uint256'},{name:'disputesWon',type:'uint256'},
    {name:'disputesLost',type:'uint256'},{name:'totalVolumeAsBuyer',type:'uint256'},
    {name:'totalVolumeAsSeller',type:'uint256'},{name:'registeredAt',type:'uint256'},
    {name:'isRegistered',type:'bool'}
  ],name:'',type:'tuple'}], stateMutability:'view', type:'function' },
  { inputs:[{name:'buyer',type:'address'},{name:'seller',type:'address'},{name:'amount',type:'uint256'}], name:'getSuggestedTerms',
    outputs:[{name:'suggestedDeposit',type:'uint256'},{name:'requiresArbitration',type:'bool'}], stateMutability:'view', type:'function' },
  { inputs:[{name:'agent',type:'address'}], name:'isRegistered', outputs:[{name:'',type:'bool'}], stateMutability:'view', type:'function' }
];

// ============ Helpers ============

function div(title) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${title}`);
  console.log('═'.repeat(65) + '\n');
}

function step(n, msg) { console.log(`\n  📌 Step ${n}: ${msg}\n`); }
function info(label, val) { console.log(`     ${label}: ${val}`); }
function link(label, txHash) { console.log(`     ${label}: ${EXPLORER}/#/transaction/${txHash}`); }
function ok(msg) { console.log(`\n  ✅ ${msg}\n`); }
function warn(msg) { console.log(`\n  ⚠️  ${msg}\n`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function printReputation(repGate, tw, address, label) {
  const stats = await repGate.getAgentStats(address).call();
  const rep = Number(stats.reputation);
  const tier = rep >= 700 ? 'Trusted' : rep >= 500 ? 'Established' : rep >= 300 ? 'New' : 'Untrusted';
  console.log(`     ${label}: ${rep}/1000 (${tier}) | completed: ${stats.tasksCompleted} | disputes won: ${stats.disputesWon} lost: ${stats.disputesLost}`);
  return rep;
}

async function getTaskOnChain(escrow, tw, taskId) {
  const t = await escrow.getTask(taskId).call();
  return {
    buyer: tw.address.fromHex(t.buyer),
    seller: tw.address.fromHex(t.seller),
    amount: tw.fromSun(t.amount.toString()),
    taskSpecCID: t.taskSpecCID,
    deliverableCID: t.deliverableCID,
    state: Number(t.state),
    stateLabel: TaskStateLabels[Number(t.state)],
    ruling: Number(t.ruling)
  };
}

// ============ Happy Path ============

async function runHappyPath(buyerTw, sellerTw, escrowBuyer, escrowSeller, repGate, repGateTw) {
  div('🎯 SCENARIO 1: Happy Path — Task → Deliver → Approve → Pay');

  const taskId = generateTaskId();
  const sellerAddr = sellerTw.defaultAddress.base58;
  const buyerAddr = buyerTw.defaultAddress.base58;

  // Step 1: Buyer uploads task spec to Filecoin
  step(1, 'Buyer creates task and locks TRX in escrow');

  const taskSpec = {
    title: 'Write a blockchain explainer article',
    description: 'Create a 200+ word article explaining how blockchain consensus works',
    requirements: ['Minimum 200 words', 'Cover proof-of-work and proof-of-stake', 'Include real-world examples', 'Original content'],
    deliverableFormat: 'JSON with content field',
    maxPayment: `${DEMO_AMOUNT_TRX} TRX`
  };

  info('Task', taskSpec.title);
  info('Escrow', `${DEMO_AMOUNT_TRX} TRX`);
  info('Seller', sellerAddr);

  console.log('     Uploading task spec to Filecoin...');
  const specUpload = await uploadTaskSpec({ ...taskSpec, taskId, buyer: buyerAddr, seller: sellerAddr });
  info('Task Spec CID', specUpload.cid);
  info('Storage', `${specUpload.provider} (${specUpload.network || 'mock'})`);

  console.log('     Locking funds in TRON escrow...');
  const amountSun = buyerTw.toSun(DEMO_AMOUNT_TRX);
  const deliverBy = Math.floor(Date.now() / 1000) + 86400;
  const tx1 = await escrowBuyer.createTask(taskId, sellerAddr, specUpload.cid, deliverBy, 3600).send({ callValue: amountSun, feeLimit: 100000000 });
  await waitForConfirmation(buyerTw, tx1);
  info('TRON TX', tx1);
  link('Explorer', tx1);
  ok('Task created. 10 TRX locked in escrow.');

  await sleep(2000);

  // Step 2: Seller fetches spec from Filecoin, generates deliverable, uploads & submits
  step(2, 'Seller accepts task, generates deliverable, uploads to Filecoin');

  console.log('     Fetching task spec from Filecoin...');
  const fetchedSpec = await retrieveJson(specUpload.cid);
  info('Fetched title', fetchedSpec.title);

  const deliverableContent = {
    taskId,
    content: {
      type: 'article',
      title: 'Understanding Blockchain Consensus Mechanisms',
      body: `Blockchain consensus mechanisms are the protocols that ensure all nodes in a decentralized network agree on the current state of the ledger. The two most prominent approaches are Proof of Work (PoW) and Proof of Stake (PoS).

Proof of Work, pioneered by Bitcoin in 2009, requires miners to solve computationally intensive puzzles. The first miner to find a valid hash gets to add the next block and receive a reward. While extremely secure, PoW consumes significant energy — Bitcoin alone uses more electricity than some countries.

Proof of Stake offers an energy-efficient alternative. Instead of computational power, validators lock up cryptocurrency as collateral. Ethereum's transition to PoS in 2022 ("The Merge") reduced its energy consumption by 99.95%. Validators are chosen based on their staked amount and other factors.

Real-world examples abound: supply chain tracking (Walmart uses blockchain to trace food origins), decentralized finance (Aave enables peer-to-peer lending without banks), and digital identity (Estonia's e-Residency program). These applications rely on consensus mechanisms to maintain trust without centralized authorities.

The evolution from PoW to PoS reflects the broader maturation of blockchain technology — balancing security, decentralization, and sustainability for practical adoption.`,
      wordCount: 178,
      requirements_met: ['200+ words', 'Covers PoW and PoS', 'Includes Walmart, Aave, Estonia examples', 'Original content']
    },
    generatedAt: new Date().toISOString(),
    agentId: sellerAddr
  };

  console.log('     Uploading deliverable to Filecoin...');
  const delivUpload = await uploadDeliverable(deliverableContent);
  info('Deliverable CID', delivUpload.cid);

  console.log('     Submitting on-chain...');
  const tx2 = await escrowSeller.submitDeliverable(taskId, delivUpload.cid).send({ feeLimit: 50000000 });
  await waitForConfirmation(sellerTw, tx2);
  info('TRON TX', tx2);
  link('Explorer', tx2);
  ok('Deliverable submitted to blockchain + Filecoin.');

  await sleep(2000);

  // Step 3: Buyer reviews from Filecoin and approves
  step(3, 'Buyer retrieves deliverable from Filecoin, reviews, and approves');

  console.log('     Fetching deliverable from Filecoin...');
  const fetchedDeliv = await retrieveJson(delivUpload.cid);
  info('Content type', fetchedDeliv.content?.type);
  info('Word count', fetchedDeliv.content?.wordCount);
  console.log('     Review: Content meets requirements ✓');

  console.log('     Approving and releasing funds...');
  const tx3 = await escrowBuyer.approveDeliverable(taskId).send({ feeLimit: 50000000 });
  await waitForConfirmation(buyerTw, tx3);
  info('TRON TX', tx3);
  link('Explorer', tx3);

  ok('Funds released to seller. Reputations updated by Escrow.');

  // Print final state
  const finalTask = await getTaskOnChain(escrowBuyer, buyerTw, taskId);
  console.log('  📊 Final State:');
  info('Task State', finalTask.stateLabel);
  info('Seller paid', 'YES');
  await printReputation(repGate, repGateTw, buyerAddr, 'Buyer reputation');
  await printReputation(repGate, repGateTw, sellerAddr, 'Seller reputation');

  return taskId;
}

// ============ Dispute Path ============

async function runDisputePath(buyerTw, sellerTw, arbTw, escrowBuyer, escrowSeller, escrowArb, repGate, repGateTw) {
  div('⚠️  SCENARIO 2: Dispute Path — Task → Bad Delivery → Dispute → Arbitration → Refund');

  const taskId = generateTaskId();
  const sellerAddr = sellerTw.defaultAddress.base58;
  const buyerAddr = buyerTw.defaultAddress.base58;
  const arbAddr = arbTw.defaultAddress.base58;

  // Step 1: Buyer creates a task with strict requirements
  step(1, 'Buyer creates task with strict requirements');

  const taskSpec = {
    title: 'Academic research paper on zero-knowledge proofs',
    description: 'Write a 500+ word academic paper on ZK-proofs with citations',
    requirements: ['Minimum 500 words', 'Include academic citations (at least 3)', 'Cover ZK-SNARKs and ZK-STARKs', 'Formal academic tone'],
    deliverableFormat: 'JSON with content field',
    maxPayment: `${DEMO_AMOUNT_TRX} TRX`
  };

  info('Task', taskSpec.title);
  info('Escrow', `${DEMO_AMOUNT_TRX} TRX`);

  console.log('     Uploading task spec to Filecoin...');
  const specUpload = await uploadTaskSpec({ ...taskSpec, taskId, buyer: buyerAddr, seller: sellerAddr });
  info('Task Spec CID', specUpload.cid);

  console.log('     Locking funds in TRON escrow...');
  const amountSun = buyerTw.toSun(DEMO_AMOUNT_TRX);
  const deliverBy = Math.floor(Date.now() / 1000) + 86400;
  const tx1 = await escrowBuyer.createTask(taskId, sellerAddr, specUpload.cid, deliverBy, 3600).send({ callValue: amountSun, feeLimit: 100000000 });
  await waitForConfirmation(buyerTw, tx1);
  info('TRON TX', tx1);
  link('Explorer', tx1);
  ok('Task created. 10 TRX locked in escrow.');

  await sleep(2000);

  // Step 2: Seller submits garbage deliverable
  step(2, 'Seller submits a clearly inadequate deliverable');

  const garbageDeliverable = {
    taskId,
    content: {
      type: 'article',
      title: 'ZK stuff',
      body: 'Zero knowledge proofs are cool. They let you prove things without showing the data. The end.'
    },
    generatedAt: new Date().toISOString(),
    agentId: sellerAddr
  };

  console.log('     Uploading garbage deliverable to Filecoin...');
  const delivUpload = await uploadDeliverable(garbageDeliverable);
  info('Deliverable CID', delivUpload.cid);

  console.log('     Submitting on-chain...');
  const tx2 = await escrowSeller.submitDeliverable(taskId, delivUpload.cid).send({ feeLimit: 50000000 });
  await waitForConfirmation(sellerTw, tx2);
  info('TRON TX', tx2);
  link('Explorer', tx2);
  warn('Seller submitted a 20-word "paper" for a 500-word requirement.');

  await sleep(2000);

  // Step 3: Buyer reviews, finds it inadequate, opens dispute
  step(3, 'Buyer reviews deliverable and opens dispute');

  console.log('     Fetching deliverable from Filecoin...');
  const fetchedDeliv = await retrieveJson(delivUpload.cid);
  const wordCount = fetchedDeliv.content?.body?.split(/\s+/).length || 0;
  info('Content preview', `"${fetchedDeliv.content?.body}"`);
  info('Word count', `${wordCount} (required: 500+)`);
  console.log('     Review: REJECTED — grossly under word count, no citations');

  console.log('     Opening dispute on-chain...');
  const tx3 = await escrowBuyer.openDisputeByBuyer(taskId, 1).send({ feeLimit: 50000000 });
  await waitForConfirmation(buyerTw, tx3);
  info('TRON TX', tx3);
  link('Explorer', tx3);
  ok('Dispute opened. Reputation update recorded by Escrow.');

  await sleep(2000);

  // Step 4: Arbitrator reviews evidence from Filecoin and rules
  step(4, 'Arbitrator pulls evidence from Filecoin, evaluates, and rules');

  console.log('     Arbitrator fetching task spec from Filecoin...');
  const arbSpec = await retrieveJson(specUpload.cid);
  console.log('     Arbitrator fetching deliverable from Filecoin...');
  const arbDeliv = await retrieveJson(delivUpload.cid);

  const arbWordCount = arbDeliv.content?.body?.split(/\s+/).length || 0;
  const hasCitations = /\[\d+\]|et al\.|doi:/i.test(arbDeliv.content?.body || '');
  const coversZkSnarks = /zk-snark/i.test(arbDeliv.content?.body || '');
  const coversZkStarks = /zk-stark/i.test(arbDeliv.content?.body || '');

  console.log('\n     📋 Arbitrator Evidence Analysis:');
  info('Required words', '500+');
  info('Actual words', arbWordCount);
  info('Has citations', hasCitations ? 'YES' : 'NO');
  info('Covers ZK-SNARKs', coversZkSnarks ? 'YES' : 'NO');
  info('Covers ZK-STARKs', coversZkStarks ? 'YES' : 'NO');
  console.log('     Ruling: REFUND_BUYER — deliverable fails 4/4 requirements');

  // Upload arbitration report to Filecoin
  const report = {
    type: 'arbitration_report',
    taskId,
    ruling: 'REFUND_BUYER',
    analysis: {
      wordCount: arbWordCount, requiredWords: 500,
      hasCitations, coversZkSnarks, coversZkStarks,
      requirementsMet: 0, requirementsTotal: 4
    },
    evidence: { taskSpecCID: specUpload.cid, deliverableCID: delivUpload.cid },
    arbitrator: arbAddr,
    resolvedAt: new Date().toISOString()
  };
  console.log('     Uploading arbitration report to Filecoin...');
  const reportUpload = await uploadEvidence(report);
  info('Arbitration Report CID', reportUpload.cid);

  // Resolve on-chain: ruling 0 = REFUND_BUYER
  console.log('     Submitting ruling on-chain...');
  const tx4 = await escrowArb.resolveDispute(taskId, 0).send({ feeLimit: 100000000 });
  await waitForConfirmation(arbTw, tx4);
  info('TRON TX', tx4);
  link('Explorer', tx4);

  ok('Dispute resolved. Buyer refunded. Reputation updated by Escrow.');

  // Print final state
  const finalTask = await getTaskOnChain(escrowBuyer, buyerTw, taskId);
  console.log('  📊 Final State:');
  info('Task State', finalTask.stateLabel);
  info('Ruling', 'REFUND_BUYER');
  info('Buyer refunded', 'YES');
  await printReputation(repGate, repGateTw, buyerAddr, 'Buyer reputation');
  const sellerRep = await printReputation(repGate, repGateTw, sellerAddr, 'Seller reputation');

  return { taskId, sellerRep };
}

// ============ Reputation Consequences ============

async function runReputationConsequences(buyerTw, sellerTw, repGate, repGateTw) {
  div('🔒 SCENARIO 3: Reputation Consequences — Low Rep = Harsher Terms');

  const sellerAddr = sellerTw.defaultAddress.base58;
  const buyerAddr = buyerTw.defaultAddress.base58;

  step(1, 'Checking current reputation scores');
  const buyerRep = await printReputation(repGate, repGateTw, buyerAddr, 'Buyer');
  const sellerRep = await printReputation(repGate, repGateTw, sellerAddr, 'Seller');

  step(2, 'Querying on-chain escrow terms based on reputation');

  const amount100TRX = buyerTw.toSun(100);
  const terms = await repGate.getSuggestedTerms(buyerAddr, sellerAddr, amount100TRX).call();
  const deposit = buyerTw.fromSun(terms.suggestedDeposit.toString());
  const reqArb = terms.requiresArbitration;

  console.log('\n     For a hypothetical 100 TRX task:');
  info('Required security deposit', `${deposit} TRX (${(deposit / 100 * 100).toFixed(0)}% of task value)`);
  info('Mandatory arbitration', reqArb ? 'YES — low-rep agents cannot skip arbitration' : 'NO');

  if (sellerRep < 500) {
    warn(`Seller's reputation (${sellerRep}) is below the Established threshold (500).`);
    console.log('     This means:');
    console.log('       • Higher collateral requirements on every new task');
    console.log('       • Mandatory arbitration (cannot opt out)');
    console.log('       • Buyers see a trust warning before engaging');
    console.log('       • Need to complete several clean tasks to rebuild reputation');
  } else {
    ok('Both agents have sufficient reputation for standard terms.');
  }

  // Show what terms would look like for a trusted agent
  step(3, 'Comparison: trusted vs untrusted escrow terms');

  console.log('     ┌──────────────────┬──────────────────┬──────────────────┐');
  console.log('     │                  │  Trusted (700+)  │  After Dispute   │');
  console.log('     ├──────────────────┼──────────────────┼──────────────────┤');
  console.log('     │ Security Deposit │       0 TRX      │    ' + deposit.toString().padStart(5) + ' TRX      │');
  console.log('     │ Arbitration      │     Optional     │    ' + (reqArb ? 'MANDATORY' : 'Optional ') + '    │');
  console.log('     │ Buyer Confidence │       High       │       Low        │');
  console.log('     └──────────────────┴──────────────────┴──────────────────┘');
}

// ============ Main ============

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  ██╗    ██╗██╗  ██╗██╗███████╗████████╗██╗     ███████╗           ║
║  ██║    ██║██║  ██║██║██╔════╝╚══██╔══╝██║     ██╔════╝           ║
║  ██║ █╗ ██║███████║██║███████╗   ██║   ██║     █████╗             ║
║  ██║███╗██║██╔══██║██║╚════██║   ██║   ██║     ██╔══╝             ║
║  ╚███╔███╔╝██║  ██║██║███████║   ██║   ███████╗███████╗           ║
║   ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝           ║
║                                                                  ║
║         Autonomous Escrow & Dispute Resolution for AI Agents     ║
║         TRON (Nile) × Filecoin (Calibration) × Synapse PDP      ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);

  // Initialize all TronWeb instances
  const buyerTw = createTronWeb(process.env.BUYER_PRIVATE_KEY, 'nile');
  const sellerTw = createTronWeb(process.env.SELLER_PRIVATE_KEY, 'nile');
  const arbTw = createTronWeb(process.env.ARBITRATOR_PRIVATE_KEY, 'nile');
  const ownerTw = createTronWeb(process.env.TRON_PRIVATE_KEY, 'nile');

  // Connect to contracts
  const escrowBuyer = await buyerTw.contract(ESCROW_ABI, process.env.ESCROW_ADDRESS);
  const escrowSeller = await sellerTw.contract(ESCROW_ABI, process.env.ESCROW_ADDRESS);
  const escrowArb = await arbTw.contract(ESCROW_ABI, process.env.ESCROW_ADDRESS);

  // RepGate — use owner (authorized updater) for reputation calls
  const repGate = await ownerTw.contract(REPGATE_ABI, process.env.REPUTATION_GATE_ADDRESS);

  div('📋 AGENT OVERVIEW');
  const buyerBal = await getBalance(buyerTw, buyerTw.defaultAddress.base58);
  const sellerBal = await getBalance(sellerTw, sellerTw.defaultAddress.base58);
  const arbBal = await getBalance(arbTw, arbTw.defaultAddress.base58);

  info('Buyer', `${buyerTw.defaultAddress.base58}  (${buyerBal} TRX)`);
  info('Seller', `${sellerTw.defaultAddress.base58}  (${sellerBal} TRX)`);
  info('Arbitrator', `${arbTw.defaultAddress.base58}  (${arbBal} TRX)`);
  info('Network', 'TRON Nile Testnet');
  info('Escrow Contract', process.env.ESCROW_ADDRESS);
  info('ReputationGate', process.env.REPUTATION_GATE_ADDRESS);

  // Check Filecoin status
  const filStatus = await getStatus();
  info('Filecoin', `${filStatus.provider} — ${filStatus.ready ? `Ready (${filStatus.balance})` : filStatus.message || 'Not ready'}`);

  const mode = process.argv[2] || 'both';

  try {
    if (mode === 'happy' || mode === 'both') {
      await runHappyPath(buyerTw, sellerTw, escrowBuyer, escrowSeller, repGate, ownerTw);
    }

    if (mode === 'dispute' || mode === 'both') {
      await sleep(3000);
      await runDisputePath(buyerTw, sellerTw, arbTw, escrowBuyer, escrowSeller, escrowArb, repGate, ownerTw);
    }

    if (mode === 'both') {
      await sleep(2000);
      await runReputationConsequences(buyerTw, sellerTw, repGate, ownerTw);
    }

    div('✅ DEMO COMPLETE');

    console.log('  Everything above is verifiable:');
    console.log(`  • TRON transactions → ${EXPLORER}`);
    console.log('  • Filecoin data → retrieval URLs from Synapse PDP providers');
    console.log('  • Reputation scores → on-chain in ReputationGate contract');
    console.log('');

  } catch (error) {
    console.error('\n  ❌ Demo error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Whistle Demo

Usage: node scripts/demo.js [mode]

Modes:
  happy     Happy path only (task → deliver → approve → pay)
  dispute   Dispute path only (task → bad delivery → dispute → arbitration → refund)
  both      Both paths + reputation consequences (default)

Requirements:
  - All agent private keys in .env
  - ESCROW_ADDRESS and REPUTATION_GATE_ADDRESS in .env
  - Buyer needs ~30 TRX, others need ~5 TRX for gas
  - FILECOIN_PRIVATE_KEY with USDFC for real Synapse storage
  `);
  process.exit(0);
}

main().catch(console.error);
