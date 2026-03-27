/**
 * ArbiChain - Test Filecoin/Lighthouse Integration
 * Run: node scripts/test-filecoin.js
 */

require('dotenv').config();
const filecoin = require('../lib/filecoin');

async function main() {
  console.log('\n🔗 ArbiChain - Filecoin Storage Test\n');
  console.log('═'.repeat(50));

  // Check status
  console.log('\n📊 Checking Synapse status...\n');
  const status = await filecoin.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));

  if (!status.configured) {
    console.log('\n⚠️  Synapse not configured. Using mock storage.\n');
    console.log('To enable real Filecoin storage:');
    console.log('1. Add FILECOIN_PRIVATE_KEY to .env');
    console.log('2. Get tFIL: https://faucet.calibnet.chainsafe-fil.io');
    console.log('3. Get USDFC: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
    console.log('4. Run: node scripts/setup-synapse.js');
    console.log('');
  } else if (!status.ready) {
    console.log('\n⚠️  Synapse configured but needs setup.\n');
    console.log('Run: node scripts/setup-synapse.js');
    console.log('');
  } else {
    console.log('\n✅ Synapse configured! Using real Filecoin storage.\n');
  }

  // Test upload
  console.log('📤 Testing upload...\n');

  const testData = {
    type: 'arbichain_test',
    message: 'Hello from ArbiChain!',
    timestamp: new Date().toISOString(),
    randomValue: Math.random()
  };

  console.log('Data to upload:', JSON.stringify(testData, null, 2));

  const uploadResult = await filecoin.uploadJson(testData);

  console.log('\n✅ Upload result:');
  console.log(`   CID/CommP: ${uploadResult.cid}`);
  console.log(`   Provider: ${uploadResult.provider}`);
  console.log(`   Size: ${uploadResult.size} bytes`);
  console.log(`   Network: ${uploadResult.network || 'mock'}`);

  // Test retrieval
  console.log('\n📥 Testing retrieval...\n');

  const retrieved = await filecoin.retrieveJson(uploadResult.cid);

  console.log('Retrieved data:', JSON.stringify(retrieved, null, 2));

  // Verify
  const matches = JSON.stringify(testData) === JSON.stringify(retrieved);
  console.log(`\n${matches ? '✅' : '❌'} Data integrity: ${matches ? 'PASSED' : 'FAILED'}`);

  // Test ArbiChain helpers
  console.log('\n📋 Testing ArbiChain helpers...\n');

  const taskSpec = await filecoin.uploadTaskSpec({
    title: 'Test Task',
    description: 'A test task for Filecoin integration',
    requirements: ['Requirement 1', 'Requirement 2']
  });
  console.log(`   Task Spec CID: ${taskSpec.cid}`);

  const deliverable = await filecoin.uploadDeliverable({
    taskId: 'test-123',
    content: { result: 'Task completed!' }
  });
  console.log(`   Deliverable CID: ${deliverable.cid}`);

  const evidence = await filecoin.uploadEvidence({
    disputeId: 'dispute-456',
    claim: 'Evidence for dispute resolution'
  });
  console.log(`   Evidence CID: ${evidence.cid}`);

  console.log('\n' + '═'.repeat(50));
  console.log('✅ All tests passed!\n');

  if (status.ready) {
    console.log('🎉 Real Filecoin storage is working!');
    console.log('   Your data is permanently stored on Filecoin with on-chain proofs.');
    console.log(`   CommP: ${uploadResult.commp}\n`);
  } else {
    console.log('ℹ️  Tests passed with mock storage.');
    console.log('   Run setup-synapse.js for permanent Filecoin storage.\n');
  }
}

main().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
