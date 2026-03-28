/**
 * Whistle - TronBox Configuration
 * Configuration for deploying contracts to TRON networks
 *
 * Networks:
 * - development: Local tron-quickstart
 * - nile: Nile testnet (primary testnet)
 * - shasta: Shasta testnet (alternative)
 * - mainnet: TRON mainnet (production)
 */

require('dotenv').config();
const path = require('path');

// Get private key from environment
const privateKey = process.env.TRON_PRIVATE_KEY || '';

// Validate private key format
if (privateKey && !privateKey.match(/^[a-fA-F0-9]{64}$/)) {
  console.warn('Warning: TRON_PRIVATE_KEY should be a 64-character hex string');
}

module.exports = {
  networks: {
    // Local development network (tron-quickstart)
    development: {
      privateKey: privateKey || 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0',
      userFeePercentage: 100,
      feeLimit: 1000000000,
      fullHost: 'http://127.0.0.1:9090',
      network_id: '*'
    },

    // Nile Testnet (primary testnet for development)
    nile: {
      privateKey: privateKey,
      userFeePercentage: 100,
      feeLimit: 1000000000, // 1000 TRX fee limit
      fullHost: 'https://nile.trongrid.io',
      network_id: '*'
    },

    // Shasta Testnet (alternative testnet)
    shasta: {
      privateKey: privateKey,
      userFeePercentage: 100,
      feeLimit: 1000000000,
      fullHost: 'https://api.shasta.trongrid.io',
      network_id: '*'
    },

    // TRON Mainnet (production - use with caution)
    mainnet: {
      privateKey: privateKey,
      userFeePercentage: 100,
      feeLimit: 1000000000,
      fullHost: 'https://api.trongrid.io',
      network_id: '*'
    }
  },

  // Compiler configuration
  compilers: {
    solc: {
      version: '0.8.20',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        viaIR: true,
        evmVersion: 'london'
      }
    }
  },

  // Solidity source directory
  contracts_directory: path.join(__dirname, 'contracts'),

  // Build output directory
  contracts_build_directory: path.join(__dirname, 'build/contracts'),

  // Migrations directory
  migrations_directory: path.join(__dirname, 'migrations')
};
