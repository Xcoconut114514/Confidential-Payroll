import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import ABI from './abi.json'

// --- Config ---
// Update this after deploying your contract
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000'
const HARDHAT_CHAIN_ID = '0x7a69' // 31337
const SEPOLIA_CHAIN_ID = '0xaa36a7' // 11155111

type Toast = { msg: string; type: 'success' | 'error' | 'info' }

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

  // Form state
  const [newEmpAddress, setNewEmpAddress] = useState('')
  const [newEmpSalary, setNewEmpSalary] = useState('')
  const [depositAmount, setDepositAmount] = useState('')

  const showToast = (msg: string, type: Toast['type'] = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // --- Connect Wallet ---
  const connectWallet = async () => {
    if (!window.ethereum) {
      showToast('Please install MetaMask', 'error')
      return
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const prov = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
      setProvider(prov)
      setAccount(accounts[0])
      showToast('Wallet connected!', 'success')
    } catch (err) {
      showToast('Failed to connect wallet', 'error')
      console.error(err)
    }
  }

  // --- Load Contract Data ---
  const loadContractData = useCallback(async () => {
    if (!provider || !account) return
    if (CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000') return

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
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => window.location.reload())
      window.ethereum.on('chainChanged', () => window.location.reload())
    }
  }, [])

  // --- Employer Actions ---
  const handleDeposit = async () => {
    if (!contract || !provider) return
    const amount = parseInt(depositAmount)
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return }

    setLoading('deposit')
    try {
      // For local/mock mode, we encode the amount directly
      // In production with FHE, this would use fhevmjs SDK to encrypt
      const signer = await provider.getSigner()
      const amountBn = BigInt(amount)

      // Create a mock encrypted input (for localhost demo)
      // On real FHE network, replace with fhevmjs.createEncryptedInput()
      const abiCoder = ethers.AbiCoder.defaultAbiCoder()
      const handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [amountBn, await signer.getAddress()]))
      const proof = '0x'

      const tx = await contract.deposit(handle, proof)
      await tx.wait()
      showToast(`Deposited ${amount} to treasury`, 'success')
      setDepositAmount('')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
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
      const abiCoder = ethers.AbiCoder.defaultAbiCoder()
      const handle = ethers.keccak256(abiCoder.encode(['uint64', 'address'], [BigInt(salary), await signer.getAddress()]))
      const proof = '0x'

      const tx = await contract.addEmployee(newEmpAddress, handle, proof)
      await tx.wait()
      showToast(`Employee added!`, 'success')
      setNewEmpAddress('')
      setNewEmpSalary('')
      await loadContractData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
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
    if (!contract) return
    setLoading('viewSalary')
    try {
      const encSalary = await contract.viewMySalary()
      // In mock mode, handle is the value itself; in production, decrypt via fhevmjs
      showToast(`Your encrypted salary handle: ${encSalary.toString().slice(0, 18)}...`, 'info')
      // TODO: In production, use fhevmjs.userDecryptEuint() to get the clear value
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
    } finally {
      setLoading(null)
    }
  }

  const handleViewBalance = async () => {
    if (!contract) return
    setLoading('viewBalance')
    try {
      const encBalance = await contract.viewMyBalance()
      showToast(`Your encrypted balance handle: ${encBalance.toString().slice(0, 18)}...`, 'info')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      showToast(msg.slice(0, 100), 'error')
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
          <p style={{ color: 'var(--text-dim)', marginBottom: '2rem', maxWidth: '500px', margin: '0 auto 2rem' }}>
            Salary amounts are encrypted end-to-end using Fully Homomorphic Encryption.
            Only the employer and each employee can see their own salary.
            Everyone else on the blockchain sees only encrypted data.
          </p>

          <div className="connect-btn">
            <button className="btn btn-primary" onClick={connectWallet}>
              Connect MetaMask
            </button>
          </div>
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
      </div>
    )
  }

  const notConfigured = CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000000'

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
        <div>Cycle #{cycleCount} • {employees.length} employees</div>
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
            <span className="encrypted-value">🔒 Encrypted (only you can decrypt)</span>
          </div>
          <div className="info-row">
            <span className="info-label">This Cycle</span>
            <span>{paidStatus[account] ? '✅ Paid' : '⏳ Pending'}</span>
          </div>

          <div className="actions">
            <button className="btn btn-primary" onClick={handleViewSalary} disabled={loading === 'viewSalary'}>
              {loading === 'viewSalary' ? <><span className="loading"></span></> : '🔓 View My Salary'}
            </button>
            <button className="btn btn-outline" onClick={handleViewBalance} disabled={loading === 'viewBalance'}>
              {loading === 'viewBalance' ? <><span className="loading"></span></> : '💰 View Balance'}
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

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

export default App
