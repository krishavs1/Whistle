/**
 * Whistle - Initial Migration
 * Deploys all contracts: ReputationGate, Escrow, ArbiToken, ArbitratorPool
 */

const Migrations = artifacts.require('Migrations');
const Escrow = artifacts.require('Escrow');
const ReputationGate = artifacts.require('ReputationGate');
const ArbiToken = artifacts.require('ArbiToken');
const ArbitratorPool = artifacts.require('ArbitratorPool');

module.exports = async function (deployer, network, accounts) {
  console.log(`\n📦 Deploying Whistle contracts to ${network}...`);
  console.log(`Deployer address: ${accounts[0] || '(resolved from contract owner)'}\n`);

  await deployer.deploy(Migrations);

  // 1. ReputationGate
  console.log('1. Deploying ReputationGate...');
  await deployer.deploy(ReputationGate);
  const reputationGate = await ReputationGate.deployed();
  console.log(`   ReputationGate deployed at: ${reputationGate.address}`);

  // 2. ArbiToken (1 million initial supply to deployer)
  const initialSupply = '1000000000000000000000000'; // 1M * 1e18
  console.log('\n2. Deploying ArbiToken (1M ARBI)...');
  await deployer.deploy(ArbiToken, initialSupply);
  const arbiToken = await ArbiToken.deployed();
  console.log(`   ArbiToken deployed at: ${arbiToken.address}`);

  // 3. ArbitratorPool (min stake = 100 ARBI)
  const minStake = '100000000000000000000'; // 100 * 1e18
  console.log('\n3. Deploying ArbitratorPool...');
  await deployer.deploy(ArbitratorPool, arbiToken.address, minStake);
  const arbitratorPool = await ArbitratorPool.deployed();
  console.log(`   ArbitratorPool deployed at: ${arbitratorPool.address}`);

  // Wait for bandwidth to replenish before deploying the largest contract
  console.log('\n   Waiting 10s for bandwidth recovery...');
  await new Promise(r => setTimeout(r, 10000));

  // 4. Escrow (deployer as single-arb fallback, ReputationGate linked)
  const arbitratorAddress = (await reputationGate.owner.call());
  console.log(`4. Deploying Escrow (fallback arbitrator: ${arbitratorAddress})...`);
  await deployer.deploy(Escrow, arbitratorAddress, reputationGate.address);
  const escrow = await Escrow.deployed();
  console.log(`   Escrow deployed at: ${escrow.address}`);

  // 5. Wire contracts together
  console.log('\n5. Wiring contracts...');

  // Escrow authorized on ReputationGate
  await reputationGate.setAuthorizedUpdater(escrow.address, true);
  console.log('   ✓ Escrow authorized on ReputationGate');

  // Deployer authorized on ReputationGate (for manual calls in demo)
  await reputationGate.setAuthorizedUpdater(arbitratorAddress, true);
  console.log('   ✓ Deployer authorized on ReputationGate');

  // ArbitratorPool knows about Escrow
  await arbitratorPool.setEscrow(escrow.address);
  console.log('   ✓ ArbitratorPool linked to Escrow');

  // Escrow knows about ArbitratorPool
  await escrow.setArbitratorPool(arbitratorPool.address);
  console.log('   ✓ Escrow linked to ArbitratorPool');

  // ArbitratorPool is a minter on ArbiToken (for rewards)
  await arbiToken.setMinter(arbitratorPool.address, true);
  console.log('   ✓ ArbitratorPool authorized as ARBI minter');

  // Summary
  console.log('\n✅ Deployment complete!');
  console.log('─'.repeat(50));
  console.log('Contract Addresses:');
  console.log(`  ReputationGate:  ${reputationGate.address}`);
  console.log(`  ArbiToken:       ${arbiToken.address}`);
  console.log(`  ArbitratorPool:  ${arbitratorPool.address}`);
  console.log(`  Escrow:          ${escrow.address}`);
  console.log(`  Arbitrator:      ${arbitratorAddress}`);
  console.log('─'.repeat(50));

  console.log('\nAdd these to your .env file:');
  console.log(`REPUTATION_GATE_ADDRESS=${reputationGate.address}`);
  console.log(`ESCROW_ADDRESS=${escrow.address}`);
  console.log(`ARBI_TOKEN_ADDRESS=${arbiToken.address}`);
  console.log(`ARBITRATOR_POOL_ADDRESS=${arbitratorPool.address}`);
};
