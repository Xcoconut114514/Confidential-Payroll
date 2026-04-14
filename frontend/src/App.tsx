import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import ABI from './abi.json'
import { BYTECODE } from './bytecode'
import { useFhevm } from './useFhevm'

// localStorage key for last-used contract address
const LS_CONTRACT_KEY = 'cpayroll_contract_v1'

// Zama fhEVM runs on Sepolia
const ZAMA_NETWORK = {
  chainId: '0xaa36a7',
  chainName: 'Ethereum Sepolia (Zama fhEVM)',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

const LOCALHOST_NETWORK = {
  chainId: '0x7a69',
  chainName: 'Hardhat Localhost',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['http://127.0.0.1:8545'],
  blockExplorerUrls: [],
}

const TARGET_NETWORK = window.location.hostname === 'localhost' ? LOCALHOST_NETWORK : ZAMA_NETWORK

type Toast = { msg: string; type: 'success' | 'error' | 'info' }

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
    bitgetWalletProvider?: EIP1193Provider
  }
  const eth = w.ethereum
  const allProviders: EIP1193Provider[] = []
  if (eth?.providers && Array.isArray(eth.providers)) {
    allProviders.push(...eth.providers)
  } else if (eth) {
    allProviders.push(eth)
  }
  const find = (pred: (p: EIP1193Provider) => boolean) => allProviders.find(pred) ?? null
  const metamask = find(p => !!p.isMetaMask && !p.isPhantom && !(p as unknown as { isOkxWallet?: boolean }).isOkxWallet)
  const phantom = w.phantom?.ethereum ?? find(p => !!p.isPhantom) ?? null
  const okx = w.okxwallet ?? find(p => !!(p as unknown as { isOkxWallet?: boolean }).isOkxWallet) ?? null
  const bitget = w.bitgetWalletProvider ?? w.bitkeep?.ethereum ?? find(p => !!(p as unknown as { isBitKeep?: boolean }).isBitKeep || !!(p as unknown as { isBitget?: boolean }).isBitget) ?? null
  const coinbase = find(p => !!p.isCoinbaseWallet)
  const brave = find(p => !!p.isBraveWallet)
  return [
    { id: 'metamask', name: 'MetaMask', icon: '🦊', provider: metamask, available: !!metamask, description: 'Most popular EVM wallet' },
    { id: 'okx', name: 'OKX Wallet', icon: '⭕', provider: okx, available: !!okx, description: 'OKX multi-chain wallet' },
    { id: 'bitget', name: 'Bitget Wallet', icon: '🅱', provider: bitget, available: !!bitget, description: 'Bitget Web3 wallet' },
    { id: 'phantom', name: 'Phantom (EVM)', icon: '👻', provider: phantom, available: !!phantom, description: 'Phantom Ethereum wallet' },
    { id: 'coinbase', name: 'Coinbase Wallet', icon: '🔵', provider: coinbase, available: !!coinbase, description: 'Coinbase self-custody wallet' },
    { id: 'brave', name: 'Brave Wallet', icon: '🦁', provider: brave, available: !!brave, description: 'Built-in Brave browser wallet' },
    { id: 'generic', name: 'Other Wallet', icon: '🌐', provider: eth ?? null, available: !!eth, description: 'Any other injected wallet' },
  ]
}

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [contract, setContract] = useState<ethers.Contract | null>(null)
  const [contractAddress, setContractAddress] = useState<string>(() => localStorage.getItem(LS_CONTRACT_KEY) || '')
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
  const activeProviderRef = useRef<EIP1193Provider | null>(null)

  // Setup flow state
  const [showSetup, setShowSetup] = useState(false)
  const [setupMode, setSetupMode] = useState<'choose' | 'deploy' | 'existing'>('choose')
  const [deployCompanyName, setDeployCompanyName] = useState('')
  const [existingAddrInput, setExistingAddrInput] = useState('')

  // FHE SDK
  const { init: initFhevm, encryptUint64, userDecryptHandle } = useFhevm()
  const fhevmRef = useRef<import('@zama-fhe/relayer-sdk/web').FhevmInstance | null>(null)

  // Form state
  const [newEmpAddress, setNewEmpAddress] = useState('')
  const [newEmpSalary, setNewEmpSalary] = useState('')
  const [depositAmount, setDepositAmount] = useState('')
  const [mySalary, setMySalary] = useState<bigint | null>(null)
  const [myBalance, setMyBalance] = useState<bigint | null>(null)

  const showToast = (msg: string, type: Toast['type'] = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const openWalletModal = () => { setWallets(detectWallets()); setShowWalletModal(true) }

  const switchToTargetNetwork = async (raw: EIP1193Provider) => {
    try {
      await raw.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: TARGET_NETWORK.chainId }] })
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code
      if (code === 4902 || code === -32603) {
        await raw.request({ method: 'wallet_addEthereumChain', params: [TARGET_NETWORK] })
      } else { throw err }
    }
  }

  const handleDisconnect = () => {
    if (activeProviderRef.current) {
      // Fire-and-forget: do NOT await — some wallets hang on unsupported methods
      activeProviderRef.current.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      }).catch(() => {})
      try { activeProviderRef.current.removeAllListeners('accountsChanged') } catch { /* ignore */ }
      try { activeProviderRef.current.removeAllListeners('chainChanged') } catch { /* ignore */ }
      activeProviderRef.current = null
    }
    setAccount(null)
    setProvider(null)
    setContract(null)
    setIsEmployer(false)
    setIsEmployee(false)
    setCompanyName('')
    setEmployees([])
    fhevmRef.current = null
    setNetworkName('')
    setMySalary(null)
    setMyBalance(null)
    openWalletModal()
  }

  const connectWallet = async (wallet: WalletOption) => {
    if (!wallet.provider) { showToast(wallet.name + ' not detected. Please install it.', 'error'); return }
    setShowWalletModal(false)
    setLoading('connect')
    try {
      let accounts: string[]

      // wallet_requestPermissions forces the wallet to pop up its account
      // picker UI. Most wallets (MetaMask, OKX, Coinbase) support this.
      // We await without timeout — the user needs time to pick an account.
      try {
        await wallet.provider.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        })
        // Read whichever account the user just selected
        accounts = await wallet.provider.request({ method: 'eth_accounts' }) as string[]
        if (!accounts || accounts.length === 0) {
          accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[]
        }
      } catch (permErr: unknown) {
        if ((permErr as { code?: number })?.code === 4001) {
          showToast('Connection cancelled', 'info')
          setLoading(null)
          return
        }
        // Method truly not supported — fall back to basic connect
        accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[]
      }

      if (!accounts || accounts.length === 0) {
        showToast('No accounts returned from wallet', 'error')
        setLoading(null)
        return
      }
      try { await switchToTargetNetwork(wallet.provider) } catch { showToast('Could not auto-switch network', 'error') }
      const prov = new ethers.BrowserProvider(wallet.provider as ethers.Eip1193Provider)
      const network = await prov.getNetwork()
      setNetworkName(network.name === 'unknown' ? 'Chain ' + network.chainId : network.name)
      activeProviderRef.current = wallet.provider
      wallet.provider.on('accountsChanged', (accs) => {
        const newAccs = accs as string[]
        if (!newAccs || newAccs.length === 0) { handleDisconnect(); return }
        setAccount(newAccs[0])
      })
      wallet.provider.on('chainChanged', () => window.location.reload())
      setProvider(prov)
      setAccount(accounts[0])

      // Init FHE SDK with the RAW EIP-1193 provider (not the BrowserProvider wrapper)
      if (Number(network.chainId) === 11155111) {
        const fhevm = await initFhevm(wallet.provider as ethers.Eip1193Provider)
        fhevmRef.current = fhevm
        if (fhevm) showToast('Wallet + FHE SDK ready!', 'success')
        else showToast('Wallet connected (FHE SDK not ready)', 'info')
      } else {
        showToast('Wallet connected!', 'success')
      }

      // If no contract stored yet, show setup
      if (!localStorage.getItem(LS_CONTRACT_KEY)) {
        setShowSetup(true)
        setSetupMode('choose')
      }
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Connection failed').slice(0, 100), 'error')
    } finally { setLoading(null) }
  }

  // Deploy a brand-new payroll contract as employer
  const handleDeployNewPayroll = async () => {
    if (!provider || !deployCompanyName.trim()) { showToast('Enter a company name', 'error'); return }
    setLoading('deploy')
    try {
      const signer = await provider.getSigner()
      const factory = new ethers.ContractFactory(ABI, BYTECODE, signer)
      showToast('Confirm the deployment transaction in your wallet...', 'info')
      const deployed = await factory.deploy(deployCompanyName.trim())
      showToast('Waiting for on-chain confirmation...', 'info')
      await deployed.waitForDeployment()
      const addr = await deployed.getAddress()
      localStorage.setItem(LS_CONTRACT_KEY, addr)
      setContractAddress(addr)
      setShowSetup(false)
      showToast('Contract deployed! Address: ' + addr.slice(0, 10) + '...' + addr.slice(-6), 'success')
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Deploy failed').slice(0, 120), 'error')
    } finally { setLoading(null) }
  }

  // Connect to an existing contract (for employees)
  const handleUseExisting = () => {
    if (!ethers.isAddress(existingAddrInput)) { showToast('Invalid contract address', 'error'); return }
    const addr = ethers.getAddress(existingAddrInput)
    localStorage.setItem(LS_CONTRACT_KEY, addr)
    setContractAddress(addr)
    setShowSetup(false)
    setIsEmployer(false)
    setIsEmployee(false)
  }

  // Clear stored contract so user can switch to a different one
  const handleClearContract = () => {
    localStorage.removeItem(LS_CONTRACT_KEY)
    setContractAddress('')
    setContract(null)
    setIsEmployer(false)
    setIsEmployee(false)
    setCompanyName('')
    setEmployees([])
    setSetupMode('choose')
    setExistingAddrInput('')
    setDeployCompanyName('')
    setShowSetup(true)
  }

  // Load data from the current contract
  const loadContractData = useCallback(async () => {
    if (!provider || !account || !contractAddress) return
    try {
      const signer = await provider.getSigner()
      const c = new ethers.Contract(contractAddress, ABI, signer)
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
      const isEmp = await c.isEmployee(account)
      setIsEmployee(isEmp)
      const statusMap: Record<string, boolean> = {}
      for (const emp of empList) { statusMap[emp] = await c.isPaidThisCycle(emp) }
      setPaidStatus(statusMap)
    } catch (err) { console.error('Failed to load contract data:', err) }
  }, [provider, account, contractAddress])

  useEffect(() => { loadContractData() }, [loadContractData])

  // global provider event listeners removed — handled per-wallet in connectWallet

  // Employer: Deposit
  const handleDeposit = async () => {
    if (!contract || !provider) return
    const amount = parseInt(depositAmount)
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return }
    setLoading('deposit')
    try {
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()
      let handle: string, inputProof: string
      if (fhevmRef.current) {
        const enc = await encryptUint64(fhevmRef.current, BigInt(amount), contractAddress, userAddress)
        handle = enc.handle; inputProof = enc.inputProof
      } else {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [BigInt(amount), userAddress]))
        inputProof = '0x'
      }
      const tx = await contract.deposit(handle, inputProof)
      await tx.wait()
      showToast('Deposited ' + amount + ' to treasury', 'success')
      setDepositAmount('')
      await loadContractData()
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 120), 'error')
    } finally { setLoading(null) }
  }

  // Employer: Add Employee
  const handleAddEmployee = async () => {
    if (!contract || !provider) return
    if (!ethers.isAddress(newEmpAddress)) { showToast('Invalid address', 'error'); return }
    const salary = parseInt(newEmpSalary)
    if (!salary || salary <= 0) { showToast('Enter a valid salary', 'error'); return }
    setLoading('addEmployee')
    try {
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()
      let handle: string, inputProof: string
      if (fhevmRef.current) {
        const enc = await encryptUint64(fhevmRef.current, BigInt(salary), contractAddress, userAddress)
        handle = enc.handle; inputProof = enc.inputProof
      } else {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [BigInt(salary), userAddress]))
        inputProof = '0x'
      }
      const tx = await contract.addEmployee(newEmpAddress, handle, inputProof)
      await tx.wait()
      showToast('Employee added!', 'success')
      setNewEmpAddress(''); setNewEmpSalary('')
      await loadContractData()
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 120), 'error')
    } finally { setLoading(null) }
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
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 100), 'error')
    } finally { setLoading(null) }
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
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 100), 'error')
    } finally { setLoading(null) }
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
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 100), 'error')
    } finally { setLoading(null) }
  }

  // Employee: Decrypt Salary
  const handleViewSalary = async () => {
    if (!contract || !provider) return
    setLoading('viewSalary')
    try {
      const encHandle = await contract.viewMySalary()
      const handleHex = ethers.hexlify(encHandle)
      if (fhevmRef.current) {
        showToast('Please sign the decryption request in your wallet...', 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, contractAddress, signer)
        setMySalary(value)
        showToast('Your salary: ' + value.toString() + ' units', 'success')
      } else {
        showToast('FHE SDK not ready — connect on Sepolia to decrypt', 'error')
      }
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Decryption failed').slice(0, 120), 'error')
    } finally { setLoading(null) }
  }

  const handleViewBalance = async () => {
    if (!contract || !provider) return
    setLoading('viewBalance')
    try {
      const encHandle = await contract.viewMyBalance()
      const handleHex = ethers.hexlify(encHandle)
      if (fhevmRef.current) {
        showToast('Please sign the decryption request in your wallet...', 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, contractAddress, signer)
        setMyBalance(value)
        showToast('Your balance: ' + value.toString() + ' units', 'success')
      } else {
        showToast('FHE SDK not ready — connect on Sepolia to decrypt', 'error')
      }
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : 'Decryption failed').slice(0, 120), 'error')
    } finally { setLoading(null) }
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
      showToast((err instanceof Error ? err.message : 'Transaction failed').slice(0, 100), 'error')
    } finally { setLoading(null) }
  }

  const shortAddr = (addr: string) => addr.slice(0, 6) + '...' + addr.slice(-4)

  // Wallet Modal
  const WalletModal = () => (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={() => setShowWalletModal(false)}
    >
      <div
        style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '16px', padding: '2rem', minWidth: '340px', maxWidth: '400px' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '0.5rem', fontSize: '1.2rem' }}>Connect Wallet</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          You will be switched to <strong style={{ color: 'var(--accent)' }}>{TARGET_NETWORK.chainName}</strong>
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
                border: '1px solid ' + (w.available ? 'var(--border)' : 'transparent'),
                color: w.available ? 'var(--text)' : 'var(--text-dim)',
                cursor: w.available ? 'pointer' : 'not-allowed',
                opacity: w.available ? 1 : 0.4, textAlign: 'left', width: '100%', transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => { if (w.available) (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { if (w.available) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
            >
              <span style={{ fontSize: '1.8rem' }}>{w.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{w.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{w.available ? w.description : 'Not installed'}</div>
              </div>
              {w.available && <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--success)' }}>Detected</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // Setup Screen — rendered as a function call (not a component) to avoid unmount on re-render
  const renderSetupScreen = () => (
    <div className="card" style={{ maxWidth: '520px', margin: '2rem auto' }}>
      {setupMode === 'choose' && (
        <>
          <h2 style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>Get Started</h2>
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginBottom: '2rem' }}>
            Are you setting up a new payroll system, or joining an existing one?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button className="btn btn-primary" style={{ padding: '1.2rem', fontSize: '1rem', borderRadius: '12px' }}
              onClick={() => setSetupMode('deploy')}>
              🏢 I am an Employer — Create New Payroll
            </button>
            <button className="btn btn-outline" style={{ padding: '1.2rem', fontSize: '1rem', borderRadius: '12px' }}
              onClick={() => setSetupMode('existing')}>
              👤 I am an Employee — Enter Contract Address
            </button>
          </div>
        </>
      )}

      {setupMode === 'deploy' && (
        <>
          <button className="btn btn-outline" style={{ marginBottom: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setSetupMode('choose')}>
            Back
          </button>
          <h2 style={{ marginBottom: '0.5rem' }}>🏢 Create New Payroll Contract</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            You will be the Employer. After deploying, share the contract address with your employees.
          </p>
          <div className="input-group">
            <label>Company Name</label>
            <input
              type="text"
              placeholder="e.g. Zama Corp"
              value={deployCompanyName}
              onChange={e => setDeployCompanyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDeployNewPayroll() }}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}
            onClick={handleDeployNewPayroll}
            disabled={loading === 'deploy' || !deployCompanyName.trim()}>
            {loading === 'deploy' ? <><span className="loading"></span>Deploying...</> : '🚀 Deploy Contract'}
          </button>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
            This sends a transaction on {TARGET_NETWORK.chainName}
          </p>
        </>
      )}

      {setupMode === 'existing' && (
        <>
          <button className="btn btn-outline" style={{ marginBottom: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setSetupMode('choose')}>
            Back
          </button>
          <h2 style={{ marginBottom: '0.5rem' }}>👤 Connect to Existing Payroll</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Ask your employer for the payroll contract address.
          </p>
          <div className="input-group">
            <label>Contract Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={existingAddrInput}
              onChange={e => setExistingAddrInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleUseExisting() }}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}
            onClick={handleUseExisting}
            disabled={!existingAddrInput}>
            Connect
          </button>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
            Demo contract (Zama Corp): 0x6dF4438C80D908B450a214eEF2A8DAAC748936AE
          </p>
        </>
      )}
    </div>
  )

  // Not Connected
  if (!account) {
    return (
      <div className="app">
        <div className="header">
          <h1>🔐 Confidential Payroll</h1>
          <p>Private salary payments powered by Zama FHE</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>💼</div>
          <h2 style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>On-chain payroll with encrypted salaries</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: '500px', margin: '0 auto 2rem' }}>
            Salary amounts are encrypted end-to-end using Fully Homomorphic Encryption.
            Only the employer and each employee can see their own salary.
          </p>
          <button className="btn btn-primary" onClick={openWalletModal} disabled={loading === 'connect'}>
            {loading === 'connect' ? <><span className="loading"></span>Connecting...</> : '🔗 Connect Wallet'}
          </button>
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Supports MetaMask, OKX, Coinbase, Phantom and more
          </p>
        </div>
        <div className="card">
          <h2>How it works</h2>
          <div className="info-row"><span className="info-label">1. Employer connects wallet and deploys payroll contract</span><span className="badge badge-employer">Employer</span></div>
          <div className="info-row"><span className="info-label">2. Employer adds employees with encrypted salaries</span><span className="badge badge-encrypted">🔒 FHE</span></div>
          <div className="info-row"><span className="info-label">3. Execute payroll — all amounts stay encrypted on-chain</span><span className="badge badge-encrypted">🔒 FHE</span></div>
          <div className="info-row"><span className="info-label">4. Each employee decrypts only their own salary</span><span className="badge badge-employee">Private</span></div>
        </div>
        {showWalletModal && <WalletModal />}
      </div>
    )
  }

  // Connected but no contract configured
  if (showSetup || !contractAddress) {
    return (
      <div className="app">
        <div className="header"><h1>🔐 Confidential Payroll</h1></div>
        <div className="network-bar">
          <div><span className="network-dot"></span>Connected: {shortAddr(account)}</div>
          <div style={{ color: 'var(--accent)', fontSize: '0.8rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span>{networkName}</span>
            <button onClick={handleDisconnect}
              style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              Switch Wallet
            </button>
          </div>
        </div>
        {renderSetupScreen()}
        {toast && <div className={'toast toast-' + toast.type}>{toast.msg}</div>}
      </div>
    )
  }

  // Main Dashboard
  return (
    <div className="app">
      <div className="header">
        <h1>🔐 Confidential Payroll</h1>
        <p>
          {companyName || 'Confidential Payroll'}
          {isEmployer && <span className="badge badge-employer">Employer</span>}
          {isEmployee && <span className="badge badge-employee">Employee</span>}
        </p>
      </div>

      <div className="network-bar">
        <div><span className="network-dot"></span>Connected: {shortAddr(account)}</div>
        <div style={{ color: 'var(--accent)', fontSize: '0.8rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span>{networkName || TARGET_NETWORK.chainName} · Cycle #{cycleCount} · {employees.length} employees</span>
          <button onClick={handleClearContract}
            style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            Change Contract
          </button>
          <button onClick={handleDisconnect}
            style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            Switch Wallet
          </button>
        </div>
      </div>

      {/* Employer Dashboard */}
      {isEmployer && (
        <>
          <div className="card">
            <h2>💰 Treasury</h2>
            <div className="info-row">
              <span className="info-label">Treasury Balance</span>
              <span className="encrypted-value">🔒 Encrypted</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <input type="number" placeholder="Amount to deposit" value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
              <button className="btn btn-primary" onClick={handleDeposit} disabled={loading === 'deposit'}>
                {loading === 'deposit' ? <><span className="loading"></span>Depositing...</> : 'Deposit'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>👤 Add Employee</h2>
            <div className="input-group">
              <label>Employee Wallet Address</label>
              <input type="text" placeholder="0x..." value={newEmpAddress} onChange={e => setNewEmpAddress(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Monthly Salary (encrypted on-chain — only the employee can decrypt)</label>
              <input type="number" placeholder="5000" value={newEmpSalary} onChange={e => setNewEmpSalary(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleAddEmployee} disabled={loading === 'addEmployee'}>
              {loading === 'addEmployee' ? <><span className="loading"></span>Adding...</> : '+ Add Employee'}
            </button>
          </div>

          <div className="card">
            <h2>📋 Employee List</h2>
            {employees.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem' }}>No employees yet — add one above</p>
            ) : (
              <table>
                <thead><tr><th>Address</th><th>Salary</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp}>
                      <td title={emp}>{shortAddr(emp)}</td>
                      <td><span className="encrypted-value">🔒 Encrypted</span></td>
                      <td>
                        <span className={'status-dot ' + (paidStatus[emp] ? 'paid' : 'unpaid')}></span>
                        {paidStatus[emp] ? 'Paid' : 'Unpaid'}
                      </td>
                      <td>
                        <button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                          onClick={() => handleRemoveEmployee(emp)}>Remove</button>
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

          {/* Share with employees */}
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>📋 Share with Employees</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Send this contract address to your employees. They paste it on the setup screen after connecting their wallet.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', borderRadius: '6px', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                {contractAddress}
              </code>
              <button className="btn btn-outline" style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}
                onClick={() => { navigator.clipboard.writeText(contractAddress); showToast('Copied!', 'success') }}>
                Copy
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
              FHE SDK not ready — connect on Sepolia to decrypt values
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
              {loading === 'withdraw' ? <><span className="loading"></span>Processing...</> : '📤 Withdraw'}
            </button>
          </div>
        </div>
      )}

      {/* Access Restricted */}
      {!isEmployer && !isEmployee && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="lock-icon">🔒</div>
          <h2 style={{ justifyContent: 'center' }}>Access Restricted</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>
            Your address ({shortAddr(account)}) is not the employer or an employee of this contract.
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '2rem' }}>
            Contract: {shortAddr(contractAddress)}
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={handleClearContract}>
              Use a Different Contract
            </button>
            <button className="btn btn-primary" onClick={() => { localStorage.removeItem(LS_CONTRACT_KEY); setContractAddress(''); setContract(null); setIsEmployer(false); setIsEmployee(false); setCompanyName(''); setEmployees([]); setExistingAddrInput(''); setDeployCompanyName(''); setSetupMode('deploy'); setShowSetup(true); }}>
              🏢 Deploy My Own Payroll
            </button>
          </div>
        </div>
      )}

      {toast && <div className={'toast toast-' + toast.type}>{toast.msg}</div>}
      {showWalletModal && <WalletModal />}
    </div>
  )
}

export default App
