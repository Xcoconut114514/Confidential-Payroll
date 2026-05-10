import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import ABI from './abi.json'
import { BYTECODE } from './bytecode'
import GOV_ABI from './governance-abi.json'
import { GOVERNANCE_BYTECODE } from './governance-bytecode'
import { useFhevm } from './useFhevm'
import { SepoliaConfig } from '@zama-fhe/relayer-sdk/web'

// localStorage keys
const LS_CONTRACT_KEY = 'cpayroll_contract_v1'
const LS_GOV_CONTRACT_KEY = 'cgov_contract_v1'
const DEFAULT_PAYROLL_CONTRACT = import.meta.env.VITE_PAYROLL_CONTRACT_ADDRESS || ''
const DEFAULT_GOV_CONTRACT = import.meta.env.VITE_GOV_CONTRACT_ADDRESS || ''

// Zama fhEVM runs on Sepolia
const ZAMA_NETWORK = {
  chainId: '0xaa36a7',
  chainName: 'Ethereum Sepolia (Zama fhEVM)',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
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

type CompliancePolicy = {
  employerKyc: boolean
  employeeKyc: boolean
  employerZk: boolean
  employeeZk: boolean
}

type ComplianceRecord = {
  approved: boolean
  kycHash: string
  zkHash: string
}

const DEFAULT_COMPLIANCE_POLICY: CompliancePolicy = {
  employerKyc: false,
  employeeKyc: false,
  employerZk: false,
  employeeZk: false,
}

const PAYROLL_EXTRA_ABI = [
  'function configureCompliancePolicy(bool,bool,bool,bool)',
  'function setComplianceRecord(address,bool,bytes32,bytes32)',
  'function getComplianceRecord(address) view returns (bool approved, bytes32 kycHash, bytes32 zkHash)',
  'function requireEmployerKyc() view returns (bool)',
  'function requireEmployeeKyc() view returns (bool)',
  'function requireEmployerZkAttestation() view returns (bool)',
  'function requireEmployeeZkAttestation() view returns (bool)',
  'function getAuditors() view returns (address[])',
  'function getTaxAuthorities() view returns (address[])',
  'function minimumWage() view returns (uint64)',
] as const

const PAYROLL_ABI = [...(ABI as unknown as readonly unknown[]), ...PAYROLL_EXTRA_ABI]

const TESTNET_RUNTIME = {
  hostChainId: 11155111,
  gatewayChainId: SepoliaConfig.gatewayChainId,
  relayerUrl: SepoliaConfig.relayerUrl,
  aclContractAddress: SepoliaConfig.aclContractAddress,
  inputVerifierContractAddress: SepoliaConfig.inputVerifierContractAddress,
  kmsContractAddress: SepoliaConfig.kmsContractAddress,
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
    { id: 'metamask', name: 'MetaMask', icon: 'MM', provider: metamask, available: !!metamask, description: 'Most popular EVM wallet' },
    { id: 'okx', name: 'OKX Wallet', icon: 'OKX', provider: okx, available: !!okx, description: 'OKX multi-chain wallet' },
    { id: 'bitget', name: 'Bitget Wallet', icon: 'BG', provider: bitget, available: !!bitget, description: 'Bitget Web3 wallet' },
    { id: 'phantom', name: 'Phantom (EVM)', icon: 'PH', provider: phantom, available: !!phantom, description: 'Phantom Ethereum wallet' },
    { id: 'coinbase', name: 'Coinbase Wallet', icon: 'CB', provider: coinbase, available: !!coinbase, description: 'Coinbase self-custody wallet' },
    { id: 'brave', name: 'Brave Wallet', icon: 'BW', provider: brave, available: !!brave, description: 'Built-in Brave browser wallet' },
    { id: 'generic', name: 'Other Wallet', icon: 'OT', provider: eth ?? null, available: !!eth, description: 'Any other injected wallet' },
  ]
}

type Lang = 'en' | 'zh'
const T = {
  en: {
    docs: 'Docs \u2197',
    switchWallet: 'Switch Wallet',
    changeContract: 'Change Contract',
    langBtn: '\u4e2d\u6587',
    eyebrow: 'Fully Homomorphic Encryption \u00b7 Ethereum Sepolia',
    heroTitle: 'Payroll, governance, and compliance \u2014 end-to-end encrypted.',
    openConsole: 'Open Console',
    protocolDocs: 'Protocol Docs \u2197',
    connecting: 'Connecting...',
    chip1: 'FHE encrypted salaries',
    chip2: 'Private board votes',
    chip3: 'Optional KYC gate',
    chip4: 'ZK input proofs',
    showcaseTitle: 'ENCRYPTED STATE',
    showcaseSalary: 'SALARY',
    showcaseTreasury: 'TREASURY',
    showcaseVote: 'VOTE',
    showcaseStatus1: 'Zama fhEVM Sepolia',
    showcaseStatus2: 'KMS Gateway active',
    showcaseStatus3: 'Input proof flow ready',
    getStarted: 'Get Started',
    setupQ: 'Are you setting up a new payroll system, or joining an existing one?',
    asEmployer: 'I am an Employer \u2014 Create New Payroll',
    asEmployee: 'I am an Employee \u2014 Enter Contract Address',
    back: 'Back',
    createPayroll: 'Create New Payroll Contract',
    createPayrollDesc: 'You will be the Employer. After deploying, share the contract address with your employees.',
    coName: 'Company Name',
    coNamePh: 'e.g. Zama Corp',
    deployBtn: 'Deploy Contract',
    deploying: 'Deploying...',
    connectExisting: 'Connect to Existing Payroll',
    connectExistingDesc: 'Ask your employer for the payroll contract address.',
    contractAddr: 'Contract Address',
    connect: 'Connect',
    runtime: 'Runtime',
    relayer: 'Relayer',
    mode: 'Mode',
    account: 'Account',
    proofMode: 'Input proof mode',
    kycPolicy: 'KYC policy',
    fheLive: 'FHE live',
    sepoliaOnly: 'Sepolia only for FHE',
    tabPayroll: 'Payroll',
    tabGov: 'Governance',
    tabCompliance: 'Compliance',
    liveFlow: 'Sepolia live flow',
    localFlow: 'Local mock flow',
    kycGated: 'KYC gated',
    kycOptional: 'KYC optional',
    attestGated: 'Attestation gated',
    attestOptional: 'Attestation optional',
    legacyContract: 'Legacy contract / no advanced policy',
    regulatedMode: 'Regulated Mode',
    employer: 'Employer',
    employee: 'Employee',
    govAdmin: 'Gov Admin',
    board: 'Board',
    auditor: 'Auditor',
    taxAuth: 'Tax Authority',
  },
  zh: {
    docs: '\u6587\u6863 \u2197',
    switchWallet: '\u5207\u6362\u9322\u5305',
    changeContract: '\u66f4\u6362\u5408\u7ea6',
    langBtn: 'EN',
    eyebrow: '\u5168\u540c\u6001\u52a0\u5bc6 \u00b7 \u4ee5\u592a\u574a Sepolia',
    heroTitle: '\u85aa\u8d44\u3001\u6cbb\u7406\u4e0e\u5408\u89c4 \u2014 \u5168\u94fe\u8def\u52a0\u5bc6\u6267\u884c\u3002',
    openConsole: '\u6253\u5f00\u63a7\u5236\u53f0',
    protocolDocs: '\u534f\u8bae\u6587\u6863 \u2197',
    connecting: '\u8fde\u63a5\u4e2d\u2026',
    chip1: 'FHE \u52a0\u5bc6\u85aa\u8d44',
    chip2: '\u9690\u79c1\u6295\u7968',
    chip3: '\u53ef\u9009 KYC \u95e8\u63a7',
    chip4: 'ZK \u8f93\u5165\u8bc1\u660e',
    showcaseTitle: '\u52a0\u5bc6\u72b6\u6001',
    showcaseSalary: '\u85aa\u8d44',
    showcaseTreasury: '\u56fd\u5e93',
    showcaseVote: '\u6295\u7968',
    showcaseStatus1: 'Zama fhEVM Sepolia',
    showcaseStatus2: 'KMS \u7f51\u5173\u5c31\u7eea',
    showcaseStatus3: '\u8f93\u5165\u8bc1\u660e\u6d41\u7a0b\u5c31\u7eea',
    getStarted: '\u5f00\u59cb\u4f7f\u7528',
    setupQ: '\u60a8\u662f\u8981\u8bbe\u7f6e\u65b0\u7684\u85aa\u8d44\u7cfb\u7edf\uff0c\u8fd8\u662f\u52a0\u5165\u73b0\u6709\u7cfb\u7edf\uff1f',
    asEmployer: '\u6211\u662f\u96c7\u4e3b \u2014 \u521b\u5efa\u65b0\u85aa\u8d44\u5408\u7ea6',
    asEmployee: '\u6211\u662f\u5458\u5de5 \u2014 \u8f93\u5165\u5408\u7ea6\u5730\u5740',
    back: '\u8fd4\u56de',
    createPayroll: '\u521b\u5efa\u85aa\u8d44\u5408\u7ea6',
    createPayrollDesc: '\u60a8\u5c06\u6210\u4e3a\u96c7\u4e3b\u3002\u90e8\u7f72\u540e\uff0c\u5c06\u5408\u7ea6\u5730\u5740\u5206\u4eab\u7ed9\u60a8\u7684\u5458\u5de5\u3002',
    coName: '\u516c\u53f8\u540d\u79f0',
    coNamePh: '\u5982\uff1aZama Corp',
    deployBtn: '\u90e8\u7f72\u5408\u7ea6',
    deploying: '\u90e8\u7f72\u4e2d\u2026',
    connectExisting: '\u8fde\u63a5\u73b0\u6709\u85aa\u8d44\u5408\u7ea6',
    connectExistingDesc: '\u8bf7\u5411\u96c7\u4e3b\u83b7\u53d6\u5408\u7ea6\u5730\u5740\u3002',
    contractAddr: '\u5408\u7ea6\u5730\u5740',
    connect: '\u8fde\u63a5',
    runtime: '\u8fd0\u884c\u65f6',
    relayer: '\u4e2d\u7ee7\u5668',
    mode: '\u6a21\u5f0f',
    account: '\u8d26\u6237',
    proofMode: '\u8f93\u5165\u8bc1\u660e\u6a21\u5f0f',
    kycPolicy: 'KYC \u7b56\u7565',
    fheLive: 'FHE \u5df2\u6fc0\u6d3b',
    sepoliaOnly: '\u4ec5 Sepolia \u652f\u6301 FHE',
    tabPayroll: '\u85aa\u8d44',
    tabGov: '\u6cbb\u7406',
    tabCompliance: '\u5408\u89c4',
    liveFlow: 'Sepolia \u5b9e\u65f6\u6d41\u7a0b',
    localFlow: '\u672c\u5730\u6a21\u62df\u6d41\u7a0b',
    kycGated: 'KYC \u95e8\u63a7',
    kycOptional: 'KYC \u53ef\u9009',
    attestGated: '\u8bc1\u660e\u95e8\u63a7',
    attestOptional: '\u8bc1\u660e\u53ef\u9009',
    legacyContract: '\u65e7\u5408\u7ea6 / \u65e0\u9ad8\u7ea7\u7b56\u7565',
    regulatedMode: '\u76d1\u7ba1\u6a21\u5f0f',
    employer: '\u96c7\u4e3b',
    employee: '\u5458\u5de5',
    govAdmin: '\u6cbb\u7406\u7ba1\u7406\u5458',
    board: '\u8463\u4e8b\u4f1a',
    auditor: '\u5ba1\u8ba1\u5458',
    taxAuth: '\u7a0e\u52a1\u673a\u5173',
  },
} as const

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [contract, setContract] = useState<ethers.Contract | null>(null)
  const [contractAddress, setContractAddress] = useState<string>(() => localStorage.getItem(LS_CONTRACT_KEY) || DEFAULT_PAYROLL_CONTRACT)
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
  const [lang, setLang] = useState<Lang>('en')
  const [activeTab, setActiveTab] = useState<'payroll' | 'governance' | 'compliance'>('payroll')
  const activeProviderRef = useRef<EIP1193Provider | null>(null)

  // Governance state
  const [govContractAddress, setGovContractAddress] = useState<string>(() => localStorage.getItem(LS_GOV_CONTRACT_KEY) || DEFAULT_GOV_CONTRACT)
  const [govContract, setGovContract] = useState<ethers.Contract | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isBoardMember, setIsBoardMember] = useState(false)
  const [boardMembers, setBoardMembers] = useState<string[]>([])
  const [proposals, setProposals] = useState<Array<{ id: number; title: string; description: string; startTime: number; endTime: number; isFinalized: boolean; voterCount: number }>>([])
  const [newMemberAddr, setNewMemberAddr] = useState('')
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalDesc, setProposalDesc] = useState('')
  const [proposalDuration, setProposalDuration] = useState('')
  const [deployGovOrgName, setDeployGovOrgName] = useState('')
  const [govOrgName, setGovOrgName] = useState('')

  // Compliance state
  const [isAuditor, setIsAuditor] = useState(false)
  const [isTaxAuthority, setIsTaxAuthority] = useState(false)
  const [advancedComplianceSupported, setAdvancedComplianceSupported] = useState(false)
  const [compliancePolicy, setCompliancePolicy] = useState<CompliancePolicy>(DEFAULT_COMPLIANCE_POLICY)
  const [myComplianceRecord, setMyComplianceRecord] = useState<ComplianceRecord | null>(null)
  const [auditors, setAuditors] = useState<string[]>([])
  const [taxAuthorities, setTaxAuthorities] = useState<string[]>([])
  const [minimumWageValue, setMinimumWageValue] = useState(0)
  const [auditorAddr, setAuditorAddr] = useState('')
  const [taxAuthAddr, setTaxAuthAddr] = useState('')
  const [minWageInput, setMinWageInput] = useState('')
  const [minWageCheckAddr, setMinWageCheckAddr] = useState('')
  const [complianceSubject, setComplianceSubject] = useState('')
  const [complianceApproved, setComplianceApproved] = useState(true)
  const [kycReference, setKycReference] = useState('')
  const [zkReference, setZkReference] = useState('')

  // Setup flow state
  const [showSetup, setShowSetup] = useState(false)
  const [setupMode, setSetupMode] = useState<'choose' | 'deploy' | 'existing'>('choose')
  const [deployCompanyName, setDeployCompanyName] = useState('')
  const [existingAddrInput, setExistingAddrInput] = useState('')

  // FHE SDK
  const { init: initFhevm, encryptUint64, userDecryptHandle } = useFhevm()
  const fhevmRef = useRef<import('@zama-fhe/relayer-sdk/web').FhevmInstance | null>(null)

  const t = T[lang]
  const tr = (en: string, zh: string) => (lang === 'zh' ? zh : en)
  const walletDisplayName = (wallet: WalletOption) =>
    wallet.id === 'generic' ? tr('Other Wallet', '\u5176\u4ed6\u94b1\u5305') : wallet.name
  const walletDescription = (wallet: WalletOption) => {
    if (!wallet.available) return tr('Not installed', '\u672a\u5b89\u88c5')

    switch (wallet.id) {
      case 'metamask':
        return tr('Most popular EVM wallet', '\u6700\u5e38\u7528\u7684 EVM \u94b1\u5305')
      case 'okx':
        return tr('OKX multi-chain wallet', 'OKX \u591a\u94fe\u94b1\u5305')
      case 'bitget':
        return tr('Bitget Web3 wallet', 'Bitget Web3 \u94b1\u5305')
      case 'phantom':
        return tr('Phantom Ethereum wallet', 'Phantom Ethereum \u94b1\u5305')
      case 'coinbase':
        return tr('Coinbase self-custody wallet', 'Coinbase \u81ea\u6258\u7ba1\u94b1\u5305')
      case 'brave':
        return tr('Built-in Brave browser wallet', 'Brave \u6d4f\u89c8\u5668\u5185\u7f6e\u94b1\u5305')
      default:
        return tr('Any other injected wallet', '\u4efb\u610f\u5176\u4ed6\u6ce8\u5165\u5f0f\u94b1\u5305')
    }
  }
  const errorText = (err: unknown, fallbackEn: string, fallbackZh: string, max = 120) =>
    (err instanceof Error ? err.message : tr(fallbackEn, fallbackZh)).slice(0, max)

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
      // Fire-and-forget: do NOT await â€” some wallets hang on unsupported methods
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
    if (!wallet.provider) {
      showToast(
        lang === 'zh'
          ? `${walletDisplayName(wallet)} \u672a\u68c0\u6d4b\u5230\uff0c\u8bf7\u5148\u5b89\u88c5\u3002`
          : wallet.name + ' not detected. Please install it.',
        'error',
      )
      return
    }
    setShowWalletModal(false)
    setLoading('connect')
    try {
      // ---- Force the wallet to forget this site so it MUST show the account picker ----
      // Method 1: disconnect() â€” non-standard but supported by OKX, Phantom, etc.
      try {
        const p = wallet.provider as unknown as { disconnect?: () => void | Promise<void> }
        if (typeof p.disconnect === 'function') await p.disconnect()
      } catch { /* ignore */ }
      // Method 2: wallet_revokePermissions â€” EIP standard, supported by MetaMask, some others
      try {
        await wallet.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
      } catch { /* ignore */ }

      // Now eth_requestAccounts MUST open the wallet extension popup
      // because the site no longer has permission.
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[]

      if (!accounts || accounts.length === 0) {
        showToast(tr('No accounts returned from wallet', '\u94b1\u5305\u6ca1\u6709\u8fd4\u56de\u8d26\u53f7'), 'error')
        setLoading(null)
        return
      }
      try { await switchToTargetNetwork(wallet.provider) } catch { showToast(tr('Could not auto-switch network', '\u65e0\u6cd5\u81ea\u52a8\u5207\u6362\u7f51\u7edc'), 'error') }
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
        if (fhevm) showToast(tr('Wallet + FHE SDK ready!', '\u94b1\u5305 + FHE SDK \u5df2\u5c31\u7eea\uff01'), 'success')
        else showToast(tr('Wallet connected (FHE SDK not ready)', '\u94b1\u5305\u5df2\u8fde\u63a5\uff08FHE SDK \u672a\u5c31\u7eea\uff09'), 'info')
      } else {
        showToast(tr('Wallet connected!', '\u94b1\u5305\u5df2\u8fde\u63a5\uff01'), 'success')
      }

      // If no contract stored yet, show setup
      if (!localStorage.getItem(LS_CONTRACT_KEY)) {
        setShowSetup(true)
        setSetupMode('choose')
      }
    } catch (err: unknown) {
      showToast(errorText(err, 'Connection failed', '\u8fde\u63a5\u5931\u8d25', 100), 'error')
    } finally { setLoading(null) }
  }

  // Deploy a brand-new payroll contract as employer
  const handleDeployNewPayroll = async () => {
    if (!provider || !deployCompanyName.trim()) { showToast(tr('Enter a company name', '\u8bf7\u8f93\u5165\u516c\u53f8\u540d\u79f0'), 'error'); return }
    setLoading('deploy')
    try {
      const signer = await provider.getSigner()
      const factory = new ethers.ContractFactory(ABI, BYTECODE, signer)
      showToast(tr('Confirm the deployment transaction in your wallet...', '\u8bf7\u5728\u94b1\u5305\u4e2d\u786e\u8ba4\u90e8\u7f72\u4ea4\u6613...'), 'info')
      const deployed = await factory.deploy(deployCompanyName.trim())
      showToast(tr('Waiting for on-chain confirmation...', '\u7b49\u5f85\u94fe\u4e0a\u786e\u8ba4\u4e2d...'), 'info')
      await deployed.waitForDeployment()
      const addr = await deployed.getAddress()
      localStorage.setItem(LS_CONTRACT_KEY, addr)
      setContractAddress(addr)
      setShowSetup(false)
      showToast(
        lang === 'zh'
          ? `\u5408\u7ea6\u5df2\u90e8\u7f72\uff01\u5730\u5740\uff1a ${addr.slice(0, 10)}...${addr.slice(-6)}`
          : 'Contract deployed! Address: ' + addr.slice(0, 10) + '...' + addr.slice(-6),
        'success',
      )
    } catch (err: unknown) {
      showToast(errorText(err, 'Deploy failed', '\u90e8\u7f72\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  // Connect to an existing contract (for employees)
  const handleUseExisting = () => {
    if (!ethers.isAddress(existingAddrInput)) { showToast(tr('Invalid contract address', '\u5408\u7ea6\u5730\u5740\u65e0\u6548'), 'error'); return }
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
      const c = new ethers.Contract(contractAddress, PAYROLL_ABI, signer)
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

  // Load Governance contract data
  const loadGovData = useCallback(async () => {
    if (!provider || !account || !govContractAddress) return
    try {
      const signer = await provider.getSigner()
      const gc = new ethers.Contract(govContractAddress, GOV_ABI, signer)
      setGovContract(gc)
      const [name, admin, members, proposalCount] = await Promise.all([
        gc.orgName(),
        gc.admin(),
        gc.getBoardMembers(),
        gc.getProposalCount(),
      ])
      setGovOrgName(name)
      setIsAdmin(admin.toLowerCase() === account.toLowerCase())
      setBoardMembers([...members])
      setIsBoardMember(await gc.isBoardMember(account))
      const props: typeof proposals = []
      for (let i = 0; i < Number(proposalCount); i++) {
        const p = await gc.proposals(i)
        props.push({
          id: i,
          title: p.title,
          description: p.description,
          startTime: Number(p.startTime),
          endTime: Number(p.endTime),
          isFinalized: p.isFinalized,
          voterCount: Number(p.voterCount),
        })
      }
      setProposals(props)
    } catch (err) { console.error('Failed to load governance data:', err) }
  }, [provider, account, govContractAddress])

  useEffect(() => { loadGovData() }, [loadGovData])

  // Load compliance roles from payroll contract
  const loadComplianceData = useCallback(async () => {
    if (!contract || !account) return
    try {
      const [auditor, tax] = await Promise.all([
        contract.isAuditor(account),
        contract.isTaxAuthority(account),
      ])
      setIsAuditor(auditor)
      setIsTaxAuthority(tax)
      try {
        const [
          employerKyc,
          employeeKyc,
          employerZk,
          employeeZk,
          auditorList,
          taxAuthorityList,
          minimumWage,
          record,
        ] = await Promise.all([
          contract.requireEmployerKyc(),
          contract.requireEmployeeKyc(),
          contract.requireEmployerZkAttestation(),
          contract.requireEmployeeZkAttestation(),
          contract.getAuditors(),
          contract.getTaxAuthorities(),
          contract.minimumWage(),
          contract.getComplianceRecord(account),
        ])

        setAdvancedComplianceSupported(true)
        setCompliancePolicy({
          employerKyc,
          employeeKyc,
          employerZk,
          employeeZk,
        })
        setAuditors([...auditorList])
        setTaxAuthorities([...taxAuthorityList])
        setMinimumWageValue(Number(minimumWage))
        setMyComplianceRecord({
          approved: record.approved,
          kycHash: record.kycHash,
          zkHash: record.zkHash,
        })
      } catch {
        setAdvancedComplianceSupported(false)
        setCompliancePolicy(DEFAULT_COMPLIANCE_POLICY)
        setAuditors([])
        setTaxAuthorities([])
        setMinimumWageValue(0)
        setMyComplianceRecord(null)
      }
    } catch {
      setAdvancedComplianceSupported(false)
    }
  }, [contract, account])

  useEffect(() => { loadComplianceData() }, [loadComplianceData])

  // global provider event listeners removed â€” handled per-wallet in connectWallet

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
      showToast(lang === 'zh' ? `\u5df2\u5411\u8d44\u91d1\u6c60\u5b58\u5165 ${amount}` : 'Deposited ' + amount + ' to treasury', 'success')
      setDepositAmount('')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  // Employer: Add Employee
  const handleAddEmployee = async () => {
    if (!contract || !provider) return
    if (!ethers.isAddress(newEmpAddress)) { showToast(tr('Invalid address', '\u5730\u5740\u65e0\u6548'), 'error'); return }
    const salary = parseInt(newEmpSalary)
    if (!salary || salary <= 0) { showToast(tr('Enter a valid salary', '\u8bf7\u8f93\u5165\u6709\u6548\u85aa\u8d44'), 'error'); return }
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
      showToast(tr('Employee added!', '\u5458\u5de5\u5df2\u6dfb\u52a0\uff01'), 'success')
      setNewEmpAddress(''); setNewEmpSalary('')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleRemoveEmployee = async (addr: string) => {
    if (!contract) return
    setLoading('remove')
    try {
      const tx = await contract.removeEmployee(addr)
      await tx.wait()
      showToast(tr('Employee removed', '\u5458\u5de5\u5df2\u79fb\u9664'), 'success')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25', 100), 'error')
    } finally { setLoading(null) }
  }

  const handleExecutePay = async () => {
    if (!contract) return
    setLoading('pay')
    try {
      const tx = await contract.executePay()
      await tx.wait()
      showToast(tr('Payroll executed!', '\u53d1\u85aa\u5df2\u6267\u884c\uff01'), 'success')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25', 100), 'error')
    } finally { setLoading(null) }
  }

  const handleResetCycle = async () => {
    if (!contract) return
    setLoading('reset')
    try {
      const tx = await contract.resetPayCycle()
      await tx.wait()
      showToast(tr('Pay cycle reset', '\u53d1\u85aa\u5468\u671f\u5df2\u91cd\u7f6e'), 'success')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25', 100), 'error')
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
        showToast(tr('Please sign the decryption request in your wallet...', '\u8bf7\u5728\u94b1\u5305\u4e2d\u7b7e\u540d\u89e3\u5bc6\u8bf7\u6c42...'), 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, contractAddress, signer)
        setMySalary(value)
        showToast(lang === 'zh' ? `\u60a8\u7684\u85aa\u8d44\uff1a${value.toString()} \u5355\u4f4d` : 'Your salary: ' + value.toString() + ' units', 'success')
      } else {
        showToast(tr('FHE SDK not ready \u2014 connect on Sepolia to decrypt', 'FHE SDK \u672a\u5c31\u7eea\uff0c\u8bf7\u8fde\u63a5 Sepolia \u540e\u89e3\u5bc6'), 'error')
      }
    } catch (err: unknown) {
      showToast(errorText(err, 'Decryption failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleViewBalance = async () => {
    if (!contract || !provider) return
    setLoading('viewBalance')
    try {
      const encHandle = await contract.viewMyBalance()
      const handleHex = ethers.hexlify(encHandle)
      if (fhevmRef.current) {
        showToast(tr('Please sign the decryption request in your wallet...', '\u8bf7\u5728\u94b1\u5305\u4e2d\u7b7e\u540d\u89e3\u5bc6\u8bf7\u6c42...'), 'info')
        const signer = await provider.getSigner()
        const value = await userDecryptHandle(fhevmRef.current, handleHex, contractAddress, signer)
        setMyBalance(value)
        showToast(lang === 'zh' ? `\u60a8\u7684\u4f59\u989d\uff1a${value.toString()} \u5355\u4f4d` : 'Your balance: ' + value.toString() + ' units', 'success')
      } else {
        showToast(tr('FHE SDK not ready \u2014 connect on Sepolia to decrypt', 'FHE SDK \u672a\u5c31\u7eea\uff0c\u8bf7\u8fde\u63a5 Sepolia \u540e\u89e3\u5bc6'), 'error')
      }
    } catch (err: unknown) {
      showToast(errorText(err, 'Decryption failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleWithdraw = async () => {
    if (!contract) return
    setLoading('withdraw')
    try {
      const tx = await contract.withdraw()
      await tx.wait()
      showToast(tr('Withdrawal successful!', '\u63d0\u53d6\u6210\u529f\uff01'), 'success')
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Transaction failed', '\u4ea4\u6613\u5931\u8d25', 100), 'error')
    } finally { setLoading(null) }
  }

  const shortAddr = (addr: string) => addr.slice(0, 6) + '...' + addr.slice(-4)
  const commitmentOrZero = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ethers.ZeroHash
    return ethers.isHexString(trimmed, 32) ? ethers.hexlify(trimmed) : ethers.id(trimmed)
  }

  // ============ Governance Handlers ============

  const handleDeployGov = async () => {
    if (!provider || !deployGovOrgName.trim()) { showToast(tr('Enter org name', '\u8bf7\u8f93\u5165\u7ec4\u7ec7\u540d\u79f0'), 'error'); return }
    setLoading('deployGov')
    try {
      const signer = await provider.getSigner()
      const factory = new ethers.ContractFactory(GOV_ABI, GOVERNANCE_BYTECODE, signer)
      showToast(tr('Confirm governance deployment in wallet...', '\u8bf7\u5728\u94b1\u5305\u4e2d\u786e\u8ba4\u6cbb\u7406\u5408\u7ea6\u90e8\u7f72...'), 'info')
      const deployed = await factory.deploy(deployGovOrgName.trim())
      await deployed.waitForDeployment()
      const addr = await deployed.getAddress()
      localStorage.setItem(LS_GOV_CONTRACT_KEY, addr)
      setGovContractAddress(addr)
      showToast(lang === 'zh' ? `\u6cbb\u7406\u5408\u7ea6\u5df2\u90e8\u7f72\uff1a${addr.slice(0, 10)}...` : 'Governance deployed: ' + addr.slice(0, 10) + '...', 'success')
    } catch (err: unknown) {
      showToast(errorText(err, 'Deploy failed', '\u90e8\u7f72\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleConnectGov = (addr: string) => {
    if (!ethers.isAddress(addr)) { showToast(tr('Invalid address', '\u5730\u5740\u65e0\u6548'), 'error'); return }
    const a = ethers.getAddress(addr)
    localStorage.setItem(LS_GOV_CONTRACT_KEY, a)
    setGovContractAddress(a)
  }

  const handleClearGov = () => {
    localStorage.removeItem(LS_GOV_CONTRACT_KEY)
    setGovContractAddress('')
    setGovContract(null)
    setIsAdmin(false)
    setIsBoardMember(false)
    setBoardMembers([])
    setProposals([])
    setGovOrgName('')
  }

  const handleAddBoardMember = async () => {
    if (!govContract || !ethers.isAddress(newMemberAddr)) { showToast(tr('Invalid address', '\u5730\u5740\u65e0\u6548'), 'error'); return }
    setLoading('addMember')
    try {
      const tx = await govContract.addBoardMember(newMemberAddr)
      await tx.wait()
      showToast(tr('Board member added', '\u8463\u4e8b\u6210\u5458\u5df2\u6dfb\u52a0'), 'success')
      setNewMemberAddr('')
      await loadGovData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleRemoveBoardMember = async (addr: string) => {
    if (!govContract) return
    setLoading('removeMember')
    try {
      const tx = await govContract.removeBoardMember(addr)
      await tx.wait()
      showToast(tr('Member removed', '\u6210\u5458\u5df2\u79fb\u9664'), 'success')
      await loadGovData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25', 100), 'error')
    } finally { setLoading(null) }
  }

  const handleCreateProposal = async () => {
    if (!govContract || !proposalTitle.trim()) { showToast(tr('Enter proposal title', '\u8bf7\u8f93\u5165\u63d0\u6848\u6807\u9898'), 'error'); return }
    const dur = parseInt(proposalDuration)
    if (!dur || dur <= 0) { showToast(tr('Enter valid duration in seconds', '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u6295\u7968\u65f6\u957f\uff08\u79d2\uff09'), 'error'); return }
    setLoading('createProposal')
    try {
      const tx = await govContract.createProposal(proposalTitle.trim(), proposalDesc.trim(), dur)
      await tx.wait()
      showToast(tr('Proposal created!', '\u63d0\u6848\u5df2\u521b\u5efa\uff01'), 'success')
      setProposalTitle(''); setProposalDesc(''); setProposalDuration('')
      await loadGovData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleVote = async (proposalId: number, voteYes: boolean) => {
    if (!govContract || !provider) return
    setLoading('vote-' + proposalId)
    try {
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()
      const voteValue = voteYes ? 1 : 0
      if (fhevmRef.current) {
        const input = fhevmRef.current.createEncryptedInput(govContractAddress, userAddress)
        input.add8(voteValue)
        const enc = await input.encrypt()
        const handle = ethers.hexlify(enc.handles[0])
        const proof = ethers.hexlify(enc.inputProof)
        const tx = await govContract.vote(proposalId, handle, proof)
        await tx.wait()
      } else {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        const handle = ethers.keccak256(abiCoder.encode(['uint8', 'address'], [voteValue, userAddress]))
        const tx = await govContract.vote(proposalId, handle, '0x')
        await tx.wait()
      }
      showToast(tr('Vote cast!', '\u6295\u7968\u5df2\u63d0\u4ea4\uff01'), 'success')
      await loadGovData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Vote failed', '\u6295\u7968\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleFinalize = async (proposalId: number) => {
    if (!govContract) return
    setLoading('finalize-' + proposalId)
    try {
      const tx = await govContract.finalizeProposal(proposalId)
      await tx.wait()
      showToast(tr('Proposal finalized \u2014 results now public', '\u63d0\u6848\u5df2\u7ed3\u7b97\uff0c\u7ed3\u679c\u5df2\u516c\u5f00'), 'success')
      await loadGovData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleDecryptVoteCounts = async (proposalId: number) => {
    if (!govContract || !provider || !fhevmRef.current) { showToast(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'), 'error'); return }
    setLoading('decrypt-' + proposalId)
    try {
      const [encYes, encNo] = await govContract.viewVoteCounts(proposalId)
      const yesHex = ethers.hexlify(encYes)
      const noHex = ethers.hexlify(encNo)
      const signer = await provider.getSigner()
      const yesVal = await userDecryptHandle(fhevmRef.current, yesHex, govContractAddress, signer)
      const noVal = await userDecryptHandle(fhevmRef.current, noHex, govContractAddress, signer)
      showToast(lang === 'zh' ? `\u7ed3\u679c\uff1a\u8d5e\u6210 ${yesVal} / \u53cd\u5bf9 ${noVal}` : `Results: YES ${yesVal} / NO ${noVal}`, 'success')
    } catch (err: unknown) {
      showToast(errorText(err, 'Decrypt failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  // ============ Compliance Handlers ============

  const handleAddAuditor = async () => {
    if (!contract || !ethers.isAddress(auditorAddr)) { showToast(tr('Invalid address', '\u5730\u5740\u65e0\u6548'), 'error'); return }
    setLoading('addAuditor')
    try {
      const tx = await contract.addAuditor(auditorAddr)
      await tx.wait()
      showToast(tr('Auditor added', '\u5ba1\u8ba1\u5458\u5df2\u6dfb\u52a0'), 'success')
      setAuditorAddr('')
      await loadComplianceData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleAddTaxAuthority = async () => {
    if (!contract || !ethers.isAddress(taxAuthAddr)) { showToast(tr('Invalid address', '\u5730\u5740\u65e0\u6548'), 'error'); return }
    setLoading('addTax')
    try {
      const tx = await contract.addTaxAuthority(taxAuthAddr)
      await tx.wait()
      showToast(tr('Tax authority added', '\u7a0e\u52a1\u673a\u5173\u5df2\u6dfb\u52a0'), 'success')
      setTaxAuthAddr('')
      await loadComplianceData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleApplyCompliancePolicy = async () => {
    if (!contract) return
    setLoading('setPolicy')
    try {
      const tx = await contract.configureCompliancePolicy(
        compliancePolicy.employerKyc,
        compliancePolicy.employeeKyc,
        compliancePolicy.employerZk,
        compliancePolicy.employeeZk,
      )
      await tx.wait()
      showToast(tr('Compliance policy updated', '\u5408\u89c4\u7b56\u7565\u5df2\u66f4\u65b0'), 'success')
      await loadComplianceData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleSaveComplianceRecord = async (targetAddress?: string) => {
    if (!contract) return
    const subject = targetAddress || complianceSubject || account || ''
    if (!ethers.isAddress(subject)) { showToast(tr('Enter a valid address to register compliance', '\u8bf7\u8f93\u5165\u6709\u6548\u5730\u5740\u4ee5\u767b\u8bb0\u5408\u89c4\u8bb0\u5f55'), 'error'); return }
    setLoading('setComplianceRecord')
    try {
      const tx = await contract.setComplianceRecord(
        ethers.getAddress(subject),
        complianceApproved,
        commitmentOrZero(kycReference),
        commitmentOrZero(zkReference),
      )
      await tx.wait()
      showToast('Compliance record updated', 'success')
      if (!targetAddress) {
        setComplianceSubject('')
      }
      setKycReference('')
      setZkReference('')
      await loadComplianceData()
      await loadContractData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleSetMinWage = async () => {
    if (!contract) return
    const val = parseInt(minWageInput)
    if (!val || val <= 0) { showToast(tr('Enter valid minimum wage', '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u6700\u4f4e\u5de5\u8d44'), 'error'); return }
    setLoading('setMinWage')
    try {
      const tx = await contract.setMinimumWage(val)
      await tx.wait()
      showToast(lang === 'zh' ? `\u6700\u4f4e\u5de5\u8d44\u5df2\u8bbe\u4e3a ${val}` : 'Minimum wage set to ' + val, 'success')
      setMinWageInput('')
      await loadComplianceData()
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleSolvencyCheck = async () => {
    if (!contract) return
    setLoading('solvency')
    try {
      const tx = await contract.complianceCheck()
      await tx.wait()
      showToast(tr('Solvency check executed. Use decrypt to view result.', '\u507f\u4ed8\u68c0\u67e5\u5df2\u6267\u884c\uff0c\u8bf7\u70b9\u51fb\u89e3\u5bc6\u67e5\u770b\u7ed3\u679c\u3002'), 'success')
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleDecryptSolvency = async () => {
    if (!contract || !provider || !fhevmRef.current) { showToast(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'), 'error'); return }
    setLoading('decryptSolvency')
    try {
      const encHandle = await contract.viewSolvencyResult()
      const handleHex = ethers.hexlify(encHandle)
      const signer = await provider.getSigner()
      // Use userDecrypt for ebool â€” treated as euint8 where 1=true, 0=false
      const { publicKey, privateKey } = fhevmRef.current.generateKeypair()
      const startTimestamp = Math.floor(Date.now() / 1000)
      const eip712 = fhevmRef.current.createEIP712(publicKey, [contractAddress], startTimestamp, 1)
      const signature = await signer.signTypedData(
        eip712.domain as Record<string, unknown>,
        eip712.types as unknown as Record<string, ethers.TypedDataField[]>,
        eip712.message as Record<string, unknown>,
      )
      const results = await fhevmRef.current.userDecrypt(
        [{ handle: handleHex, contractAddress }],
        privateKey, publicKey, signature,
        [contractAddress], await signer.getAddress(), startTimestamp, 1,
      )
      const val = results[handleHex as `0x${string}`]
      showToast(
        val
          ? tr('Company is SOLVENT', '\u516c\u53f8\u507f\u4ed8\u80fd\u529b\u5145\u8db3')
          : tr('Company is INSOLVENT', '\u516c\u53f8\u507f\u4ed8\u80fd\u529b\u4e0d\u8db3'),
        val ? 'success' : 'error',
      )
    } catch (err: unknown) {
      showToast(errorText(err, 'Decrypt failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const decryptBooleanHandle = async (handleSource: Promise<string> | Promise<Uint8Array> | Promise<unknown>) => {
    if (!provider || !fhevmRef.current) {
      throw new Error(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'))
    }

    const signer = await provider.getSigner()
    const handleValue = await handleSource
    const handleHex = ethers.hexlify(handleValue as ethers.BytesLike)
    const { publicKey, privateKey } = fhevmRef.current.generateKeypair()
    const startTimestamp = Math.floor(Date.now() / 1000)
    const eip712 = fhevmRef.current.createEIP712(publicKey, [contractAddress], startTimestamp, 1)
    const signature = await signer.signTypedData(
      eip712.domain as Record<string, unknown>,
      eip712.types as unknown as Record<string, ethers.TypedDataField[]>,
      eip712.message as Record<string, unknown>,
    )
    const results = await fhevmRef.current.userDecrypt(
      [{ handle: handleHex, contractAddress }],
      privateKey, publicKey, signature,
      [contractAddress], await signer.getAddress(), startTimestamp, 1,
    )
    return Boolean(results[handleHex as `0x${string}`])
  }

  const handleVerifyMinWage = async (addr?: string) => {
    if (!contract) return
    setLoading('verifyMinWage')
    try {
      if (addr) {
        const tx = await contract.verifyMinimumWage(addr)
        await tx.wait()
        showToast(lang === 'zh' ? `${addr.slice(0, 8)}... \u7684\u6700\u4f4e\u5de5\u8d44\u6821\u9a8c\u5df2\u5b8c\u6210` : 'Min wage check done for ' + addr.slice(0, 8) + '...', 'success')
      } else {
        const tx = await contract.verifyAllMinimumWage()
        await tx.wait()
        showToast(tr('Batch min wage check done. Decrypt to view.', '\u6279\u91cf\u6700\u4f4e\u5de5\u8d44\u6821\u9a8c\u5df2\u5b8c\u6210\uff0c\u8bf7\u89e3\u5bc6\u67e5\u770b\u3002'), 'success')
      }
    } catch (err: unknown) {
      showToast(errorText(err, 'Failed', '\u64cd\u4f5c\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleDecryptMinWageResult = async () => {
    if (!contract || !provider || !fhevmRef.current) { showToast(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'), 'error'); return }
    if (!ethers.isAddress(minWageCheckAddr)) { showToast(tr('Enter an employee address first', '\u8bf7\u5148\u8f93\u5165\u5458\u5de5\u5730\u5740'), 'error'); return }
    setLoading('decryptMinWage')
    try {
      const result = await decryptBooleanHandle(contract.viewMinWageResult(minWageCheckAddr))
      showToast(
        result
          ? tr('Employee meets minimum wage', '\u8be5\u5458\u5de5\u7b26\u5408\u6700\u4f4e\u5de5\u8d44')
          : tr('Employee is below minimum wage', '\u8be5\u5458\u5de5\u4f4e\u4e8e\u6700\u4f4e\u5de5\u8d44'),
        result ? 'success' : 'error',
      )
    } catch (err: unknown) {
      showToast(errorText(err, 'Decrypt failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleDecryptAllMinWage = async () => {
    if (!contract || !provider || !fhevmRef.current) { showToast(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'), 'error'); return }
    setLoading('decryptAllMinWage')
    try {
      const result = await decryptBooleanHandle(contract.viewAllMinWageResult())
      showToast(
        result
          ? tr('All employees meet minimum wage', '\u6240\u6709\u5458\u5de5\u5747\u7b26\u5408\u6700\u4f4e\u5de5\u8d44')
          : tr('At least one employee is below minimum wage', '\u81f3\u5c11\u6709\u4e00\u540d\u5458\u5de5\u4f4e\u4e8e\u6700\u4f4e\u5de5\u8d44'),
        result ? 'success' : 'error',
      )
    } catch (err: unknown) {
      showToast(errorText(err, 'Decrypt failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

  const handleDecryptTotalExpense = async () => {
    if (!contract || !provider || !fhevmRef.current) { showToast(tr('FHE SDK not ready', 'FHE SDK \u672a\u5c31\u7eea'), 'error'); return }
    setLoading('decryptExpense')
    try {
      let encHandle
      if (isAuditor) encHandle = await contract.viewTotalExpense()
      else if (isTaxAuthority) encHandle = await contract.viewTotalExpenseAsTax()
      else { showToast(tr('Not authorized', '\u65e0\u6743\u9650'), 'error'); return }
      const handleHex = ethers.hexlify(encHandle)
      const signer = await provider.getSigner()
      const value = await userDecryptHandle(fhevmRef.current, handleHex, contractAddress, signer)
      showToast(lang === 'zh' ? `\u603b\u85aa\u8d44\u652f\u51fa\uff1a${value.toString()}` : 'Total payroll expense: ' + value.toString(), 'success')
    } catch (err: unknown) {
      showToast(errorText(err, 'Decrypt failed', '\u89e3\u5bc6\u5931\u8d25'), 'error')
    } finally { setLoading(null) }
  }

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
        <h2 style={{ marginBottom: '0.5rem', fontSize: '1.2rem' }}>{tr('Connect Wallet', '\u8fde\u63a5\u94b1\u5305')}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          {tr('You will be switched to', '\u5c06\u4e3a\u60a8\u5207\u6362\u5230')} <strong style={{ color: 'var(--accent)' }}>{TARGET_NETWORK.chainName}</strong>
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
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{walletDisplayName(w)}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{walletDescription(w)}</div>
              </div>
              {w.available && <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--success)' }}>{tr('Detected', '\u5df2\u68c0\u6d4b')}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // Setup Screen â€” rendered as a function call (not a component) to avoid unmount on re-render
  const renderSetupScreen = () => (
    <div className="card" style={{ maxWidth: '520px', margin: '2rem auto' }}>
      {setupMode === 'choose' && (
        <>
          <h2 style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>{t.getStarted}</h2>
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginBottom: '2rem' }}>
            {t.setupQ}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button className="btn btn-primary" style={{ padding: '1.2rem', fontSize: '1rem', borderRadius: '12px' }}
              onClick={() => setSetupMode('deploy')}>
              {t.asEmployer}
            </button>
            <button className="btn btn-outline" style={{ padding: '1.2rem', fontSize: '1rem', borderRadius: '12px' }}
              onClick={() => setSetupMode('existing')}>
              {t.asEmployee}
            </button>
          </div>
        </>
      )}

      {setupMode === 'deploy' && (
        <>
          <button className="btn btn-outline" style={{ marginBottom: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setSetupMode('choose')}>
            {t.back}
          </button>
          <h2 style={{ marginBottom: '0.5rem' }}>{t.createPayroll}</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            {t.createPayrollDesc}
          </p>
          <div className="input-group">
            <label>{t.coName}</label>
            <input
              type="text"
              placeholder={t.coNamePh}
              value={deployCompanyName}
              onChange={e => setDeployCompanyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDeployNewPayroll() }}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}
            onClick={handleDeployNewPayroll}
            disabled={loading === 'deploy' || !deployCompanyName.trim()}>
            {loading === 'deploy' ? <><span className="loading"></span>{t.deploying}</> : t.deployBtn}
          </button>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
            {lang === 'zh'
              ? `\u8fd9\u5c06\u5728 ${TARGET_NETWORK.chainName} \u4e0a\u53d1\u9001\u4ea4\u6613`
              : `This sends a transaction on ${TARGET_NETWORK.chainName}`}
          </p>
        </>
      )}

      {setupMode === 'existing' && (
        <>
          <button className="btn btn-outline" style={{ marginBottom: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setSetupMode('choose')}>
            {t.back}
          </button>
          <h2 style={{ marginBottom: '0.5rem' }}>{t.connectExisting}</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            {t.connectExistingDesc}
          </p>
          <div className="input-group">
            <label>{t.contractAddr}</label>
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
            {t.connect}
          </button>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
            {lang === 'zh'
              ? `\u793a\u4f8b\u5408\u7ea6\uff08Zama Corp\uff09\uff1a 0x6dF4438C80D908B450a214eEF2A8DAAC748936AE`
              : 'Demo contract (Zama Corp): 0x6dF4438C80D908B450a214eEF2A8DAAC748936AE'}
          </p>
        </>
      )}
    </div>
  )

  // Not Connected
  if (!account) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-brand">CONFIDENTIAL <span>PAYROLL CONSOLE</span></div>
          <div className="topbar-meta">
            <button className="btn btn-ghost lang-btn" onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}>{t.langBtn}</button>
            <a className="btn btn-dark" href="https://docs.zama.org/protocol" target="_blank" rel="noreferrer">{t.docs}</a>
          </div>
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">{t.eyebrow}</span>
            <h1 className="hero-title">{t.heroTitle}</h1>
            <div className="hero-actions">
              <button className="btn btn-light" onClick={openWalletModal} disabled={loading === 'connect'}>
                {loading === 'connect' ? <><span className="loading"></span>{t.connecting}</> : t.openConsole}
              </button>
              <a className="btn btn-dark" href="https://docs.zama.org/protocol" target="_blank" rel="noreferrer">{t.protocolDocs}</a>
            </div>
            <div className="chip-row">
              <span className="chip">{t.chip1}</span>
              <span className="chip">{t.chip2}</span>
              <span className="chip">{t.chip3}</span>
              <span className="chip">{t.chip4}</span>
            </div>
          </div>

          <div className="fhe-showcase">
            <div className="fhe-showcase-hd">
              <span className="fhe-showcase-title">{t.showcaseTitle}</span>
              <span className="fhe-live-dot"></span>
            </div>
            <div className="fhe-data-rows">
              {([
                { key: t.showcaseSalary, fill: '76%', type: 'euint64' },
                { key: t.showcaseTreasury, fill: '58%', type: 'euint64' },
                { key: t.showcaseVote, fill: '40%', type: 'euint8' },
              ] as { key: string; fill: string; type: string }[]).map(row => (
                <div key={row.key} className="fhe-data-row">
                  <span className="fhe-data-key">{row.key}</span>
                  <div className="fhe-data-bar">
                    <div className="fhe-data-bar-fill" style={{ width: row.fill }}></div>
                  </div>
                  <span className="fhe-data-type">{row.type}</span>
                </div>
              ))}
            </div>
            <div className="fhe-status-rows">
              <div className="fhe-status-row"><span className="fhe-status-indicator"></span>{t.showcaseStatus1}</div>
              <div className="fhe-status-row"><span className="fhe-status-indicator"></span>{t.showcaseStatus2}</div>
              <div className="fhe-status-row"><span className="fhe-status-indicator"></span>{t.showcaseStatus3}</div>
            </div>
          </div>
        </section>

        {showWalletModal && <WalletModal />}
      </div>
    )
  }
  // Connected but no contract configured
  if (showSetup || !contractAddress) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-brand">CONFIDENTIAL <span>PAYROLL CONSOLE</span></div>
          <div className="topbar-meta">
            <span className="topbar-account">{shortAddr(account)}</span>
            <button className="btn btn-ghost lang-btn" onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}>{t.langBtn}</button>
            <button className="btn btn-ghost" onClick={handleDisconnect}>{t.switchWallet}</button>
          </div>
        </header>

        <div className="network-ribbon">
          <div>
            <strong>{t.runtime}</strong>
            <span>{networkName || TARGET_NETWORK.chainName}</span>
          </div>
          <div>
            <strong>{t.relayer}</strong>
            <span>{TESTNET_RUNTIME.relayerUrl.replace('https://', '')}</span>
          </div>
          <div>
            <strong>{t.mode}</strong>
            <span>{TARGET_NETWORK.chainId === ZAMA_NETWORK.chainId ? t.liveFlow : t.localFlow}</span>
          </div>
        </div>

        {renderSetupScreen()}
        {toast && <div className={'toast toast-' + toast.type}>{toast.msg}</div>}
      </div>
    )
  }

  // Main Dashboard
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">CONFIDENTIAL <span>PAYROLL CONSOLE</span></div>
        <div className="topbar-meta">
          <span className="topbar-account">{shortAddr(account)}</span>
          <button className="btn btn-ghost lang-btn" onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}>{t.langBtn}</button>
          <button className="btn btn-ghost" onClick={handleClearContract}>{t.changeContract}</button>
          <button className="btn btn-ghost" onClick={handleDisconnect}>{t.switchWallet}</button>
        </div>
      </header>

      <section className="hero-panel hero-panel--dashboard">
        <div className="hero-copy">
          <span className="eyebrow">{networkName || TARGET_NETWORK.chainName} &middot; {fhevmRef.current ? t.fheLive : t.sepoliaOnly}</span>
          <h1 className="hero-title">{companyName || tr('Payroll Console', '\u85aa\u8d44\u63a7\u5236\u53f0')}</h1>
          <div className="chip-row">
            {isEmployer && <span className="chip">{t.employer}</span>}
            {isEmployee && <span className="chip">{t.employee}</span>}
            {isAdmin && <span className="chip">{t.govAdmin}</span>}
            {isBoardMember && <span className="chip">{t.board}</span>}
            {isAuditor && <span className="chip">{t.auditor}</span>}
            {isTaxAuthority && <span className="chip">{t.taxAuth}</span>}
            {advancedComplianceSupported && (compliancePolicy.employerKyc || compliancePolicy.employeeKyc || compliancePolicy.employerZk || compliancePolicy.employeeZk) && (
              <span className="chip">{t.regulatedMode}</span>
            )}
          </div>
        </div>
      </section>

      <div className="network-ribbon">
        <div>
          <strong>{t.account}</strong>
          <span>{shortAddr(account)}</span>
        </div>
        <div>
          <strong>{t.proofMode}</strong>
          <span>{fhevmRef.current
            ? tr('Zama relayer + inputProof live', 'Zama \u4e2d\u7ee7\u5668 + inputProof \u5b9e\u65f6')
            : tr('Mock/local fallback', '\u672c\u5730 Mock \u56de\u9000')}</span>
        </div>
        <div>
          <strong>{t.kycPolicy}</strong>
          <span>
            {advancedComplianceSupported
              ? (compliancePolicy.employerKyc || compliancePolicy.employeeKyc ? t.kycGated : t.kycOptional) + ' \u00b7 ' + (compliancePolicy.employerZk || compliancePolicy.employeeZk ? t.attestGated : t.attestOptional)
              : t.legacyContract}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-strip">
        {(['payroll', 'governance', 'compliance'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={'tab-button' + (activeTab === tab ? ' tab-button--active' : '')}>
            {tab === 'payroll' ? t.tabPayroll : tab === 'governance' ? t.tabGov : t.tabCompliance}
          </button>
        ))}
      </div>

      {/* ========== PAYROLL TAB ========== */}
      {activeTab === 'payroll' && <>

      {/* Employer Dashboard */}
      {isEmployer && (
        <>
          <div className="card">
            <h2>{tr('Treasury', '\u8d44\u91d1\u6c60')}</h2>
            <div className="info-row">
              <span className="info-label">{tr('Treasury Balance', '\u8d44\u91d1\u6c60\u4f59\u989d')}</span>
              <span className="encrypted-value">[Encrypted]</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <input type="number" placeholder={tr('Amount to deposit', '\u5b58\u5165\u91d1\u989d')} value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
              <button className="btn btn-primary" onClick={handleDeposit} disabled={loading === 'deposit'}>
                {loading === 'deposit' ? <><span className="loading"></span>{tr('Depositing...', '\u5b58\u5165\u4e2d\u2026')}</> : tr('Deposit', '\u5b58\u5165')}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>{tr('Add Employee', '\u6dfb\u52a0\u5458\u5de5')}</h2>
            <div className="input-group">
              <label>{tr('Employee Wallet Address', '\u5458\u5de5\u94b1\u5305\u5730\u5740')}</label>
              <input type="text" placeholder="0x..." value={newEmpAddress} onChange={e => setNewEmpAddress(e.target.value)} />
            </div>
            <div className="input-group">
              <label>{tr('Monthly Salary (encrypted on-chain \u2014 only the employee can decrypt)', '\u6708\u85aa\uff08\u94fe\u4e0a\u52a0\u5bc6\uff0c\u4ec5\u8be5\u5458\u5de5\u53ef\u89e3\u5bc6\uff09')}</label>
              <input type="number" placeholder="5000" value={newEmpSalary} onChange={e => setNewEmpSalary(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleAddEmployee} disabled={loading === 'addEmployee'}>
              {loading === 'addEmployee' ? <><span className="loading"></span>{tr('Adding...', '\u6dfb\u52a0\u4e2d\u2026')}</> : tr('+ Add Employee', '+ \u6dfb\u52a0\u5458\u5de5')}
            </button>
          </div>

          <div className="card">
            <h2>{tr('Employee List', '\u5458\u5de5\u5217\u8868')}</h2>
            {employees.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem' }}>{tr('No employees yet \u2014 add one above', '\u8fd8\u6ca1\u6709\u5458\u5de5\uff0c\u8bf7\u5148\u5728\u4e0a\u65b9\u6dfb\u52a0')}</p>
            ) : (
              <table>
                <thead><tr><th>{tr('Address', '\u5730\u5740')}</th><th>{tr('Salary', '\u85aa\u8d44')}</th><th>{tr('Status', '\u72b6\u6001')}</th><th>{tr('Actions', '\u64cd\u4f5c')}</th></tr></thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp}>
                      <td title={emp}>{shortAddr(emp)}</td>
                      <td><span className="encrypted-value">[Encrypted]</span></td>
                      <td>
                        <span className={'status-dot ' + (paidStatus[emp] ? 'paid' : 'unpaid')}></span>
                        {paidStatus[emp] ? tr('Paid', '\u5df2\u652f\u4ed8') : tr('Unpaid', '\u672a\u652f\u4ed8')}
                      </td>
                      <td>
                        <button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                          onClick={() => handleRemoveEmployee(emp)}>{tr('Remove', '\u79fb\u9664')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button className="btn btn-success" onClick={handleExecutePay} disabled={loading === 'pay' || employees.length === 0}>
                {loading === 'pay' ? <><span className="loading"></span>{tr('Processing...', '\u5904\u7406\u4e2d\u2026')}</> : tr('Execute Payroll', '\u6267\u884c\u53d1\u85aa')}
              </button>
              <button className="btn btn-outline" onClick={handleResetCycle} disabled={loading === 'reset'}>
                {tr('Reset Cycle', '\u91cd\u7f6e\u5468\u671f')}
              </button>
            </div>
          </div>

          {/* Share with employees */}
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>{tr('Share with Employees', '\u5206\u4eab\u7ed9\u5458\u5de5')}</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {tr('Send this contract address to your employees. They paste it on the setup screen after connecting their wallet.', '\u628a\u8fd9\u4e2a\u5408\u7ea6\u5730\u5740\u53d1\u7ed9\u5458\u5de5\uff0c\u4ed6\u4eec\u8fde\u63a5\u94b1\u5305\u540e\u5728\u8bbe\u7f6e\u9875\u7c98\u8d34\u5373\u53ef\u52a0\u5165\u3002')}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', borderRadius: '6px', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                {contractAddress}
              </code>
              <button className="btn btn-outline" style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}
                onClick={() => { navigator.clipboard.writeText(contractAddress); showToast(tr('Copied!', '\u5df2\u590d\u5236\uff01'), 'success') }}>
                {tr('Copy', '\u590d\u5236')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Employee Dashboard */}
      {isEmployee && (
        <div className="card">
          <h2>{tr('My Payroll', '\u6211\u7684\u85aa\u8d44')}</h2>
          <div className="info-row">
            <span className="info-label">{tr('My Salary', '\u6211\u7684\u85aa\u8d44')}</span>
            {mySalary !== null
              ? <span className="info-value">{mySalary.toString()} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{tr('units', '\u5355\u4f4d')}</span></span>
              : <span className="encrypted-value">[Encrypted] </span>}
          </div>
          <div className="info-row">
            <span className="info-label">{tr('My Balance', '\u6211\u7684\u4f59\u989d')}</span>
            {myBalance !== null
              ? <span className="info-value">{myBalance.toString()} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{tr('units', '\u5355\u4f4d')}</span></span>
              : <span className="encrypted-value">[Encrypted] </span>}
          </div>
          <div className="info-row">
            <span className="info-label">{tr('This Cycle', '\u672c\u5468\u671f')}</span>
            <span>{paidStatus[account] ? tr('Paid', '\u5df2\u652f\u4ed8') : tr('Pending', '\u5f85\u652f\u4ed8')}</span>
          </div>
          {!fhevmRef.current && (
            <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              {tr('FHE SDK not ready \u2014 connect on Sepolia to decrypt values', 'FHE SDK \u672a\u5c31\u7eea\uff0c\u8bf7\u8fde\u63a5 Sepolia \u540e\u518d\u89e3\u5bc6')}
            </p>
          )}
          <div className="actions">
            <button className="btn btn-primary" onClick={handleViewSalary} disabled={loading === 'viewSalary'}>
              {loading === 'viewSalary' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Salary', '\u89e3\u5bc6\u85aa\u8d44')}
            </button>
            <button className="btn btn-outline" onClick={handleViewBalance} disabled={loading === 'viewBalance'}>
              {loading === 'viewBalance' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Balance', '\u89e3\u5bc6\u4f59\u989d')}
            </button>
            <button className="btn btn-success" onClick={handleWithdraw} disabled={loading === 'withdraw'}>
              {loading === 'withdraw' ? <><span className="loading"></span>{tr('Processing...', '\u5904\u7406\u4e2d\u2026')}</> : tr('Withdraw', '\u63d0\u53d6')}
            </button>
          </div>
        </div>
      )}

      {/* Access Restricted */}
      {!isEmployer && !isEmployee && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="lock-icon">LOCK</div>
          <h2 style={{ justifyContent: 'center' }}>{tr('Access Restricted', '\u8bbf\u95ee\u53d7\u9650')}</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>
            {lang === 'zh'
              ? `\u60a8\u7684\u5730\u5740\uff08${shortAddr(account)}\uff09\u4e0d\u662f\u8be5\u5408\u7ea6\u7684\u96c7\u4e3b\u6216\u5458\u5de5\u3002`
              : `Your address (${shortAddr(account)}) is not the employer or an employee of this contract.`}
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '2rem' }}>
            {tr('Contract', '\u5408\u7ea6')}: {shortAddr(contractAddress)}
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={handleClearContract}>
              {tr('Use a Different Contract', '\u4f7f\u7528\u5176\u4ed6\u5408\u7ea6')}
            </button>
            <button className="btn btn-primary" onClick={() => { localStorage.removeItem(LS_CONTRACT_KEY); setContractAddress(''); setContract(null); setIsEmployer(false); setIsEmployee(false); setCompanyName(''); setEmployees([]); setExistingAddrInput(''); setDeployCompanyName(''); setSetupMode('deploy'); setShowSetup(true); }}>
              {tr('Deploy My Own Payroll', '\u90e8\u7f72\u6211\u81ea\u5df1\u7684\u85aa\u8d44\u5408\u7ea6')}
            </button>
          </div>
        </div>
      )}

      </>}

      {/* ========== GOVERNANCE TAB ========== */}
      {activeTab === 'governance' && <>
        {!govContractAddress ? (
          <div className="card" style={{ maxWidth: '520px', margin: '2rem auto' }}>
            <h2>{tr('Board Governance', '\u8463\u4e8b\u4f1a\u6cbb\u7406')}</h2>
            <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>{tr('Deploy a new governance contract or connect to an existing one.', '\u90e8\u7f72\u65b0\u7684\u6cbb\u7406\u5408\u7ea6\uff0c\u6216\u8fde\u63a5\u5df2\u6709\u5408\u7ea6\u3002')}</p>
            <div className="input-group">
              <label>{tr('Organization Name', '\u7ec4\u7ec7\u540d\u79f0')}</label>
              <input type="text" placeholder={tr('e.g. Zama Corp Board', '\u4f8b\u5982\uff1aZama Corp Board')} value={deployGovOrgName} onChange={e => setDeployGovOrgName(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }}
              onClick={handleDeployGov} disabled={loading === 'deployGov' || !deployGovOrgName.trim()}>
              {loading === 'deployGov' ? <><span className="loading"></span>{tr('Deploying...', '\u90e8\u7f72\u4e2d\u2026')}</> : tr('Deploy Governance Contract', '\u90e8\u7f72\u6cbb\u7406\u5408\u7ea6')}
            </button>
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
            <div className="input-group">
              <label>{tr('Or Enter Existing Contract Address', '\u6216\u8f93\u5165\u5df2\u6709\u5408\u7ea6\u5730\u5740')}</label>
              <input type="text" placeholder="0x..." onKeyDown={e => { if (e.key === 'Enter') handleConnectGov((e.target as HTMLInputElement).value) }}
                onChange={e => { if (ethers.isAddress(e.target.value)) handleConnectGov(e.target.value) }} />
            </div>
          </div>
        ) : (
          <>
            <div className="card" style={{ borderColor: 'var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>{govOrgName || tr('Governance', '\u6cbb\u7406')}</h2>
                <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={handleClearGov}>{t.changeContract}</button>
              </div>
              <div className="info-row">
                <span className="info-label">{tr('Contract', '\u5408\u7ea6')}</span>
                <span style={{ fontSize: '0.85rem' }}>{shortAddr(govContractAddress)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{tr('Board Members', '\u8463\u4e8b\u6210\u5458')}</span>
                <span>{boardMembers.length}</span>
              </div>
              <div className="info-row">
                <span className="info-label">{tr('Proposals', '\u63d0\u6848')}</span>
                <span>{proposals.length}</span>
              </div>
            </div>

            {/* Admin: manage board */}
            {isAdmin && (
              <div className="card">
                <h2>{tr('Board Management', '\u8463\u4e8b\u4f1a\u7ba1\u7406')}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input type="text" placeholder={tr('Board member address 0x...', '\u8463\u4e8b\u6210\u5458\u5730\u5740 0x...')} value={newMemberAddr}
                    onChange={e => setNewMemberAddr(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
                  <button className="btn btn-primary" onClick={handleAddBoardMember} disabled={loading === 'addMember'}>
                    {loading === 'addMember' ? <span className="loading"></span> : tr('+ Add', '+ \u6dfb\u52a0')}
                  </button>
                </div>
                {boardMembers.length > 0 && (
                  <table>
                    <thead><tr><th>{tr('Member', '\u6210\u5458')}</th><th>{tr('Actions', '\u64cd\u4f5c')}</th></tr></thead>
                    <tbody>
                      {boardMembers.map(m => (
                        <tr key={m}>
                          <td title={m}>{shortAddr(m)}</td>
                          <td><button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={() => handleRemoveBoardMember(m)}>{tr('Remove', '\u79fb\u9664')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Admin: create proposal */}
            {isAdmin && (
              <div className="card">
                <h2>{tr('Create Proposal', '\u521b\u5efa\u63d0\u6848')}</h2>
                <div className="input-group">
                  <label>{tr('Title', '\u6807\u9898')}</label>
                  <input type="text" placeholder={tr('e.g. Increase Q2 Budget', '\u4f8b\u5982\uff1a\u63d0\u9ad8 Q2 \u9884\u7b97')} value={proposalTitle} onChange={e => setProposalTitle(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{tr('Description', '\u63cf\u8ff0')}</label>
                  <input type="text" placeholder={tr('Details of the proposal...', '\u586b\u5199\u63d0\u6848\u8be6\u60c5...')} value={proposalDesc} onChange={e => setProposalDesc(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{tr('Voting Duration (seconds)', '\u6295\u7968\u65f6\u957f\uff08\u79d2\uff09')}</label>
                  <input type="number" placeholder={tr('3600 = 1 hour', '3600 = 1 \u5c0f\u65f6')} value={proposalDuration} onChange={e => setProposalDuration(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={handleCreateProposal} disabled={loading === 'createProposal'}>
                  {loading === 'createProposal' ? <><span className="loading"></span>{tr('Creating...', '\u521b\u5efa\u4e2d\u2026')}</> : tr('+ Create Proposal', '+ \u521b\u5efa\u63d0\u6848')}
                </button>
              </div>
            )}

            {/* Proposals list */}
            <div className="card">
              <h2>{lang === 'zh' ? `\u63d0\u6848 (${proposals.length})` : `Proposals (${proposals.length})`}</h2>
              {proposals.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem' }}>{tr('No proposals yet', '\u8fd8\u6ca1\u6709\u63d0\u6848')}</p>
              ) : proposals.map(p => {
                const now = Math.floor(Date.now() / 1000)
                const isActive = now >= p.startTime && now <= p.endTime && !p.isFinalized
                const isEnded = now > p.endTime
                const hasUserVoted = false // we check on-chain below
                return (
                  <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem', marginBottom: '0.75rem', background: 'var(--bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong>#{p.id}: {p.title}</strong>
                      <span className={'badge ' + (p.isFinalized ? 'badge-employer' : isActive ? 'badge-employee' : 'badge-encrypted')}>
                        {p.isFinalized
                          ? tr('Finalized', '\u5df2\u5b8c\u6210')
                          : isActive
                            ? tr('Active', '\u8fdb\u884c\u4e2d')
                            : isEnded
                              ? tr('Ended', '\u5df2\u7ed3\u675f')
                              : tr('Pending', '\u5f85\u5f00\u59cb')}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{p.description}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                      <span>{tr('Voters', '\u6295\u7968\u4eba')}: {p.voterCount}</span>
                      <span>&middot;</span>
                      <span>{tr('Ends', '\u622a\u6b62\u65f6\u95f4')}: {new Date(p.endTime * 1000).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {isActive && isBoardMember && (
                        <>
                          <button className="btn btn-success" style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                            onClick={() => handleVote(p.id, true)} disabled={loading === 'vote-' + p.id}>
                            {loading === 'vote-' + p.id ? <span className="loading"></span> : tr('Vote YES', '\u6295\u8d5e\u6210')}
                          </button>
                          <button className="btn btn-danger" style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                            onClick={() => handleVote(p.id, false)} disabled={loading === 'vote-' + p.id}>
                            {loading === 'vote-' + p.id ? <span className="loading"></span> : tr('Vote NO', '\u6295\u53cd\u5bf9')}
                          </button>
                        </>
                      )}
                      {isEnded && !p.isFinalized && isAdmin && (
                        <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                          onClick={() => handleFinalize(p.id)} disabled={loading === 'finalize-' + p.id}>
                          {loading === 'finalize-' + p.id ? <span className="loading"></span> : tr('Finalize', '\u5b8c\u6210\u7ed3\u7b97')}
                        </button>
                      )}
                      {(p.isFinalized || isAdmin) && (
                        <button className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                          onClick={() => handleDecryptVoteCounts(p.id)} disabled={loading === 'decrypt-' + p.id}>
                          {loading === 'decrypt-' + p.id ? <span className="loading"></span> : tr('Decrypt Results', '\u89e3\u5bc6\u7ed3\u679c')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Share governance contract */}
            <div className="card" style={{ borderColor: 'var(--accent)' }}>
              <h2>{tr('Share with Board Members', '\u5206\u4eab\u7ed9\u8463\u4e8b\u6210\u5458')}</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                {tr('Share this governance contract address with board members.', '\u628a\u8fd9\u4e2a\u6cbb\u7406\u5408\u7ea6\u5730\u5740\u5206\u4eab\u7ed9\u8463\u4e8b\u6210\u5458\u3002')}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', borderRadius: '6px', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                  {govContractAddress}
                </code>
                <button className="btn btn-outline" style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}
                  onClick={() => { navigator.clipboard.writeText(govContractAddress); showToast(tr('Copied!', '\u5df2\u590d\u5236\uff01'), 'success') }}>
                  {tr('Copy', '\u590d\u5236')}
                </button>
              </div>
            </div>
          </>
        )}
      </>}

      {/* ========== COMPLIANCE TAB ========== */}
      {activeTab === 'compliance' && <>
        {!contractAddress ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--text-dim)' }}>{tr('Connect to a payroll contract first (Payroll tab \u2192 Setup)', '\u8bf7\u5148\u8fde\u63a5\u4e00\u4e2a\u85aa\u8d44\u5408\u7ea6\uff08\u5728\u201c\u85aa\u8d44\u201d tab \u4e2d\u8fdb\u5165\u8bbe\u7f6e\uff09')}</p>
          </div>
        ) : (
          <>
            {/* Employer: Role Management */}
            {isEmployer && (
              <>
              <div className="card card-highlight">
                <h2>{tr('Compliance Policy', '\u5408\u89c4\u7b56\u7565')}</h2>
                <p className="card-copy">
                  {tr('Zama already secures encrypted payroll inputs with input proofs on Sepolia. The policy below adds an optional business layer: KYC approval and ZK/KYC attestation commitments for employer and employee actions.', 'Zama \u5df2\u5728 Sepolia \u4e0a\u7528 input proofs \u4fdd\u62a4\u52a0\u5bc6\u85aa\u8d44\u8f93\u5165\u3002\u4e0b\u9762\u7684\u7b56\u7565\u518d\u53e0\u52a0\u4e00\u5c42\u53ef\u9009\u7684\u4e1a\u52a1\u5408\u89c4\u89c4\u5219\uff1a\u5bf9\u96c7\u4e3b\u548c\u5458\u5de5\u884c\u4e3a\u589e\u52a0 KYC \u5ba1\u6279\u4e0e ZK/KYC \u627f\u8bfa\u6821\u9a8c\u3002')}
                </p>
                {!advancedComplianceSupported ? (
                  <div className="info-row">
                    <span className="info-label">{tr('Advanced policy support', '\u9ad8\u7ea7\u7b56\u7565\u652f\u6301')}</span>
                    <span className="info-value">{tr('Deploy the latest payroll contract to use optional KYC / attestation gating', '\u8bf7\u90e8\u7f72\u6700\u65b0\u7248\u85aa\u8d44\u5408\u7ea6\uff0c\u4ee5\u542f\u7528\u53ef\u9009 KYC / \u8bc1\u660e\u95e8\u63a7')}</span>
                  </div>
                ) : (
                  <>
                    <div className="toggle-grid">
                      <label className="toggle-row">
                        <input type="checkbox" checked={compliancePolicy.employerKyc} onChange={e => setCompliancePolicy(prev => ({ ...prev, employerKyc: e.target.checked }))} />
                        <span>{tr('Require employer KYC before regulated actions', '\u76d1\u7ba1\u64cd\u4f5c\u524d\u9700\u96c7\u4e3b KYC')}</span>
                      </label>
                      <label className="toggle-row">
                        <input type="checkbox" checked={compliancePolicy.employeeKyc} onChange={e => setCompliancePolicy(prev => ({ ...prev, employeeKyc: e.target.checked }))} />
                        <span>{tr('Require employee KYC before onboarding and payroll access', '\u5458\u5de5\u5165\u804c\u548c\u8bbf\u95ee\u85aa\u8d44\u524d\u9700\u901a\u8fc7 KYC')}</span>
                      </label>
                      <label className="toggle-row">
                        <input type="checkbox" checked={compliancePolicy.employerZk} onChange={e => setCompliancePolicy(prev => ({ ...prev, employerZk: e.target.checked }))} />
                        <span>{tr('Require employer attestation commitment', '\u9700\u96c7\u4e3b\u63d0\u4ea4\u8bc1\u660e\u627f\u8bfa')}</span>
                      </label>
                      <label className="toggle-row">
                        <input type="checkbox" checked={compliancePolicy.employeeZk} onChange={e => setCompliancePolicy(prev => ({ ...prev, employeeZk: e.target.checked }))} />
                        <span>{tr('Require employee attestation commitment', '\u9700\u5458\u5de5\u63d0\u4ea4\u8bc1\u660e\u627f\u8bfa')}</span>
                      </label>
                    </div>
                    <div className="actions">
                      <button className="btn btn-outline" onClick={() => setCompliancePolicy(DEFAULT_COMPLIANCE_POLICY)}>{tr('Open Mode Preset', '\u5f00\u653e\u6a21\u5f0f\u9884\u8bbe')}</button>
                      <button className="btn btn-outline" onClick={() => setCompliancePolicy({ employerKyc: true, employeeKyc: true, employerZk: true, employeeZk: true })}>{tr('Regulated Mode Preset', '\u76d1\u7ba1\u6a21\u5f0f\u9884\u8bbe')}</button>
                      <button className="btn btn-primary" onClick={handleApplyCompliancePolicy} disabled={loading === 'setPolicy'}>
                        {loading === 'setPolicy' ? <><span className="loading"></span>{tr('Applying...', '\u5e94\u7528\u4e2d\u2026')}</> : tr('Apply Policy', '\u5e94\u7528\u7b56\u7565')}
                      </button>
                    </div>
                  </>
                )}
                {myComplianceRecord && (
                  <div className="policy-record">
                    <div>
                      <span className="summary-label">{tr('Current wallet compliance', '\u5f53\u524d\u94b1\u5305\u5408\u89c4\u72b6\u6001')}</span>
                      <strong className="summary-value">{myComplianceRecord.approved ? tr('Approved', '\u5df2\u901a\u8fc7') : tr('Not approved', '\u672a\u901a\u8fc7')}</strong>
                    </div>
                    <div>
                      <span className="summary-label">{tr('KYC commitment', 'KYC \u627f\u8bfa')}</span>
                      <strong className="mono-value">{myComplianceRecord.kycHash === ethers.ZeroHash ? tr('Not set', '\u672a\u8bbe\u7f6e') : shortAddr(myComplianceRecord.kycHash)}</strong>
                    </div>
                    <div>
                      <span className="summary-label">{tr('Attestation', '\u8bc1\u660e')}</span>
                      <strong className="mono-value">{myComplianceRecord.zkHash === ethers.ZeroHash ? tr('Not set', '\u672a\u8bbe\u7f6e') : shortAddr(myComplianceRecord.zkHash)}</strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="card">
                <h2>{tr('KYC / Attestation Registry', 'KYC / \u8bc1\u660e\u767b\u8bb0')}</h2>
                <p className="card-copy">
                  {tr('Store only commitments onchain. You can paste a bytes32 digest directly, or enter a plain reference string and the UI will hash it before submission.', '\u94fe\u4e0a\u4ec5\u5b58\u50a8\u627f\u8bfa\u503c\u3002\u60a8\u53ef\u4ee5\u76f4\u63a5\u7c98\u8d34 bytes32 \u6458\u8981\uff0c\u6216\u8f93\u5165\u666e\u901a\u5f15\u7528\u5b57\u7b26\u4e32\uff0cUI \u4f1a\u5728\u63d0\u4ea4\u524d\u81ea\u52a8 hash\u3002')}
                </p>
                <div className="input-group">
                  <label>{tr('Subject Address', '\u76ee\u6807\u5730\u5740')}</label>
                  <input type="text" placeholder="0x..." value={complianceSubject} onChange={e => setComplianceSubject(e.target.value)} />
                </div>
                <div className="toggle-grid toggle-grid--compact">
                  <label className="toggle-row">
                    <input type="checkbox" checked={complianceApproved} onChange={e => setComplianceApproved(e.target.checked)} />
                    <span>{tr('Mark subject as KYC approved', '\u5c06\u8be5\u4e3b\u4f53\u6807\u8bb0\u4e3a KYC \u5df2\u901a\u8fc7')}</span>
                  </label>
                </div>
                <div className="input-group">
                  <label>{tr('KYC Commitment or Reference', 'KYC \u627f\u8bfa\u6216\u5f15\u7528')}</label>
                  <input type="text" placeholder={tr('passport-hash / bytes32 / ref-id', 'passport-hash / bytes32 / ref-id')} value={kycReference} onChange={e => setKycReference(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{tr('ZK / Attestation Commitment or Reference', 'ZK / \u8bc1\u660e\u627f\u8bfa\u6216\u5f15\u7528')}</label>
                  <input type="text" placeholder={tr('zk-proof-digest / attestation-id / bytes32', 'zk-proof-digest / attestation-id / bytes32')} value={zkReference} onChange={e => setZkReference(e.target.value)} />
                </div>
                <div className="actions">
                  <button className="btn btn-outline" onClick={() => { setComplianceSubject(account); setComplianceApproved(true) }}>{tr('Use My Wallet', '\u4f7f\u7528\u6211\u7684\u94b1\u5305')}</button>
                  <button className="btn btn-primary" onClick={() => handleSaveComplianceRecord()} disabled={loading === 'setComplianceRecord'}>
                    {loading === 'setComplianceRecord' ? <><span className="loading"></span>{tr('Saving...', '\u4fdd\u5b58\u4e2d\u2026')}</> : tr('Save Compliance Record', '\u4fdd\u5b58\u5408\u89c4\u8bb0\u5f55')}
                  </button>
                </div>
              </div>

              <div className="card">
                <h2>{tr('Role Management', '\u89d2\u8272\u7ba1\u7406')}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input type="text" placeholder={tr('Auditor address 0x...', '\u5ba1\u8ba1\u5458\u5730\u5740 0x...')} value={auditorAddr}
                    onChange={e => setAuditorAddr(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
                  <button className="btn btn-primary" onClick={handleAddAuditor} disabled={loading === 'addAuditor'}>
                    {loading === 'addAuditor' ? <span className="loading"></span> : tr('+ Auditor', '+ \u5ba1\u8ba1\u5458')}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input type="text" placeholder={tr('Tax authority address 0x...', '\u7a0e\u52a1\u673a\u5173\u5730\u5740 0x...')} value={taxAuthAddr}
                    onChange={e => setTaxAuthAddr(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
                  <button className="btn btn-primary" onClick={handleAddTaxAuthority} disabled={loading === 'addTax'}>
                    {loading === 'addTax' ? <span className="loading"></span> : tr('+ Tax Authority', '+ \u7a0e\u52a1\u673a\u5173')}
                  </button>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>{tr('Minimum Wage', '\u6700\u4f4e\u5de5\u8d44')}</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="number" placeholder={tr('Set minimum wage', '\u8bbe\u7f6e\u6700\u4f4e\u5de5\u8d44')} value={minWageInput}
                    onChange={e => setMinWageInput(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
                  <button className="btn btn-primary" onClick={handleSetMinWage} disabled={loading === 'setMinWage'}>
                    {loading === 'setMinWage' ? <span className="loading"></span> : tr('Set', '\u8bbe\u7f6e')}
                  </button>
                </div>
                <div className="summary-grid summary-grid--mini" style={{ marginTop: '1rem' }}>
                  <article className="summary-card">
                    <span className="summary-label">{tr('Minimum wage', '\u6700\u4f4e\u5de5\u8d44')}</span>
                    <strong className="summary-value">{minimumWageValue || tr('Not set', '\u672a\u8bbe\u7f6e')}</strong>
                  </article>
                  <article className="summary-card">
                    <span className="summary-label">{tr('Auditors', '\u5ba1\u8ba1\u5458')}</span>
                    <strong className="summary-value">{auditors.length}</strong>
                    <p>{auditors.length ? auditors.map(shortAddr).join(', ') : tr('No auditors assigned', '\u6682\u65e0\u5ba1\u8ba1\u5458')}</p>
                  </article>
                  <article className="summary-card">
                    <span className="summary-label">{tr('Tax authorities', '\u7a0e\u52a1\u673a\u5173')}</span>
                    <strong className="summary-value">{taxAuthorities.length}</strong>
                    <p>{taxAuthorities.length ? taxAuthorities.map(shortAddr).join(', ') : tr('No tax authorities assigned', '\u6682\u65e0\u7a0e\u52a1\u673a\u5173')}</p>
                  </article>
                </div>
              </div>
              </>
            )}

            {/* Auditor Panel */}
            {isAuditor && (
              <div className="card">
                <h2>{tr('Auditor Panel', '\u5ba1\u8ba1\u9762\u677f')}</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  {tr('As an auditor, you can view encrypted aggregates and check solvency without seeing individual salaries.', '\u4f5c\u4e3a\u5ba1\u8ba1\u5458\uff0c\u60a8\u53ef\u4ee5\u67e5\u770b\u52a0\u5bc6\u6c47\u603b\u6570\u636e\uff0c\u5e76\u5728\u4e0d\u66b4\u9732\u4e2a\u4eba\u85aa\u8d44\u7684\u60c5\u51b5\u4e0b\u68c0\u67e5\u507f\u4ed8\u80fd\u529b\u3002')}
                </p>
                <div className="actions">
                  <button className="btn btn-primary" onClick={handleDecryptTotalExpense} disabled={loading === 'decryptExpense'}>
                    {loading === 'decryptExpense' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Total Expense', '\u89e3\u5bc6\u603b\u652f\u51fa')}
                  </button>
                  <button className="btn btn-outline" onClick={handleSolvencyCheck} disabled={loading === 'solvency'}>
                    {loading === 'solvency' ? <><span className="loading"></span>{tr('Checking...', '\u68c0\u67e5\u4e2d\u2026')}</> : tr('Run Solvency Check', '\u6267\u884c\u507f\u4ed8\u68c0\u67e5')}
                  </button>
                  <button className="btn btn-success" onClick={handleDecryptSolvency} disabled={loading === 'decryptSolvency'}>
                    {loading === 'decryptSolvency' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Solvency', '\u89e3\u5bc6\u507f\u4ed8\u7ed3\u679c')}
                  </button>
                </div>
              </div>
            )}

            {/* Tax Authority Panel */}
            {isTaxAuthority && (
              <div className="card">
                <h2>{tr('Tax Authority Panel', '\u7a0e\u52a1\u673a\u5173\u9762\u677f')}</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  {tr('Verify minimum wage compliance and view aggregate payroll data \u2014 no individual salaries exposed.', '\u9a8c\u8bc1\u6700\u4f4e\u5de5\u8d44\u5408\u89c4\u6027\uff0c\u5e76\u67e5\u770b\u6c47\u603b\u85aa\u8d44\u6570\u636e\uff0c\u4e0d\u4f1a\u66b4\u9732\u4efb\u4f55\u4e2a\u4eba\u85aa\u8d44\u3002')}
                </p>
                <div className="actions" style={{ marginBottom: '1rem' }}>
                  <button className="btn btn-primary" onClick={handleDecryptTotalExpense} disabled={loading === 'decryptExpense'}>
                    {loading === 'decryptExpense' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Total Expense', '\u89e3\u5bc6\u603b\u652f\u51fa')}
                  </button>
                  <button className="btn btn-outline" onClick={() => handleVerifyMinWage()} disabled={loading === 'verifyMinWage'}>
                    {loading === 'verifyMinWage' ? <><span className="loading"></span>{tr('Checking...', '\u68c0\u67e5\u4e2d\u2026')}</> : tr('Verify All Min Wage', '\u6821\u9a8c\u5168\u90e8\u6700\u4f4e\u5de5\u8d44')}
                  </button>
                  <button className="btn btn-success" onClick={handleDecryptAllMinWage} disabled={loading === 'decryptAllMinWage'}>
                    {loading === 'decryptAllMinWage' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Batch Result', '\u89e3\u5bc6\u6279\u91cf\u7ed3\u679c')}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" placeholder={tr('Employee address for individual check', '\u5355\u4e2a\u68c0\u67e5\u7684\u5458\u5de5\u5730\u5740')} value={minWageCheckAddr}
                    onChange={e => setMinWageCheckAddr(e.target.value)}
                    style={{ flex: 1, padding: '0.6rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
                  <button className="btn btn-outline" onClick={() => handleVerifyMinWage(minWageCheckAddr)} disabled={loading === 'verifyMinWage'}>
                    {tr('Check Individual', '\u68c0\u67e5\u5355\u4eba')}
                  </button>
                  <button className="btn btn-success" onClick={handleDecryptMinWageResult} disabled={loading === 'decryptMinWage'}>
                    {loading === 'decryptMinWage' ? <><span className="loading"></span>{tr('Decrypting...', '\u89e3\u5bc6\u4e2d\u2026')}</> : tr('Decrypt Result', '\u89e3\u5bc6\u7ed3\u679c')}
                  </button>
                </div>
              </div>
            )}

            {/* No compliance role */}
            {!isEmployer && !isAuditor && !isTaxAuthority && (
              <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="lock-icon">LOCK</div>
                <h2 style={{ justifyContent: 'center' }}>{tr('No Compliance Access', '\u65e0\u5408\u89c4\u8bbf\u95ee\u6743\u9650')}</h2>
                <p style={{ color: 'var(--text-dim)' }}>
                  {tr('Your address is not registered as an employer, auditor, or tax authority for this contract.', '\u60a8\u7684\u5730\u5740\u6ca1\u6709\u88ab\u767b\u8bb0\u4e3a\u8be5\u5408\u7ea6\u7684\u96c7\u4e3b\u3001\u5ba1\u8ba1\u5458\u6216\u7a0e\u52a1\u673a\u5173\u3002')}
                </p>
              </div>
            )}
          </>
        )}
      </>}

      {toast && <div className={'toast toast-' + toast.type}>{toast.msg}</div>}
      {showWalletModal && <WalletModal />}
    </div>
  )
}

export default App
