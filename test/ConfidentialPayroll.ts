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
    signers = { deployer: s[0], alice: s[1], bob: s[2], carol: s[3] };
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
});
