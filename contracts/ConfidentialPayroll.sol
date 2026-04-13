// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Confidential Payroll - Private salary payments on-chain
/// @notice Employer sets encrypted salaries, employees can only see their own.
///         All salary amounts are encrypted end-to-end using FHE.
contract ConfidentialPayroll is ZamaEthereumConfig {
    // ============ State ============

    address public employer;
    string public companyName;

    address[] public employeeList;
    mapping(address => bool) public isEmployee;
    mapping(address => euint64) private _salaries; // encrypted salary per employee
    mapping(address => euint64) private _balances; // encrypted claimable balance
    mapping(address => bool) public isPaidThisCycle; // public: paid status this cycle

    uint256 public payrollCycleCount;
    uint256 public lastPayTimestamp;

    euint64 private _treasuryBalance; // encrypted treasury

    // ============ Events ============

    event EmployeeAdded(address indexed employee);
    event EmployeeRemoved(address indexed employee);
    event SalaryUpdated(address indexed employee);
    event PayrollExecuted(uint256 indexed cycle, uint256 timestamp, uint256 employeeCount);
    event FundsDeposited(uint256 timestamp);
    event FundsWithdrawn(address indexed employee, uint256 timestamp);

    // ============ Modifiers ============

    modifier onlyEmployer() {
        require(msg.sender == employer, "Only employer");
        _;
    }

    modifier onlyEmployee() {
        require(isEmployee[msg.sender], "Not an employee");
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

        for (uint256 i = 0; i < count; i++) {
            address emp = employeeList[i];

            // Add salary to employee balance (encrypted + encrypted)
            _balances[emp] = FHE.add(_balances[emp], _salaries[emp]);

            // Subtract from treasury
            _treasuryBalance = FHE.sub(_treasuryBalance, _salaries[emp]);

            // Set ACL for updated balances
            FHE.allowThis(_balances[emp]);
            FHE.allow(_balances[emp], employer);
            FHE.allow(_balances[emp], emp);

            isPaidThisCycle[emp] = true;
        }

        FHE.allowThis(_treasuryBalance);
        FHE.allow(_treasuryBalance, employer);

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
}
