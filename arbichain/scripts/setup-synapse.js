/**
 * ArbiChain - Synapse Payment Setup
 * Run this ONCE after getting USDFC from faucet
 *
 * Steps:
 * 1. Get tFIL: https://faucet.calibnet.chainsafe-fil.io
 * 2. Get USDFC: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc
 * 3. Run: node scripts/setup-synapse.js
 */

require('dotenv').config();
const { setupPayments } = require('../lib/filecoin');

async function main() {
  console.log('\n🔧 ArbiChain - Synapse Payment Setup\n');
  console.log('═'.repeat(50));

  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    console.log('\n❌ FILECOIN_PRIVATE_KEY not set in .env');
    console.log('   Add your Filecoin private key (with 0x prefix)');
    process.exit(1);
  }

  console.log('\nThis will:');
  console.log('  1. Check your USDFC balance');
  console.log('  2. Deposit 2.5 USDFC to Synapse payments');
  console.log('  3. Approve the Warm Storage service');
  console.log('');

  try {
    const success = await setupPayments('2.5');

    if (success) {
      console.log('\n═'.repeat(50));
      console.log('✅ Setup complete! Now run:');
      console.log('   node scripts/test-filecoin.js');
      console.log('   node scripts/demo.js');
    }
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
