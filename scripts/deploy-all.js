/**
 * Deploy all Whistle contracts with bandwidth-friendly pauses
 */
require('dotenv').config();
const TronWeb = require('tronweb');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build', 'contracts');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadAbi(name) {
  const data = JSON.parse(fs.readFileSync(path.join(BUILD, `${name}.json`), 'utf8'));
  return { abi: data.abi, bytecode: data.bytecode };
}

async function deploy(tw, name, constructorArgs = []) {
  const { abi, bytecode } = loadAbi(name);
  console.log(`  Deploying ${name}...`);

  const opts = {
    feeLimit: 1000000000,
    callValue: 0,
    userFeePercentage: 100,
    originEnergyLimit: 10000000,
    abi: abi,
    bytecode,
  };

  if (constructorArgs.length > 0) {
    opts.parameters = constructorArgs;
  }

  const tx = await tw.transactionBuilder.createSmartContract(opts, tw.defaultAddress.hex);

  const signed = await tw.trx.sign(tx);
  const result = await tw.trx.sendRawTransaction(signed);

  if (!result.result) {
    console.error(`  Deploy result:`, JSON.stringify(result, null, 2));
    throw new Error(`Deploy ${name} failed: ${result.code || 'unknown'} ${result.message || ''}`);
  }

  const txId = result.txid || result.transaction?.txID;
  console.log(`  TX: ${txId}`);

  // Wait for confirmation
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const info = await tw.trx.getTransactionInfo(txId);
      if (info && info.id) {
        const addr = info.contract_address;
        const base58 = tw.address.fromHex(addr);
        console.log(`  Address: ${base58} (${addr})`);
        return { address: addr, base58, txId };
      }
    } catch {}
  }
  throw new Error(`Deploy ${name} not confirmed in 90s`);
}

async function callContract(tw, contractAddr, fn, args, options = {}) {
  const tx = await tw.transactionBuilder.triggerSmartContract(
    contractAddr, fn, { feeLimit: 50000000, ...options }, args,
    tw.defaultAddress.hex
  );
  const signed = await tw.trx.sign(tx.transaction);
  const result = await tw.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error(`Call ${fn} failed: ${JSON.stringify(result)}`);
  // Wait
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    try {
      const info = await tw.trx.getTransactionInfo(result.txid);
      if (info && info.id) return info;
    } catch {}
  }
}

(async () => {
  const tw = new TronWeb({ fullHost: 'https://nile.trongrid.io', privateKey: process.env.TRON_PRIVATE_KEY });
  const deployer = tw.defaultAddress.base58;
  console.log(`\nDeployer: ${deployer}`);
  const bal = await tw.trx.getBalance(deployer);
  console.log(`Balance: ${bal / 1e6} TRX\n`);

  // 1. ReputationGate
  console.log('1. ReputationGate');
  const repGate = await deploy(tw, 'ReputationGate');
  await sleep(5000);

  // 2. ArbiToken (1M supply)
  console.log('\n2. ArbiToken');
  const initialSupply = '1000000000000000000000000'; // 1M * 1e18
  const arbiToken = await deploy(tw, 'ArbiToken', [initialSupply]);
  await sleep(5000);

  // 3. ArbitratorPool
  console.log('\n3. ArbitratorPool');
  const minStake = '100000000000000000000'; // 100 * 1e18
  const arbPool = await deploy(tw, 'ArbitratorPool', [
    tw.address.toHex(arbiToken.base58),
    minStake,
  ]);
  await sleep(5000);

  // 4. Escrow
  console.log('\n4. Escrow');
  const escrow = await deploy(tw, 'Escrow', [
    tw.defaultAddress.hex,
    repGate.address,
  ]);
  await sleep(5000);

  // 5. Wire contracts
  console.log('\n5. Wiring contracts...');

  // Authorize Escrow on ReputationGate
  console.log('  Authorizing Escrow on ReputationGate...');
  await callContract(tw, repGate.address, 'setAuthorizedUpdater(address,bool)',
    [{ type: 'address', value: escrow.address }, { type: 'bool', value: true }]);
  await sleep(3000);

  // Authorize deployer on ReputationGate
  console.log('  Authorizing deployer on ReputationGate...');
  await callContract(tw, repGate.address, 'setAuthorizedUpdater(address,bool)',
    [{ type: 'address', value: tw.defaultAddress.hex }, { type: 'bool', value: true }]);
  await sleep(3000);

  // ArbitratorPool → Escrow
  console.log('  Setting Escrow on ArbitratorPool...');
  await callContract(tw, arbPool.address, 'setEscrow(address)',
    [{ type: 'address', value: escrow.address }]);
  await sleep(3000);

  // Escrow → ArbitratorPool
  console.log('  Setting ArbitratorPool on Escrow...');
  await callContract(tw, escrow.address, 'setArbitratorPool(address)',
    [{ type: 'address', value: arbPool.address }]);
  await sleep(3000);

  // ArbitratorPool as minter on ArbiToken
  console.log('  Setting ArbitratorPool as ARBI minter...');
  await callContract(tw, arbiToken.address, 'setMinter(address,bool)',
    [{ type: 'address', value: arbPool.address }, { type: 'bool', value: true }]);

  console.log('\n✅ Deployment complete!');
  console.log('─'.repeat(50));
  console.log(`  ReputationGate:  ${repGate.base58}`);
  console.log(`  ArbiToken:       ${arbiToken.base58}`);
  console.log(`  ArbitratorPool:  ${arbPool.base58}`);
  console.log(`  Escrow:          ${escrow.base58}`);
  console.log('─'.repeat(50));
  console.log('\nAdd to .env:');
  console.log(`REPUTATION_GATE_ADDRESS=${repGate.base58}`);
  console.log(`ESCROW_ADDRESS=${escrow.base58}`);
  console.log(`ARBI_TOKEN_ADDRESS=${arbiToken.base58}`);
  console.log(`ARBITRATOR_POOL_ADDRESS=${arbPool.base58}`);
})().catch(e => { console.error('FATAL:', e.message || e); console.error(e); process.exit(1); });
