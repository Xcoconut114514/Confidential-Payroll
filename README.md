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
| **Zero-Knowledge Treasury** | Treasury balance is also encrypted |
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

Open http://localhost:5173 and update `CONTRACT_ADDRESS` in `frontend/src/App.tsx` with your deployed address.

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

# Output:
  ConfidentialPayroll
    ✓ deploys with correct employer and company name
    ✓ employer can add an employee
    ✓ cannot add same employee twice
    ✓ employer can update salary
    ✓ employer can remove an employee
    ✓ employer can deposit to treasury
    ✓ full payroll cycle: deposit → add → pay → check balances
    ✓ non-employee cannot view salary
    ✓ non-employee cannot view balance
    ✓ non-employer cannot execute payroll
    ✓ non-employer cannot deposit
    ✓ supports multiple pay cycles with accumulating balances
    ✓ employee can withdraw and balance resets
    14 passing
```

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
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat deploy --network sepolia
```

## 📄 License

MIT

---

Built for the [Zama Bounty Program](https://www.zama.ai/bounty-program) — Private smart contracts with Fully Homomorphic Encryption.
