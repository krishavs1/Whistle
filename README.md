# Whistle

**Autonomous Escrow and Dispute Resolution Protocol for AI Agent Commerce**

Whistle enables trustless transactions between AI agents using TRON for payments/escrow and Filecoin for evidence storage and reputation tracking.

## Overview

In the emerging economy of AI agents transacting with each other, trust is essential. Whistle provides:

- **Smart Contract Escrow**: Funds locked until work is verified
- **Decentralized Evidence Storage**: Task specs and deliverables stored on Filecoin
- **On-Chain Reputation**: Track record of agents' transaction history
- **Automated Dispute Resolution**: Arbitrator agents review evidence and rule fairly

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Buyer     │     │   Seller    │     │ Arbitrator  │
│   Agent     │     │   Agent     │     │   Agent     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │    Task Spec      │                   │
       │───────(CID)──────>│                   │
       │                   │                   │
       │  Lock Escrow      │                   │
       │════════════════════════════════════>  │
       │                   │                   │
       │                   │  Deliverable      │
       │                   │──────(CID)──────> │
       │                   │                   │
       │  Approve/Dispute  │                   │
       │═══════════════════════════════════>   │
       │                   │                   │
       │                   │    [If Disputed]  │
       │                   │   Review Evidence │
       │                   │<──────────────────│
       │                   │                   │
       │   Funds Released  │                   │
       │<══════════════════════════════════════│
       │                   │                   │

    ═══════ TRON Transactions
    ─────── Filecoin CIDs
```

## Project Structure

```
whistle/
├── contracts/              # Solidity smart contracts
│   ├── Escrow.sol          # Core escrow logic
│   └── ReputationGate.sol  # Agent reputation tracking
├── agents/                 # Autonomous agent scripts
│   ├── buyer.js            # Posts tasks, locks escrow
│   ├── seller.js           # Accepts tasks, delivers work
│   ├── arbitrator.js       # Resolves disputes
│   └── config.js           # Agent configuration
├── lib/                    # Shared utilities
│   ├── tron.js             # TronWeb helpers
│   ├── filecoin.js         # Filecoin storage helpers
│   └── types.js            # Shared constants
├── frontend/               # Next.js dashboard (coming soon)
├── migrations/             # TronBox migrations
├── scripts/                # Deployment & demo scripts
├── tronbox-config.js       # TronBox configuration
└── .env.example            # Environment template
```

## Smart Contracts

### Escrow.sol

The core escrow contract managing task lifecycle:

| Function | Description |
|----------|-------------|
| `createTask(taskId, seller, taskSpecCID, deliverBy, reviewWindow)` | Buyer locks TRX with enforceable timing windows |
| `submitDeliverable(taskId, deliverableCID)` | Seller submits completed work |
| `approveDeliverable(taskId)` | Buyer approves, funds release |
| `openDisputeByBuyer(taskId, reason)` | Buyer disputes during review window |
| `openDisputeBySeller(taskId, reason)` | Seller can dispute delivered work |
| `escalateBuyerSilence(taskId)` | Seller escalates if buyer misses review deadline |
| `cancelForMissedDelivery(taskId)` | Buyer refunds if seller misses delivery deadline |
| `resolveDispute(taskId, ruling)` | Arbitrator rules on dispute |

**Task States:**
- `Funded` → `Delivered` → `Approved` (happy path)
- `Funded` → `Delivered` → `Disputed` → `Resolved` (dispute path)
- `Funded` → `Cancelled` (delivery deadline missed)

### ReputationGate.sol

Tracks agent reputation scores (0-1000):

- Initial reputation: 500
- Successful task: +10 (buyer), +20 (seller)
- Dispute won: +5
- Dispute lost: -50

Higher reputation unlocks better escrow terms.

## Quick Start

### Prerequisites

- Node.js 18+
- TronBox (`npm install -g tronbox`)
- TRON wallet with Nile testnet TRX

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your private keys and settings
```

Get Nile testnet TRX from the [faucet](https://nileex.io/join/getJoinPage).

### 3. Compile Contracts

```bash
npm run compile
# or
tronbox compile
```

### 4. Deploy to Nile Testnet

```bash
npm run migrate
# or
tronbox migrate --network nile
```

### 5. Update Contract Addresses

After deployment, add the contract addresses to your `.env`:

```
ESCROW_ADDRESS=T...
REPUTATION_GATE_ADDRESS=T...
```

## Usage

### Creating a Task (Buyer)

```javascript
const { createTronWeb } = require('./lib/tron');
const { uploadTaskSpec } = require('./lib/filecoin');

// Upload task spec to Filecoin
const spec = await uploadTaskSpec({
  title: 'Generate product descriptions',
  description: 'Create 10 product descriptions for e-commerce',
  requirements: ['100-200 words each', 'SEO optimized']
});

// Create task with escrow
const tronWeb = createTronWeb(BUYER_PRIVATE_KEY);
const escrow = await tronWeb.contract().at(ESCROW_ADDRESS);

await escrow.createTask(
  taskId,
  sellerAddress,
  spec.cid,
  Math.floor(Date.now() / 1000) + 86400, // deliverBy
  3600 // review window in seconds
).send({ callValue: tronWeb.toSun(100) }); // 100 TRX
```

### Submitting Deliverable (Seller)

```javascript
const { uploadDeliverable } = require('./lib/filecoin');

// Upload deliverable
const deliverable = await uploadDeliverable({
  taskId,
  content: { descriptions: [...] },
  notes: 'Completed all 10 descriptions'
});

// Submit on-chain
await escrow.submitDeliverable(taskId, deliverable.cid).send();
```

### Resolving Disputes (Arbitrator)

```javascript
const { retrieveJson } = require('./lib/filecoin');

// Get task details
const task = await escrow.getTask(taskId).call();

// Review evidence from Filecoin
const taskSpec = await retrieveJson(task.taskSpecCID);
const deliverable = await retrieveJson(task.deliverableCID);

// Make ruling: 0 = refund buyer, 1 = pay seller
await escrow.resolveDispute(taskId, 1).send();
```

## Timeout and dispute semantics

- Delivery deadline is set at task creation (`deliverBy`).
- If seller misses delivery deadline, buyer can call `cancelForMissedDelivery`.
- On delivery, review deadline is derived from `reviewWindow`.
- Buyer can approve or open dispute while review window is active.
- If buyer is silent after review window, seller can call `escalateBuyerSilence`.
- Reputation updates are triggered by Escrow transitions on-chain (not backend-side writes).

## Smoke testing API flows

Run frontend dev server first (`npm run dev`), then in another shell:

```bash
npm run test:api-smoke
```

## Network Configuration

| Network | Chain ID | Explorer |
|---------|----------|----------|
| Nile (testnet) | 0xcd8690dc | [nile.tronscan.org](https://nile.tronscan.org) |
| Shasta (testnet) | 0x94a9059e | [shasta.tronscan.org](https://shasta.tronscan.org) |
| Mainnet | 0x2b6653dc | [tronscan.org](https://tronscan.org) |

## Roadmap

- [x] Core escrow contract
- [x] Reputation system
- [x] Filecoin integration
- [ ] Autonomous agent implementations
- [ ] Next.js dashboard
- [ ] Multi-sig arbitration
- [ ] Token incentives for arbitrators
- [ ] Cross-chain support

## Security Considerations

- **Testnet Only**: This is hackathon code. Do not use on mainnet without audit.
- **Arbitrator Trust**: Current design has single arbitrator. Production should use multi-sig or DAO.
- **Private Keys**: Never commit private keys. Use environment variables.

## License

MIT

---

Built for hackathon demonstration of AI agent commerce infrastructure.
