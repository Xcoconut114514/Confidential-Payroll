import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:payroll-address", "Prints the ConfidentialPayroll address").setAction(
  async function (_taskArguments: TaskArguments, hre) {
    const { deployments } = hre;
    const payroll = await deployments.get("ConfidentialPayroll");
    console.log("ConfidentialPayroll address:", payroll.address);
  },
);

task("task:deposit", "Deposit funds into treasury")
  .addParam("amount", "Amount to deposit")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("ConfidentialPayroll");
    const [deployer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, deployer);

    const amount = parseInt(taskArguments.amount);
    const enc = await fhevm
      .createEncryptedInput(deployment.address, deployer.address)
      .add64(amount)
      .encrypt();

    const tx = await contract.deposit(enc.handles[0], enc.inputProof);
    await tx.wait();
    console.log(`Deposited ${amount} to treasury`);
  });

task("task:add-employee", "Add an employee with encrypted salary")
  .addParam("employee", "Employee address")
  .addParam("salary", "Salary amount")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("ConfidentialPayroll");
    const [deployer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, deployer);

    const salary = parseInt(taskArguments.salary);
    const enc = await fhevm
      .createEncryptedInput(deployment.address, deployer.address)
      .add64(salary)
      .encrypt();

    const tx = await contract.addEmployee(taskArguments.employee, enc.handles[0], enc.inputProof);
    await tx.wait();
    console.log(`Added employee ${taskArguments.employee} with encrypted salary`);
  });

task("task:execute-pay", "Execute payroll for all employees").setAction(
  async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = await deployments.get("ConfidentialPayroll");
    const [deployer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, deployer);

    const tx = await contract.executePay();
    await tx.wait();
    const cycle = await contract.payrollCycleCount();
    const count = await contract.getEmployeeCount();
    console.log(`Payroll cycle #${cycle} executed for ${count} employees`);
  },
);

task("task:view-salary", "View your encrypted salary (employee only)")
  .addOptionalParam("signer", "Signer index (default: 0)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("ConfidentialPayroll");
    const signers = await ethers.getSigners();
    const signer = signers[parseInt(taskArguments.signer)];
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, signer);

    const encSalary = await contract.viewMySalary();
    const salary = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encSalary,
      deployment.address,
      signer,
    );
    console.log(`Your salary: ${salary}`);
  });

task("task:view-balance", "View your encrypted claimable balance (employee only)")
  .addOptionalParam("signer", "Signer index (default: 0)", "0")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("ConfidentialPayroll");
    const signers = await ethers.getSigners();
    const signer = signers[parseInt(taskArguments.signer)];
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, signer);

    const encBalance = await contract.viewMyBalance();
    const balance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encBalance,
      deployment.address,
      signer,
    );
    console.log(`Your claimable balance: ${balance}`);
  });

task("task:view-treasury", "View encrypted treasury balance (employer only)").setAction(
  async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("ConfidentialPayroll");
    const [deployer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, deployer);

    const encTreasury = await contract.viewTreasury();
    const treasury = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encTreasury,
      deployment.address,
      deployer,
    );
    console.log(`Treasury balance: ${treasury}`);
  },
);

task("task:employees", "List all employees").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { ethers, deployments } = hre;

  const deployment = await deployments.get("ConfidentialPayroll");
  const [deployer] = await ethers.getSigners();
  const contract = await ethers.getContractAt("ConfidentialPayroll", deployment.address, deployer);

  const employees = await contract.getEmployees();
  console.log(`Employees (${employees.length}):`);
  for (const emp of employees) {
    const paid = await contract.isPaidThisCycle(emp);
    console.log(`  ${emp} - Paid this cycle: ${paid}`);
  }
});
