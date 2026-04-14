import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import ABI from './abi.json'
import { useFhevm } from './useFhevm'

// --- Config ---
const CONTRACT_ADDRESS = '0x6dF4438C80D908B450a214eEF2A8DAAC748936AE'

// Zama fhEVM runs on Sepolia
const ZAMA_NETWORK = {
  chainId: '0xaa36a7',      // 11155111
  chainName: 'Ethereum Sepolia (Zama fhEVM)',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

const LOCALHOST_NETWORK = {
  chainId: '0x7a69',        // 31337
  chainName: 'Hardhat Localhost',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['http://127.0.0.1:8545'],
  blockExplorerUrls: [],
}

// Detect if we're on localhost (use local network) or production (use Sepolia)
const TARGET_NETWORK = window.location.hostname === 'localhost' ? LOCALHOST_NETWORK : ZAMA_NETWORK

type Toast = { msg: string; type: 'success' | 'error' | 'info' }

// EIP-1193 provider type
type EIP1193Provider = {
  isMetaMask?: boolean
  isPhantom?: boolean
  isCoinbaseWallet?: boolean
  isBraveWallet?: boolean
  providers?: EIP1193Provider[]
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  removeAllListeners: (event: string) => void
}

type WalletOption = {
  id: string
  name: string
  icon: string
  provider: EIP1193Provider | null
  available: boolean
  description: string
}

function detectWallets(): WalletOption[] {
  const w = window as unknown as {
    ethereum?: EIP1193Provider
    phantom?: { ethereum?: EIP1193Provider }
    okxwallet?: EIP1193Provider
    bitkeep?: { ethereum?: EIP1193Provider }
    // Bitget Wallet newer injection key
    bitgetWalletProvider?: EIP1193Provider
  }

  const eth = w.ethereum

  // Collect all injected providers (EIP-5749 multi-wallet)
  const allProviders: EIP1193Provider[] = []
  if (eth?.providers && Array.isArray(eth.providers)) {
    allProviders.push(...eth.providers)
  } else if (eth) {
    allProviders.push(eth)
  }

  const findProvider = (predicate: (p: EIP1193Provider) => boolean) =>
    allProviders.find(predicate) ?? null

  // MetaMask: isMetaMask=true but not Phantom/Bitget/OKX
  const metamaskProvider = findProvider(
    p => !!p.isMetaMask && !p.isPhantom && !(p as unknown as { isOkxWallet?: boolean }).isOkxWallet
  )

  // Phantom EVM
  const phantomEvmProvider = w.phantom?.ethereum
    ?? findProvider(p => !!p.isPhantom)
    ?? null

  // OKX Wallet — injects at window.okxwallet
  const okxProvider = w.okxwallet
    ?? findProvider(p => !!(p as unknown as { isOkxWallet?: boolean }).isOkxWallet)
    ?? null

  // Bitget Wallet — injects at window.bitkeep.ethereum or window.bitgetWalletProvider
  const bitgetProvider = w.bitgetWalletProvider
    ?? w.bitkeep?.ethereum
    ?? findProvider(p => !!(p as unknown as { isBitKeep?: boolean; isBitget?: boolean }).isBitKeep
      || !!(p as unknown as { isBitget?: boolean }).isBitget)
    ?? null

  // Coinbase Wallet
  const coinbaseProvider = findProvider(p => !!p.isCoinbaseWallet)

  // Brave Wallet
  const braveProvider = findProvider(p => !!p.isBraveWallet)

  return [
    {
      id: 'metamask',
      name: 'MetaMask',
      icon: '🦊',
      provider: metamaskProvider,
      available: !!metamaskProvider,
      description: 'Most popular EVM wallet',
    },
    {
      id: 'okx',
      name: 'OKX Wallet',
      icon: '⭕',
      provider: okxProvider,
      available: !!okxProvider,
      description: 'OKX multi-chain wallet',
    },
    {
      id: 'bitget',
      name: 'Bitget Wallet',
      icon: '🅱',
      provider: bitgetProvider,
      available: !!bitgetProvider,
      description: 'Bitget Web3 wallet',
    },
    {
      id: 'phantom',
      name: 'Phantom (EVM)',
      icon: '👻',
      provider: phantomEvmProvider,
      available: !!phantomEvmProvider,
      description: 'Phantom Ethereum wallet',
    },
    {
      id: 'coinbase',
      name: 'Coinbase Wallet',
      icon: '🔵',
      provider: coinbaseProvider,
      available: !!coinbaseProvider,
      description: 'Coinbase self-custody wallet',
    },
    {
      id: 'brave',
      name: 'Brave Wallet',
      icon: '🦁',
      provider: braveProvider,
      available: !!braveProvider,
      description: 'Built-in Brave browser wallet',
    },
    {
      id: 'generic',
      name: 'Other Wallet',
      icon: '🌐',
      provider: eth ?? null,
      available: !!eth,
      description: 'Any other injected wallet',
    },
  ]
}

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [contract, setContract] = useState<ethers.Contract | null>(null)
  const [isEmployer, setIsEmployer] = useState(false)
  const [isEmployee, setIsEmployee] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [employees, setEmployees] = useState<string[]>([])
  const [paidStatus, setPaidStatus] = useState<Record<string, boolean>>({})
  const [cycleCount, setCycleCount] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [wallets, setWallets] = useState<WalletOption[]>([])
  const [networkName, setNetworkName] = useState('')

  // FHE SDK
  const { init: initFhevm, encryptUint64, userDecryptHandle } = useFhevm()
  const fhevmRef = useRef<import('@zama-fhe/relayer-sdk/web').FhevmInstance | null>(null)

  // Form state
  const [newEmpAddress, setNewEmpAddress] = useState('')
  const [newEmpSalary, setNewEmpSalary] = useState('')
  const [depositAmount, setDepositAmount] = useState('')

  // Salary/balance display values (decrypted)
  const [mySalary, setMySalary] = useState<bigint | null>(null)
  const [myBalance, setMyBalance] = useState<bigint | null>(null)

  const showToast = (msg: string, type: Toast['type'] = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const openWalletModal = () => {
    setWallets(detectWallets())
    setShowWalletModal(true)
  }

  // --- Switch / Add network ---
  const switchToTargetNetwork = async (rawProvider: EIP1193Provider) => {
    try {
      await rawProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET_NETWORK.chainId }],
      })
    } catch (err: unknown) {
      // 4902 = chain not added yet
      const code = (err as { code?: number })?.code
      if (code === 4902 || code === -32603) {
        await rawProvider.request({
          method: 'wallet_addEthereumChain',
          params: [TARGET_NETWORK],
        })
      } else {
        throw err
      }
    }
  }

  // --- Connect specific wallet ---
  const connectWallet = async (wallet: WalletOption) => {
    if (!wallet.provider) {
      showToast(`${wallet.name} not detected. Please install it.`, 'error')
      return
    }
    setShowWalletModal(false)
    setLoading('connect')
    try {
      // Request accounts
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[]

      // Switch to target network
      try {
        await switchToTargetNetwork(wallet.provider)
      } catch {
        showToast('Could not switch network automatically — please switch manually', 'error')
      }

      const prov = new ethers.BrowserProvider(wallet.provider as ethers.Eip1193Provider)
      const network = await prov.getNetwork()
      setNetworkName(network.name === 'unknown' ? `Chain ${network.chainId}` : network.name)
      setProvider(prov)
      setAccount(accounts[0])

      // Initialize FHE SDK after wallet connects (only on Sepolia)
      if (Number(network.chainId) === 11155111) {
        const fhevm = await initFhevm(prov)
        fhevmRef.current = fhevm
        if (fhevm) showToast('Wallet + FHE SDK ready!', 'success')
        else showToast('Wallet connected (FHE SDK failed to init)', 'info')
      } else {
        showToast('Wallet connected!', 'success')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  // --- Load Contract Data ---
  const loadContractData = useCallback(async () => {
    if (!provider || !account) return
    if ((CONTRACT_ADDRESS as string) === '0x0000000000000000000000000000000000000000') return

    try {
      const signer = await provider.getSigner()
      const c = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer)
      setContract(c)

      const [name, employer, empList, cycles] = await Promise.all([
        c.companyName(),
        c.employer(),
        c.getEmployees(),
        c.payrollCycleCount(),
      ])

      setCompanyName(name)
      setIsEmployer(employer.toLowerCase() === account.toLowerCase())
      setEmployees([...empList])
      setCycleCount(Number(cycles))

      // Check if current user is employee
      const isEmp = await c.isEmployee(account)
      setIsEmployee(isEmp)

      // Load paid status
      const statusMap: Record<string, boolean> = {}
      for (const emp of empList) {
        statusMap[emp] = await c.isPaidThisCycle(emp)
      }
      setPaidStatus(statusMap)
    } catch (err) {
      console.error('Failed to load contract data:', err)
    }
  }, [provider, account])

  useEffect(() => {
    loadContractData()
  }, [loadContractData])

  useEffect(() => {
    const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
    if (eth) {
      eth.on('accountsChanged', () => window.location.reload())
      eth.on('chainChanged', () => window.location.reload())
    }
  }, [])

  // --- Employer Actions ---
  const handleDeposit = async () => {
    if (!contract || !provider) return
    const amount = parseInt(depositAmount)
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return }

    setLoading('deposit')
    try {
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()

      let handle: string
      let inputProof: string

      if (fhevmRef.current) {
        // Real FHE encryption via Zama relayer
        const enc = await encryptUint64(fhevmRef.current, BigInt(amount), CONTRACT_ADDRESS, userAddress)
        handle = enc.handle
        inputProof = enc.inputProof
      } else {
        // Fallback mock (localhost only)
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [BigInt(amount), userAddress]))
        inputProof = '0x'
      }

      const tx = await contract.deposit(handle, inputProof)
      await tx.wait()
      showToast(`Deposited ${amount} to treasury`, 'success')
      setDepositAmount('')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 120), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleAddEmployee = async () => {
    if (!contract || !provider) return
    if (!ethers.isAddress(newEmpAddress)) { showToast('Invalid address', 'error'); return }
    const salary = parseInt(newEmpSalary)
    if (!salary || salary <= 0) { showToast('Enter a valid salary', 'error'); return }

    setLoading('addEmployee')
    try {
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()

      let handle: string
      let inputProof: string

      if (fhevmRef.current) {
        const enc = await encryptUint64(fhevmRef.current, BigInt(salary), CONTRACT_ADDRESS, userAddress)
        handle = enc.handle
        inputProof = enc.inputProof
      } else {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [BigInt(salary), userAddress]))
        inputProof = '0x'
      }

      const tx = await contract.addEmployee(newEmpAddress, handle, inputProof)
      await tx.wait()
      showToast('Employee added!', 'success')
      setNewEmpAddress('')
      setNewEmpSalary('')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 120), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleRemoveEmployee = async (addr: string) => {
    if (!contract) return
    setLoading('remove')
    try {
      const tx = await contract.removeEmployee(addr)
      await tx.wait()
      showToast('Employee removed', 'success')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleExecutePay = async () => {
    if (!contract) return
    setLoading('pay')
    try {
      const tx = await contract.executePay()
      await tx.wait()
      showToast('Payroll executed!', 'success')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleResetCycle = async () => {
    if (!contract) return
    setLoading('reset')
    try {
      const tx = await contract.resetPayCycle()
      await tx.wait()
      showToast('Pay cycle reset', 'success')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  // --- Employee Actions ---
  const handleViewSalary = async () => {
    if (!contract || !provider) return
    setLoading('viewSalary')
    try {
      const encSalaryHandle = await contract.viewMySalary()
      const handleHex = ethers.hexlify(encSalaryHandle)

      if (fhevmRef.current) {
        showToast('Requesting decryption — please sign the MetaMask prompt...', 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, CONTRACT_ADDRESS, signer)
        setMySalary(value)
        showToast(`Your salary: ${value.toString()}`, 'success')
      } else {
        showToast(`Encrypted handle: ${handleHex.slice(0, 20)}... (FHE SDK not available)`, 'info')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Decryption failed'
      showToast(msg.slice(0, 120), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleViewBalance = async () => {
    if (!contract || !provider) return
    setLoading('viewBalance')
    try {
      const encBalanceHandle = await contract.viewMyBalance()
      const handleHex = ethers.hexlify(encBalanceHandle)

      if (fhevmRef.current) {
        showToast('Requesting decryption — please sign the MetaMask prompt...', 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, CONTRACT_ADDRESS, signer)
        setMyBalance(value)
        showToast(`Your balance: ${value.toString()}`, 'success')
      } else {
        showToast(`Encrypted handle: ${handleHex.slice(0, 20)}... (FHE SDK not available)`, 'info')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Decryption failed'
      showToast(msg.slice(0, 120), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleWithdraw = async () => {
    if (!contract) return
    setLoading('withdraw')
    try {
      const tx = await contract.withdraw()
      await tx.wait()
      showToast('Withdrawal successful!', 'success')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  // --- Wallet Selection Modal ---
  const WalletModal = () => (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
      }}
      onClick={() => setShowWalletModal(false)}
    >
      <div
        style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: '16px', padding: '2rem', minWidth: '340px', maxWidth: '400px'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '0.5rem', fontSize: '1.2rem' }}>Connect Wallet</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          After connecting, you'll be switched to{' '}
          <strong style={{ color: 'var(--accent)' }}>
            {TARGET_NETWORK.chainName}
          </strong>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {wallets.map(w => (
            <button
              key={w.id}
              onClick={() => w.available && connectWallet(w)}
              style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                padding: '0.9rem 1rem', borderRadius: '10px',
                background: w.available ? 'var(--bg)' : 'transparent',
                border: `1px solid ${w.available ? 'var(--border)' : 'transparent'}`,
                color: w.available ? 'var(--text)' : 'var(--text-dim)',
                cursor: w.available ? 'pointer' : 'not-allowed',
                opacity: w.available ? 1 : 0.4,
                textAlign: 'left', width: '100%',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => { if (w.available) (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { if (w.available) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
            >
              <span style={{ fontSize: '1.8rem' }}>{w.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{w.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  {w.available ? w.description : 'Not installed'}
                </div>
              </div>
              {w.available && (
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--success)' }}>Detected</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // --- Not Connected ---
  if (!account) {
    return (
      <div className="app">
        <div className="header">
          <h1>🔐 Confidential Payroll</h1>
          <p>Private salary payments powered by Zama FHE</p>
        </div>

        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>💼</div>
          <h2 style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
            On-chain payroll with encrypted salaries
          </h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: '500px', margin: '0 auto 2rem' }}>
            Salary amounts are encrypted end-to-end using Fully Homomorphic Encryption.
            Only the employer and each employee can see their own salary.
          </p>

          <div className="connect-btn">
            <button className="btn btn-primary" onClick={openWalletModal} disabled={loading === 'connect'}>
              {loading === 'connect'
                ? <><span className="loading"></span>Connecting...</>
                : '🔗 Connect Wallet'}
            </button>
          </div>
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Supports MetaMask, Phantom, Coinbase Wallet and more
          </p>
        </div>

        <div className="card">
          <h2>How it works</h2>
          <div className="info-row">
            <span className="info-label">1. Employer deposits funds</span>
            <span className="badge badge-encrypted">🔒 Encrypted</span>
          </div>
          <div className="info-row">
            <span className="info-label">2. Employer adds employees with salaries</span>
            <span className="badge badge-encrypted">🔒 Encrypted</span>
          </div>
          <div className="info-row">
            <span className="info-label">3. Execute payroll — amounts stay encrypted</span>
            <span className="badge badge-encrypted">🔒 Encrypted</span>
          </div>
          <div className="info-row">
            <span className="info-label">4. Only each employee can decrypt their own salary</span>
            <span className="badge badge-employee">✓ Private</span>
          </div>
        </div>

        {showWalletModal && <WalletModal />}
      </div>
    )
  }

  const notConfigured = (CONTRACT_ADDRESS as string) === '0x0000000000000000000000000000000000000000'

  // --- Connected ---
  return (
    <div className="app">
      <div className="header">
        <h1>🔐 Confidential Payroll</h1>
        <p>
          {companyName || 'Zama FHE-powered private payroll'}
          {isEmployer && <span className="badge badge-employer">Employer</span>}
          {isEmployee && <span className="badge badge-employee">Employee</span>}
        </p>
      </div>

      {/* Network Bar */}
      <div className="network-bar">
        <div>
          <span className="network-dot"></span>
          Connected: {shortAddr(account)}
        </div>
        <div style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>
          {networkName || TARGET_NETWORK.chainName} • Cycle #{cycleCount} • {employees.length} employees
        </div>
      </div>

      {notConfigured && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <h2>⚠️ Contract Not Configured</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            Update <code>CONTRACT_ADDRESS</code> in <code>frontend/src/App.tsx</code> with your deployed contract address.
            <br />
            Deploy with: <code>npx hardhat --network localhost deploy</code>
          </p>
        </div>
      )}

      {/* Employer Dashboard */}
      {isEmployer && (
        <>
          {/* Deposit */}
          <div className="card">
            <h2>💰 Treasury</h2>
            <div className="info-row">
              <span className="info-label">Treasury Balance</span>
              <span className="encrypted-value">🔒 Encrypted</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <input
                type="number"
                placeholder="Amount"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{
                  flex: 1, padding: '0.6rem', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)'
                }}
              />
              <button className="btn btn-primary" onClick={handleDeposit} disabled={loading === 'deposit'}>
                {loading === 'deposit' ? <><span className="loading"></span>Depositing...</> : 'Deposit'}
              </button>
            </div>
          </div>

          {/* Add Employee */}
          <div className="card">
            <h2>👤 Add Employee</h2>
            <div className="input-group">
              <label>Employee Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={newEmpAddress}
                onChange={e => setNewEmpAddress(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Monthly Salary (encrypted on-chain)</label>
              <input
                type="number"
                placeholder="5000"
                value={newEmpSalary}
                onChange={e => setNewEmpSalary(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={handleAddEmployee} disabled={loading === 'addEmployee'}>
              {loading === 'addEmployee' ? <><span className="loading"></span>Adding...</> : 'Add Employee'}
            </button>
          </div>

          {/* Employee List */}
          <div className="card">
            <h2>📋 Employee List</h2>
            {employees.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem' }}>No employees yet</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Salary</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp}>
                      <td>{shortAddr(emp)}</td>
                      <td><span className="encrypted-value">🔒 Encrypted</span></td>
                      <td>
                        <span className={`status-dot ${paidStatus[emp] ? 'paid' : 'unpaid'}`}></span>
                        {paidStatus[emp] ? 'Paid' : 'Unpaid'}
                      </td>
                      <td>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                          onClick={() => handleRemoveEmployee(emp)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="actions">
              <button className="btn btn-success" onClick={handleExecutePay} disabled={loading === 'pay' || employees.length === 0}>
                {loading === 'pay' ? <><span className="loading"></span>Processing...</> : '💸 Execute Payroll'}
              </button>
              <button className="btn btn-outline" onClick={handleResetCycle} disabled={loading === 'reset'}>
                🔄 Reset Cycle
              </button>
            </div>
          </div>
        </>
      )}

      {/* Employee Dashboard */}
      {isEmployee && (
        <div className="card">
          <h2>🧑‍💼 My Payroll</h2>

          <div className="info-row">
            <span className="info-label">My Salary</span>
            {mySalary !== null
              ? <span className="info-value">{mySalary.toString()} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>units</span></span>
              : <span className="encrypted-value">🔒 Click below to decrypt</span>}
          </div>
          <div className="info-row">
            <span className="info-label">My Balance</span>
            {myBalance !== null
              ? <span className="info-value">{myBalance.toString()} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>units</span></span>
              : <span className="encrypted-value">🔒 Click below to decrypt</span>}
          </div>
          <div className="info-row">
            <span className="info-label">This Cycle</span>
            <span>{paidStatus[account] ? '✅ Paid' : '⏳ Pending'}</span>
          </div>
          {!fhevmRef.current && (
            <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              ⚠️ FHE SDK not ready — connect on Sepolia to decrypt values
            </p>
          )}

          <div className="actions">
            <button className="btn btn-primary" onClick={handleViewSalary} disabled={loading === 'viewSalary'}>
              {loading === 'viewSalary' ? <><span className="loading"></span>Decrypting...</> : '🔓 Decrypt Salary'}
            </button>
            <button className="btn btn-outline" onClick={handleViewBalance} disabled={loading === 'viewBalance'}>
              {loading === 'viewBalance' ? <><span className="loading"></span>Decrypting...</> : '💰 Decrypt Balance'}
            </button>
            <button className="btn btn-success" onClick={handleWithdraw} disabled={loading === 'withdraw'}>
              {loading === 'withdraw' ? <><span className="loading"></span></> : '📤 Withdraw'}
            </button>
          </div>
        </div>
      )}

      {/* Not employer or employee */}
      {!isEmployer && !isEmployee && !notConfigured && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="lock-icon">🔒</div>
          <h2 style={{ justifyContent: 'center' }}>Access Restricted</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            You are neither the employer nor an employee of this payroll contract.
            <br />
            All salary data is encrypted — you cannot view any financial information.
          </p>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {showWalletModal && <WalletModal />}
    </div>
  )
}

export default App
