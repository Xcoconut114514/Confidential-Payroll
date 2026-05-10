# 🔐 Confidential Payroll

> **Private on-chain payroll powered by Zama Fully Homomorphic Encryption (fhEVM)**

Confidential Payroll lets companies run payroll on-chain while keeping salary amounts completely encrypted. Only the employer and each individual employee can see their own salary — other employees, third parties, and even blockchain explorers see only encrypted ciphertext.

Built on the [FHEVM Hardhat Template](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial) by Zama.

## 🏗 Architecture

```
┌───────────────────────────────────────────────────┐
│                  Frontend (React)                 │
│    MetaMask → ethers.js → Contract Interaction    │
│         fhevmjs → Encrypt inputs in browser       │
└──────────────────────┬────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────┐
│          ConfidentialPayroll.sol (fhEVM)           │
│                                                   │
│  employer ──► deposit(encrypted amount)           │
│  employer ──► addEmployee(addr, encrypted salary) │
│  employer ──► executePay() [batch payroll]         │
│  employee ──► viewMySalary() → euint64            │
│  employee ──► withdraw()                          │
│                                                   │
│  All salary/balance values are euint64            │
│  (encrypted with FHE — never exposed on-chain)    │
└───────────────────────────────────────────────────┘
```

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **Encrypted Salaries** | Salary amounts stored as `euint64` — fully homomorphic encrypted |
| **Access Control** | Only employer + individual employee can decrypt each salary |
| **Batch Payroll** | One transaction pays all employees simultaneously |
| **Private Governance** | Board votes stay encrypted with the same FHE runtime |
| **Optional Compliance Mode** | Employers can require KYC flags and attestation commitments before payroll actions |
| **On-chain Privacy** | No salary data leaks to blockchain explorers or other employees |

## 🚀 Quick Start

### Prerequisites

- Node.js v20+
- MetaMask browser extension
- Git

### 1. Install dependencies

```bash
npm install
```

### 2. Compile contracts

```bash
npx hardhat compile
```

### 3. Run tests (mock FHE mode)

```bash
npx hardhat test
```

14+ tests covering employee management, payroll cycles, access control, and withdrawals.

### 4. Deploy locally

```bash
# Terminal 1: Start local node
npx hardhat node

# Terminal 2: Deploy
npx hardhat deploy --network localhost
```

### 5. Run frontend

```bash
cd frontend
npm install
npm run dev
```

Then create `frontend/.env` from `frontend/.env.example` and point it at your deployed contracts:

```bash
VITE_PAYROLL_CONTRACT_ADDRESS=0xYourPayrollAddress
VITE_GOV_CONTRACT_ADDRESS=0xYourGovernanceAddress
```

Open http://localhost:5173 with MetaMask or Rabby on the same network as the deployed contracts.

## 🌐 Connect to Sepolia + Zama testnet

This app does **not** require a special Zama wallet. You use a normal EVM wallet on **Ethereum Sepolia**, and the app talks to Zama's FHE relayer and gateway behind the scenes.

### 1. Prepare an EVM wallet

- Install MetaMask or Rabby.
- Create a wallet or use an existing one.
- Switch the wallet network to **Ethereum Sepolia**.
- Get some Sepolia ETH from a faucet so you can deploy and send test transactions.

### 2. Get an Infura RPC key

`INFURA_API_KEY` is your RPC project key. Hardhat uses it to send transactions to the Sepolia network through Infura.

How to get it:

1. Create an account on Infura.
2. Create a new project.
3. Enable the Ethereum Sepolia endpoint.
4. Copy the project API key.

### 3. Choose how Hardhat signs transactions

You only need **one** of these:

- `PRIVATE_KEY`: The raw private key for one wallet account. Best for deployment because it is explicit and limited to one address.
- `MNEMONIC`: The 12 or 24 word seed phrase for a wallet. Hardhat can derive many accounts from it, so it is broader and riskier.

Recommendation: use `PRIVATE_KEY` for deployment and keep `MNEMONIC` as a fallback only if you understand wallet derivation.

### 4. Store network credentials in Hardhat

```bash
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set PRIVATE_KEY
```

Optional, if you want contract verification later:

```bash
npx hardhat vars set ETHERSCAN_API_KEY
```

### 5. Deploy to Sepolia

```bash
npm run deploy:sepolia
```

The deploy script prints three addresses:

- `FHECounter`
- `ConfidentialPayroll`
- `ConfidentialGovernance`

### 6. Point the frontend at the deployed contracts

Create `frontend/.env`:

```bash
VITE_PAYROLL_CONTRACT_ADDRESS=0x...
VITE_GOV_CONTRACT_ADDRESS=0x...
```

Then run:

```bash
cd frontend
npm run dev
```

When the browser wallet is connected to Sepolia, the frontend uses the Zama relayer SDK to encrypt inputs in the browser and request user decryption when needed.

## 🔑 What these secrets actually are

### `INFURA_API_KEY`

- Not a wallet secret.
- It is an RPC access key.
- Think of it as your authenticated network gateway to Sepolia.

### `PRIVATE_KEY`

- The secret that controls one blockchain account.
- Anyone with it can move that account's funds and sign deployments.
- Export it from the specific wallet account you want Hardhat to use.

### `MNEMONIC`

- The wallet seed phrase.
- It can recreate many accounts, not just one.
- More convenient for HD wallets, but much more sensitive than a single private key.

Never commit any of these values to Git.

## 🧠 What is different about Zama vs a normal public chain?

Zama here is not replacing Ethereum consensus. The base chain is still **Ethereum Sepolia**. What changes is the computation model.

- Normal public smart contracts: contract state and inputs are visible in plaintext.
- Zama FHE contracts: sensitive inputs are encrypted before they reach the contract, and the contract computes on ciphertext.
- Normal privacy patterns: often prove something off-chain with ZK, then publish a proof on-chain.
- Zama FHE pattern: keep the data encrypted throughout the contract lifecycle and only decrypt to authorized users.

For this payroll app, that means the chain still gives you public ordering, settlement, and composability, while Zama adds a confidentiality layer for salaries, treasury balances, governance votes, and compliance checks.

## 📖 Contract API

### Employer Functions

| Function | Description |
|----------|-------------|
| `deposit(encAmount, proof)` | Add encrypted funds to treasury |
| `addEmployee(address, encSalary, proof)` | Register employee with encrypted salary |
| `updateSalary(address, encNewSalary, proof)` | Update employee's encrypted salary |
| `removeEmployee(address)` | Remove an employee |
| `executePay()` | Execute payroll for all employees |
| `resetPayCycle()` | Reset payment flags for new cycle |
| `viewTreasury()` | View encrypted treasury balance |

### Employee Functions

| Function | Description |
|----------|-------------|
| `viewMySalary()` | View own encrypted salary handle |
| `viewMyBalance()` | View own encrypted claimable balance |
| `withdraw()` | Withdraw accumulated balance |

## 🔒 Privacy Model

```
Public on-chain:          Encrypted on-chain:
├── Employee addresses    ├── Salary amounts (euint64)
├── # of employees        ├── Employee balances (euint64)
├── Pay cycle count       └── Treasury balance (euint64)
├── Paid status (bool)
└── Timestamps

Who can decrypt:
├── Employer → all salaries, all balances, treasury
├── Employee → own salary only, own balance only
└── Everyone else → sees only encrypted ciphertext
```

## 🧪 Tests

```bash
npx hardhat test
```

Current coverage includes payroll flow, confidential governance, and optional compliance gating for KYC and attestation commitments.

## 🛠 CLI Tasks

```bash
npx hardhat task:deposit --amount 100000 --network localhost
npx hardhat task:add-employee --employee 0xABC... --salary 5000 --network localhost
npx hardhat task:execute-pay --network localhost
npx hardhat task:employees --network localhost
npx hardhat task:view-salary --network localhost
npx hardhat task:view-balance --network localhost
npx hardhat task:view-treasury --network localhost
```

## 📁 Project Structure

```
confidential-payroll/
├── contracts/
│   └── ConfidentialPayroll.sol    # Core payroll contract (FHE)
├── test/
│   └── ConfidentialPayroll.ts     # 14 comprehensive tests
├── deploy/
│   └── deploy.ts                 # Deployment script
├── tasks/
│   └── ConfidentialPayroll.ts     # CLI tasks
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main React UI
│   │   ├── main.tsx              # Entry point
│   │   ├── index.css             # Styling
│   │   └── abi.json              # Contract ABI
│   └── package.json
├── hardhat.config.ts
└── README.md
```

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | Solidity 0.8.24 + @fhevm/solidity v0.11 |
| FHE Runtime | Zama fhEVM (TFHE coprocessor) |
| Testing | Hardhat + @fhevm/hardhat-plugin (mock mode) |
| Frontend | React 19 + TypeScript + Vite |
| Blockchain | ethers.js v6 |

## 🌐 Deploy to Sepolia

```bash
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set PRIVATE_KEY
npx hardhat deploy --network sepolia
```

## 📄 License

MIT

---

Built for the [Zama Bounty Program](https://www.zama.ai/bounty-program) — Private smart contracts with Fully Homomorphic Encryption.
