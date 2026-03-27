/**
 * ArbiChain - Initial Migration
 * Deploys core contracts to TRON network
 */

const Migrations = artifacts.require('Migrations');
const Escrow = artifacts.require('Escrow');
const ReputationGate = artifacts.require('ReputationGate');

module.exports = async function (deployer, network, accounts) {
  console.log(`\n📦 Deploying ArbiChain contracts to ${network}...`);
  console.log(`Deployer address: ${accounts[0]}\n`);

  // Deploy migration tracking contract first (required by TronBox)
  await deployer.deploy(Migrations);

  // Deploy ReputationGate first
  console.log('1. Deploying ReputationGate...');
  await deployer.deploy(ReputationGate);
  const reputationGate = await ReputationGate.deployed();
  console.log(`   ReputationGate deployed at: ${reputationGate.address}`);

  // Deploy Escrow with deployer as initial arbitrator
  // In production, this should be a multi-sig or DAO address
  const arbitratorAddress = accounts[0];
  console.log(`\n2. Deploying Escrow with arbitrator: ${arbitratorAddress}...`);
  await deployer.deploy(Escrow, arbitratorAddress);
  const escrow = await Escrow.deployed();
  console.log(`   Escrow deployed at: ${escrow.address}`);

  // Authorize Escrow contract to update reputation
  console.log('\n3. Authorizing Escrow to update ReputationGate...');
  await reputationGate.setAuthorizedUpdater(escrow.address, true);
  console.log('   Authorization complete.');

  // Summary
  console.log('\n✅ Deployment complete!');
  console.log('─'.repeat(50));
  console.log('Contract Addresses:');
  console.log(`  ReputationGate: ${reputationGate.address}`);
  console.log(`  Escrow:         ${escrow.address}`);
  console.log(`  Arbitrator:     ${arbitratorAddress}`);
  console.log('─'.repeat(50));

  // Save addresses for reference
  console.log('\nAdd these to your .env file:');
  console.log(`REPUTATION_GATE_ADDRESS=${reputationGate.address}`);
  console.log(`ESCROW_ADDRESS=${escrow.address}`);
};
