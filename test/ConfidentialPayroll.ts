import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { ConfidentialPayroll, ConfidentialPayroll__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  auditor: HardhatEthersSigner;
  taxAuthority: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ConfidentialPayroll")) as ConfidentialPayroll__factory;
  const contract = (await factory.deploy("Zama Corp")) as ConfidentialPayroll;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress };
}

describe("ConfidentialPayroll", function () {
  let signers: Signers;
  let contract: ConfidentialPayroll;
  let contractAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    signers = { deployer: s[0], alice: s[1], bob: s[2], carol: s[3], auditor: s[4], taxAuthority: s[5] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires mock mode");
      this.skip();
    }
    ({ contract, contractAddress } = await deployFixture());
  });

  // ============ Deployment ============

  it("should set employer and company name on deploy", async function () {
    expect(await contract.employer()).to.eq(signers.deployer.address);
    expect(await contract.companyName()).to.eq("Zama Corp");
    expect(await contract.getEmployeeCount()).to.eq(0);
  });

  // ============ Add Employee ============

  it("employer can add an employee with encrypted salary", async function () {
    const salary = 5000;
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(salary)
      .encrypt();

    await (await contract.addEmployee(signers.alice.address, enc.handles[0], enc.inputProof)).wait();

    expect(await contract.isEmployee(signers.alice.address)).to.eq(true);
    expect(await contract.getEmployeeCount()).to.eq(1);

    // Employer can decrypt the salary
    const encSalary = await contract.connect(signers.alice).viewMySalary();
    const clearSalary = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encSalary,
      contractAddress,
      signers.alice,
    );
    expect(clearSalary).to.eq(salary);
  });

  it("non-employer cannot add employee", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add64(5000)
      .encrypt();

    await expect(
      contract.connect(signers.alice).addEmployee(signers.bob.address, enc.handles[0], enc.inputProof),
    ).to.be.revertedWith("Only employer");
  });

  it("cannot add same employee twice", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();

    await (await contract.addEmployee(signers.alice.address, enc.handles[0], enc.inputProof)).wait();

    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(6000)
      .encrypt();

    await expect(
      contract.addEmployee(signers.alice.address, enc2.handles[0], enc2.inputProof),
    ).to.be.revertedWith("Already employee");
  });

  // ============ Update Salary ============

  it("employer can update salary", async function () {
    const enc1 = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, enc1.handles[0], enc1.inputProof)).wait();

    const newSalary = 8000;
    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(newSalary)
      .encrypt();
    await (await contract.updateSalary(signers.alice.address, enc2.handles[0], enc2.inputProof)).wait();

    const encSalary = await contract.connect(signers.alice).viewMySalary();
    const clearSalary = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encSalary,
      contractAddress,
      signers.alice,
    );
    expect(clearSalary).to.eq(newSalary);
  });

  // ============ Remove Employee ============

  it("employer can remove an employee", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, enc.handles[0], enc.inputProof)).wait();

    await (await contract.removeEmployee(signers.alice.address)).wait();
    expect(await contract.isEmployee(signers.alice.address)).to.eq(false);
    expect(await contract.getEmployeeCount()).to.eq(0);
  });

  // ============ Deposit ============

  it("employer can deposit to treasury", async function () {
    const amount = 100000;
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(amount)
      .encrypt();

    await (await contract.deposit(enc.handles[0], enc.inputProof)).wait();

    const encTreasury = await contract.viewTreasury();
    const clearTreasury = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encTreasury,
      contractAddress,
      signers.deployer,
    );
    expect(clearTreasury).to.eq(amount);
  });

  // ============ Execute Payroll ============

  it("full payroll cycle: deposit → add employees → pay → check balances", async function () {
    // 1. Deposit 100000 to treasury
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(100000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    // 2. Add Alice with salary 5000
    const aliceSalaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, aliceSalaryEnc.handles[0], aliceSalaryEnc.inputProof)).wait();

    // 3. Add Bob with salary 3000
    const bobSalaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(3000)
      .encrypt();
    await (await contract.addEmployee(signers.bob.address, bobSalaryEnc.handles[0], bobSalaryEnc.inputProof)).wait();

    // 4. Execute payroll
    await (await contract.executePay()).wait();

    // 5. Verify cycle count
    expect(await contract.payrollCycleCount()).to.eq(1);
    expect(await contract.isPaidThisCycle(signers.alice.address)).to.eq(true);
    expect(await contract.isPaidThisCycle(signers.bob.address)).to.eq(true);

    // 6. Alice checks her balance → should be 5000
    const aliceBalance = await contract.connect(signers.alice).viewMyBalance();
    const clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      aliceBalance,
      contractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(5000);

    // 7. Bob checks his balance → should be 3000
    const bobBalance = await contract.connect(signers.bob).viewMyBalance();
    const clearBobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      bobBalance,
      contractAddress,
      signers.bob,
    );
    expect(clearBobBalance).to.eq(3000);

    // 8. Treasury should be 100000 - 5000 - 3000 = 92000
    const treasury = await contract.viewTreasury();
    const clearTreasury = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      treasury,
      contractAddress,
      signers.deployer,
    );
    expect(clearTreasury).to.eq(92000);
  });

  // ============ Access Control ============

  it("non-employee cannot view salary", async function () {
    await expect(contract.connect(signers.bob).viewMySalary()).to.be.revertedWith("Not an employee");
  });

  it("non-employee cannot view balance", async function () {
    await expect(contract.connect(signers.bob).viewMyBalance()).to.be.revertedWith("Not an employee");
  });

  it("non-employer cannot execute payroll", async function () {
    await expect(contract.connect(signers.alice).executePay()).to.be.revertedWith("Only employer");
  });

  it("non-employer cannot deposit", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add64(1000)
      .encrypt();
    await expect(
      contract.connect(signers.alice).deposit(enc.handles[0], enc.inputProof),
    ).to.be.revertedWith("Only employer");
  });

  // ============ Multiple Pay Cycles ============

  it("supports multiple pay cycles with accumulating balances", async function () {
    // Deposit
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(50000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    // Add Alice 5000
    const salaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, salaryEnc.handles[0], salaryEnc.inputProof)).wait();

    // Pay cycle 1
    await (await contract.executePay()).wait();
    await (await contract.resetPayCycle()).wait();

    // Pay cycle 2
    await (await contract.executePay()).wait();

    // Alice balance should be 10000 (2 * 5000)
    const balance = await contract.connect(signers.alice).viewMyBalance();
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance,
      contractAddress,
      signers.alice,
    );
    expect(clearBalance).to.eq(10000);
    expect(await contract.payrollCycleCount()).to.eq(2);
  });

  // ============ Withdraw ============

  it("employee can withdraw and balance resets", async function () {
    // Setup: deposit + add + pay
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(50000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    const salaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, salaryEnc.handles[0], salaryEnc.inputProof)).wait();

    await (await contract.executePay()).wait();

    // Withdraw
    await (await contract.connect(signers.alice).withdraw()).wait();

    // Balance should be 0
    const balance = await contract.connect(signers.alice).viewMyBalance();
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance,
      contractAddress,
      signers.alice,
    );
    expect(clearBalance).to.eq(0);
  });

  // ============ Auditor Role ============

  it("employer can add and remove auditor", async function () {
    await (await contract.addAuditor(signers.auditor.address)).wait();
    expect(await contract.isAuditor(signers.auditor.address)).to.eq(true);
    const auditors = await contract.getAuditors();
    expect(auditors).to.include(signers.auditor.address);

    await (await contract.removeAuditor(signers.auditor.address)).wait();
    expect(await contract.isAuditor(signers.auditor.address)).to.eq(false);
  });

  it("non-employer cannot add auditor", async function () {
    await expect(
      contract.connect(signers.alice).addAuditor(signers.auditor.address),
    ).to.be.revertedWith("Only employer");
  });

  it("auditor can view total expense but not individual salaries", async function () {
    // Setup: deposit + add 2 employees + pay
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(100000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    const aliceEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, aliceEnc.handles[0], aliceEnc.inputProof)).wait();

    const bobEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(3000)
      .encrypt();
    await (await contract.addEmployee(signers.bob.address, bobEnc.handles[0], bobEnc.inputProof)).wait();

    // Add auditor
    await (await contract.addAuditor(signers.auditor.address)).wait();

    // Execute payroll
    await (await contract.executePay()).wait();

    // Auditor can decrypt total expense = 5000 + 3000 = 8000
    const encTotal = await contract.connect(signers.auditor).viewTotalExpense();
    const clearTotal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encTotal,
      contractAddress,
      signers.auditor,
    );
    expect(clearTotal).to.eq(8000);

    // Auditor cannot view individual salary (not an employee)
    await expect(contract.connect(signers.auditor).viewMySalary()).to.be.revertedWith("Not an employee");
  });

  it("auditor can perform solvency compliance check", async function () {
    // Deposit 100000
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(100000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    // Add employee with salary 5000
    const salaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, salaryEnc.handles[0], salaryEnc.inputProof)).wait();

    await (await contract.addAuditor(signers.auditor.address)).wait();
    await (await contract.executePay()).wait();

    // Treasury = 95000, total payroll = 5000 → solvent (true)
    await (await contract.connect(signers.auditor).complianceCheck()).wait();
    const encResult = await contract.connect(signers.auditor).viewSolvencyResult();
    const clearResult = await fhevm.userDecryptEbool(
      encResult,
      contractAddress,
      signers.auditor,
    );
    expect(clearResult).to.eq(true);
  });

  it("non-auditor cannot call compliance check", async function () {
    await expect(
      contract.connect(signers.alice).complianceCheck(),
    ).to.be.revertedWith("Not an auditor");
  });

  // ============ Tax Authority Role ============

  it("employer can add and remove tax authority", async function () {
    await (await contract.addTaxAuthority(signers.taxAuthority.address)).wait();
    expect(await contract.isTaxAuthority(signers.taxAuthority.address)).to.eq(true);
    const taxAuthorities = await contract.getTaxAuthorities();
    expect(taxAuthorities).to.include(signers.taxAuthority.address);

    await (await contract.removeTaxAuthority(signers.taxAuthority.address)).wait();
    expect(await contract.isTaxAuthority(signers.taxAuthority.address)).to.eq(false);
  });

  it("tax authority can view total expense and historical payroll", async function () {
    // Setup
    const depositEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(100000)
      .encrypt();
    await (await contract.deposit(depositEnc.handles[0], depositEnc.inputProof)).wait();

    const salaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, salaryEnc.handles[0], salaryEnc.inputProof)).wait();

    await (await contract.addTaxAuthority(signers.taxAuthority.address)).wait();

    // Pay cycle 1
    await (await contract.executePay()).wait();
    await (await contract.resetPayCycle()).wait();

    // Pay cycle 2
    await (await contract.executePay()).wait();

    // Tax authority can view last cycle expense = 5000
    const encCycleTotal = await contract.connect(signers.taxAuthority).viewTotalExpenseAsTax();
    const clearCycleTotal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encCycleTotal,
      contractAddress,
      signers.taxAuthority,
    );
    expect(clearCycleTotal).to.eq(5000);

    // Tax authority can view historical total = 10000 (2 cycles × 5000)
    const encHistorical = await contract.connect(signers.taxAuthority).viewHistoricalPayroll();
    const clearHistorical = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encHistorical,
      contractAddress,
      signers.taxAuthority,
    );
    expect(clearHistorical).to.eq(10000);
  });

  it("tax authority can verify minimum wage compliance for individual employee", async function () {
    // Add employee with salary 5000
    const salaryEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, salaryEnc.handles[0], salaryEnc.inputProof)).wait();

    // Set minimum wage to 3000
    await (await contract.setMinimumWage(3000)).wait();
    await (await contract.addTaxAuthority(signers.taxAuthority.address)).wait();

    // Verify Alice meets minimum wage (5000 >= 3000 → true)
    await (await contract.connect(signers.taxAuthority).verifyMinimumWage(signers.alice.address)).wait();
    const encResult = await contract.connect(signers.taxAuthority).viewMinWageResult(signers.alice.address);
    const clearResult = await fhevm.userDecryptEbool(
      encResult,
      contractAddress,
      signers.taxAuthority,
    );
    expect(clearResult).to.eq(true);
  });

  it("tax authority can batch-verify all employees meet minimum wage", async function () {
    // Add Alice salary 5000, Bob salary 3000
    const aliceEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(5000)
      .encrypt();
    await (await contract.addEmployee(signers.alice.address, aliceEnc.handles[0], aliceEnc.inputProof)).wait();

    const bobEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.deployer.address)
      .add64(3000)
      .encrypt();
    await (await contract.addEmployee(signers.bob.address, bobEnc.handles[0], bobEnc.inputProof)).wait();

    // Minimum wage = 2000 → both meet
    await (await contract.setMinimumWage(2000)).wait();
    await (await contract.addTaxAuthority(signers.taxAuthority.address)).wait();

    await (await contract.connect(signers.taxAuthority).verifyAllMinimumWage()).wait();
    const encAll = await contract.connect(signers.taxAuthority).viewAllMinWageResult();
    const clearAll = await fhevm.userDecryptEbool(
      encAll,
      contractAddress,
      signers.taxAuthority,
    );
    expect(clearAll).to.eq(true);
  });

  it("tax authority cannot view individual salaries", async function () {
    await expect(contract.connect(signers.taxAuthority).viewMySalary()).to.be.revertedWith("Not an employee");
  });

  it("non-tax-authority cannot call tax functions", async function () {
    await expect(
      contract.connect(signers.alice).viewTotalExpenseAsTax(),
    ).to.be.revertedWith("Not a tax authority");
  });
});
