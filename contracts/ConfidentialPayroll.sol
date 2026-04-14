// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialCorp - Confidential Corporate Governance Suite
/// @notice Enterprise-grade privacy platform: encrypted payroll, compliance auditing,
///         and tax authority verification. All sensitive financial data encrypted via FHE.
///         Auditors see aggregates only. Tax authorities verify compliance without seeing individual salaries.
contract ConfidentialPayroll is ZamaEthereumConfig {
    // ============ State ============

    address public employer;
    string public companyName;

    // --- Employee registry ---
    address[] public employeeList;
    mapping(address => bool) public isEmployee;
    mapping(address => euint64) private _salaries; // encrypted salary per employee
    mapping(address => euint64) private _balances; // encrypted claimable balance
    mapping(address => bool) public isPaidThisCycle; // public: paid status this cycle

    uint256 public payrollCycleCount;
    uint256 public lastPayTimestamp;

    euint64 private _treasuryBalance; // encrypted treasury

    // --- Compliance: Auditor role ---
    mapping(address => bool) public isAuditor;
    address[] public auditorList;
    euint64 private _totalPayrollPerCycle; // encrypted total payroll expense of last cycle

    // --- Tax Authority role ---
    mapping(address => bool) public isTaxAuthority;
    address[] public taxAuthorityList;
    uint64 public minimumWage; // public minimum wage threshold (plaintext for transparency)
    euint64 private _totalHistoricalPayroll; // encrypted cumulative payroll across all cycles

    // --- Compliance results (stored for view access after tx) ---
    ebool private _lastSolvencyCheck;
    mapping(address => ebool) private _lastMinWageCheck; // per-employee minimum wage result
    ebool private _lastAllMinWageCheck;

    // ============ Events ============

    event EmployeeAdded(address indexed employee);
    event EmployeeRemoved(address indexed employee);
    event SalaryUpdated(address indexed employee);
    event PayrollExecuted(uint256 indexed cycle, uint256 timestamp, uint256 employeeCount);
    event FundsDeposited(uint256 timestamp);
    event FundsWithdrawn(address indexed employee, uint256 timestamp);
    event AuditorAdded(address indexed auditor);
    event AuditorRemoved(address indexed auditor);
    event TaxAuthorityAdded(address indexed authority);
    event TaxAuthorityRemoved(address indexed authority);
    event MinimumWageUpdated(uint64 newMinimumWage);

    // ============ Modifiers ============

    modifier onlyEmployer() {
        require(msg.sender == employer, "Only employer");
        _;
    }

    modifier onlyEmployee() {
        require(isEmployee[msg.sender], "Not an employee");
        _;
    }

    modifier onlyAuditor() {
        require(isAuditor[msg.sender], "Not an auditor");
        _;
    }

    modifier onlyTaxAuthority() {
        require(isTaxAuthority[msg.sender], "Not a tax authority");
        _;
    }

    // ============ Constructor ============

    constructor(string memory _companyName) {
        employer = msg.sender;
        companyName = _companyName;
    }

    // ============ Employer Functions ============

    /// @notice Deposit funds into the treasury (encrypted amount)
    function deposit(externalEuint64 encAmount, bytes calldata inputProof) external onlyEmployer {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        _treasuryBalance = FHE.add(_treasuryBalance, amount);
        FHE.allowThis(_treasuryBalance);
        FHE.allow(_treasuryBalance, employer);
        emit FundsDeposited(block.timestamp);
    }

    /// @notice Add an employee with an encrypted salary
    function addEmployee(
        address employee,
        externalEuint64 encSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        require(employee != address(0), "Invalid address");
        require(!isEmployee[employee], "Already employee");

        isEmployee[employee] = true;
        employeeList.push(employee);

        euint64 salary = FHE.fromExternal(encSalary, inputProof);
        _salaries[employee] = salary;

        // ACL: employer and employee can decrypt the salary
        FHE.allowThis(_salaries[employee]);
        FHE.allow(_salaries[employee], employer);
        FHE.allow(_salaries[employee], employee);

        emit EmployeeAdded(employee);
    }

    /// @notice Update an employee's encrypted salary
    function updateSalary(
        address employee,
        externalEuint64 encNewSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        require(isEmployee[employee], "Not an employee");

        euint64 newSalary = FHE.fromExternal(encNewSalary, inputProof);
        _salaries[employee] = newSalary;

        FHE.allowThis(_salaries[employee]);
        FHE.allow(_salaries[employee], employer);
        FHE.allow(_salaries[employee], employee);

        emit SalaryUpdated(employee);
    }

    /// @notice Remove an employee
    function removeEmployee(address employee) external onlyEmployer {
        require(isEmployee[employee], "Not an employee");
        isEmployee[employee] = false;

        // Remove from list
        for (uint256 i = 0; i < employeeList.length; i++) {
            if (employeeList[i] == employee) {
                employeeList[i] = employeeList[employeeList.length - 1];
                employeeList.pop();
                break;
            }
        }

        emit EmployeeRemoved(employee);
    }

    /// @notice Execute payroll - add salary to each employee's claimable balance
    function executePay() external onlyEmployer {
        uint256 count = employeeList.length;
        require(count > 0, "No employees");

        // Reset cycle total to zero
        _totalPayrollPerCycle = FHE.asEuint64(0);

        for (uint256 i = 0; i < count; i++) {
            address emp = employeeList[i];

            // Add salary to employee balance (encrypted + encrypted)
            _balances[emp] = FHE.add(_balances[emp], _salaries[emp]);

            // Subtract from treasury
            _treasuryBalance = FHE.sub(_treasuryBalance, _salaries[emp]);

            // Accumulate total payroll for this cycle
            _totalPayrollPerCycle = FHE.add(_totalPayrollPerCycle, _salaries[emp]);

            // Set ACL for updated balances
            FHE.allowThis(_balances[emp]);
            FHE.allow(_balances[emp], employer);
            FHE.allow(_balances[emp], emp);

            isPaidThisCycle[emp] = true;
        }

        // Accumulate historical total
        _totalHistoricalPayroll = FHE.add(_totalHistoricalPayroll, _totalPayrollPerCycle);

        FHE.allowThis(_treasuryBalance);
        FHE.allow(_treasuryBalance, employer);

        // Set ACL for payroll totals: employer + all auditors + all tax authorities
        FHE.allowThis(_totalPayrollPerCycle);
        FHE.allow(_totalPayrollPerCycle, employer);
        FHE.allowThis(_totalHistoricalPayroll);
        FHE.allow(_totalHistoricalPayroll, employer);

        for (uint256 i = 0; i < auditorList.length; i++) {
            FHE.allow(_totalPayrollPerCycle, auditorList[i]);
            FHE.allow(_totalHistoricalPayroll, auditorList[i]);
            FHE.allow(_treasuryBalance, auditorList[i]);
        }
        for (uint256 i = 0; i < taxAuthorityList.length; i++) {
            FHE.allow(_totalPayrollPerCycle, taxAuthorityList[i]);
            FHE.allow(_totalHistoricalPayroll, taxAuthorityList[i]);
        }

        payrollCycleCount++;
        lastPayTimestamp = block.timestamp;

        emit PayrollExecuted(payrollCycleCount, block.timestamp, count);
    }

    /// @notice Reset pay cycle flags (call before next pay cycle)
    function resetPayCycle() external onlyEmployer {
        for (uint256 i = 0; i < employeeList.length; i++) {
            isPaidThisCycle[employeeList[i]] = false;
        }
    }

    // ============ Employee Functions ============

    /// @notice Employee views their encrypted salary (only they + employer can decrypt)
    function viewMySalary() external view onlyEmployee returns (euint64) {
        return _salaries[msg.sender];
    }

    /// @notice Employee views their encrypted claimable balance
    function viewMyBalance() external view onlyEmployee returns (euint64) {
        return _balances[msg.sender];
    }

    /// @notice Withdraw claimable balance (resets to zero)
    function withdraw() external onlyEmployee {
        // Reset balance to zero
        _balances[msg.sender] = FHE.asEuint64(0);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allow(_balances[msg.sender], employer);

        emit FundsWithdrawn(msg.sender, block.timestamp);
    }

    // ============ View Functions ============

    /// @notice Get the number of employees
    function getEmployeeCount() external view returns (uint256) {
        return employeeList.length;
    }

    /// @notice Get all employee addresses
    function getEmployees() external view returns (address[] memory) {
        return employeeList;
    }

    /// @notice Employer views treasury balance (encrypted)
    function viewTreasury() external view onlyEmployer returns (euint64) {
        return _treasuryBalance;
    }

    // ============ Auditor Management ============

    /// @notice Add an auditor who can view aggregate payroll data
    function addAuditor(address auditor) external onlyEmployer {
        require(auditor != address(0), "Invalid address");
        require(!isAuditor[auditor], "Already auditor");
        isAuditor[auditor] = true;
        auditorList.push(auditor);
        emit AuditorAdded(auditor);
    }

    /// @notice Remove an auditor
    function removeAuditor(address auditor) external onlyEmployer {
        require(isAuditor[auditor], "Not an auditor");
        isAuditor[auditor] = false;
        for (uint256 i = 0; i < auditorList.length; i++) {
            if (auditorList[i] == auditor) {
                auditorList[i] = auditorList[auditorList.length - 1];
                auditorList.pop();
                break;
            }
        }
        emit AuditorRemoved(auditor);
    }

    /// @notice Get all auditor addresses
    function getAuditors() external view returns (address[] memory) {
        return auditorList;
    }

    // ============ Tax Authority Management ============

    /// @notice Add a tax authority who can verify compliance without seeing individual salaries
    function addTaxAuthority(address authority) external onlyEmployer {
        require(authority != address(0), "Invalid address");
        require(!isTaxAuthority[authority], "Already tax authority");
        isTaxAuthority[authority] = true;
        taxAuthorityList.push(authority);
        emit TaxAuthorityAdded(authority);
    }

    /// @notice Remove a tax authority
    function removeTaxAuthority(address authority) external onlyEmployer {
        require(isTaxAuthority[authority], "Not a tax authority");
        isTaxAuthority[authority] = false;
        for (uint256 i = 0; i < taxAuthorityList.length; i++) {
            if (taxAuthorityList[i] == authority) {
                taxAuthorityList[i] = taxAuthorityList[taxAuthorityList.length - 1];
                taxAuthorityList.pop();
                break;
            }
        }
        emit TaxAuthorityRemoved(authority);
    }

    /// @notice Get all tax authority addresses
    function getTaxAuthorities() external view returns (address[] memory) {
        return taxAuthorityList;
    }

    /// @notice Set the minimum wage threshold (plaintext, for transparency)
    function setMinimumWage(uint64 _minimumWage) external onlyEmployer {
        minimumWage = _minimumWage;
        emit MinimumWageUpdated(_minimumWage);
    }

    // ============ Auditor Functions ============

    /// @notice Auditor views encrypted total payroll expense of last cycle (aggregate only)
    function viewTotalExpense() external view onlyAuditor returns (euint64) {
        return _totalPayrollPerCycle;
    }

    /// @notice Auditor views encrypted treasury balance (to verify solvency)
    function viewTreasuryAsAuditor() external view onlyAuditor returns (euint64) {
        return _treasuryBalance;
    }

    /// @notice Auditor checks if treasury >= total payroll (solvency check)
    /// @dev Stores encrypted boolean result — call viewSolvencyResult() to read
    function complianceCheck() external onlyAuditor {
        ebool isSolvent = FHE.ge(_treasuryBalance, _totalPayrollPerCycle);
        _lastSolvencyCheck = isSolvent;
        FHE.allowThis(isSolvent);
        FHE.allow(isSolvent, msg.sender);
        FHE.allow(isSolvent, employer);
    }

    /// @notice View the last solvency check result (auditor or employer)
    function viewSolvencyResult() external view returns (ebool) {
        require(isAuditor[msg.sender] || msg.sender == employer, "Not authorized");
        return _lastSolvencyCheck;
    }

    // ============ Tax Authority Functions ============

    /// @notice Tax authority views encrypted total payroll expense of last cycle
    function viewTotalExpenseAsTax() external view onlyTaxAuthority returns (euint64) {
        return _totalPayrollPerCycle;
    }

    /// @notice Tax authority views encrypted cumulative historical payroll
    function viewHistoricalPayroll() external view onlyTaxAuthority returns (euint64) {
        return _totalHistoricalPayroll;
    }

    /// @notice Tax authority verifies if a specific employee's salary meets minimum wage
    /// @dev Stores result — call viewMinWageResult(employee) to read
    function verifyMinimumWage(address employee) external onlyTaxAuthority {
        require(isEmployee[employee], "Not an employee");
        require(minimumWage > 0, "Minimum wage not set");

        euint64 minWageEnc = FHE.asEuint64(minimumWage);
        ebool meetsMinWage = FHE.ge(_salaries[employee], minWageEnc);

        _lastMinWageCheck[employee] = meetsMinWage;
        FHE.allowThis(meetsMinWage);
        FHE.allow(meetsMinWage, msg.sender);
        FHE.allow(meetsMinWage, employer);
    }

    /// @notice View minimum wage check result for a specific employee
    function viewMinWageResult(address employee) external view returns (ebool) {
        require(isTaxAuthority[msg.sender] || msg.sender == employer, "Not authorized");
        return _lastMinWageCheck[employee];
    }

    /// @notice Tax authority batch-verifies all employees meet minimum wage
    /// @dev Stores result — call viewAllMinWageResult() to read
    function verifyAllMinimumWage() external onlyTaxAuthority {
        require(employeeList.length > 0, "No employees");
        require(minimumWage > 0, "Minimum wage not set");

        euint64 minWageEnc = FHE.asEuint64(minimumWage);
        ebool allMeet = FHE.asEbool(true);

        for (uint256 i = 0; i < employeeList.length; i++) {
            ebool meets = FHE.ge(_salaries[employeeList[i]], minWageEnc);
            allMeet = FHE.and(allMeet, meets);
        }

        _lastAllMinWageCheck = allMeet;
        FHE.allowThis(allMeet);
        FHE.allow(allMeet, msg.sender);
        FHE.allow(allMeet, employer);
    }

    /// @notice View batch minimum wage check result
    function viewAllMinWageResult() external view returns (ebool) {
        require(isTaxAuthority[msg.sender] || msg.sender == employer, "Not authorized");
        return _lastAllMinWageCheck;
    }
}
