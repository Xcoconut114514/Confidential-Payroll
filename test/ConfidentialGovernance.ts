import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { ConfidentialGovernance, ConfidentialGovernance__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ConfidentialGovernance")) as ConfidentialGovernance__factory;
  const contract = (await factory.deploy("Zama Corp Board")) as ConfidentialGovernance;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress };
}

describe("ConfidentialGovernance", function () {
  let signers: Signers;
  let contract: ConfidentialGovernance;
  let contractAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    signers = { deployer: s[0], alice: s[1], bob: s[2], carol: s[3], outsider: s[4] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires mock mode");
      this.skip();
    }
    ({ contract, contractAddress } = await deployFixture());
  });

  // ============ Deployment ============

  it("should set admin and org name on deploy", async function () {
    expect(await contract.admin()).to.eq(signers.deployer.address);
    expect(await contract.orgName()).to.eq("Zama Corp Board");
    expect(await contract.getBoardMemberCount()).to.eq(0);
    expect(await contract.getProposalCount()).to.eq(0);
  });

  // ============ Board Management ============

  it("admin can add and remove board members", async function () {
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await (await contract.addBoardMember(signers.bob.address)).wait();

    expect(await contract.isBoardMember(signers.alice.address)).to.eq(true);
    expect(await contract.isBoardMember(signers.bob.address)).to.eq(true);
    expect(await contract.getBoardMemberCount()).to.eq(2);

    await (await contract.removeBoardMember(signers.alice.address)).wait();
    expect(await contract.isBoardMember(signers.alice.address)).to.eq(false);
    expect(await contract.getBoardMemberCount()).to.eq(1);
  });

  it("non-admin cannot add board member", async function () {
    await expect(
      contract.connect(signers.alice).addBoardMember(signers.bob.address),
    ).to.be.revertedWith("Only admin");
  });

  it("cannot add same board member twice", async function () {
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await expect(
      contract.addBoardMember(signers.alice.address),
    ).to.be.revertedWith("Already a board member");
  });

  // ============ Proposal Management ============

  it("admin can create a proposal", async function () {
    await (await contract.createProposal("Budget Increase", "Increase Q2 budget by 20%", 3600)).wait();
    expect(await contract.getProposalCount()).to.eq(1);

    const proposal = await contract.proposals(0);
    expect(proposal.title).to.eq("Budget Increase");
    expect(proposal.description).to.eq("Increase Q2 budget by 20%");
    expect(proposal.isFinalized).to.eq(false);
    expect(proposal.voterCount).to.eq(0);
  });

  it("non-admin cannot create proposal", async function () {
    await expect(
      contract.connect(signers.alice).createProposal("Test", "test", 3600),
    ).to.be.revertedWith("Only admin");
  });

  // ============ Voting ============

  it("board member can vote yes on a proposal", async function () {
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await (await contract.createProposal("Test Vote", "Testing", 3600)).wait();

    // Alice votes YES (1)
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add8(1)
      .encrypt();
    await (await contract.connect(signers.alice).vote(0, enc.handles[0], enc.inputProof)).wait();

    expect(await contract.hasVoted(0, signers.alice.address)).to.eq(true);
    const proposal = await contract.proposals(0);
    expect(proposal.voterCount).to.eq(1);
  });

  it("board member can vote no on a proposal", async function () {
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await (await contract.createProposal("Test Vote", "Testing", 3600)).wait();

    // Alice votes NO (0)
    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add8(0)
      .encrypt();
    await (await contract.connect(signers.alice).vote(0, enc.handles[0], enc.inputProof)).wait();

    expect(await contract.hasVoted(0, signers.alice.address)).to.eq(true);
  });

  it("cannot vote twice", async function () {
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await (await contract.createProposal("Test", "test", 3600)).wait();

    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add8(1)
      .encrypt();
    await (await contract.connect(signers.alice).vote(0, enc.handles[0], enc.inputProof)).wait();

    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add8(0)
      .encrypt();
    await expect(
      contract.connect(signers.alice).vote(0, enc2.handles[0], enc2.inputProof),
    ).to.be.revertedWith("Already voted");
  });

  it("non-board-member cannot vote", async function () {
    await (await contract.createProposal("Test", "test", 3600)).wait();

    const enc = await fhevm
      .createEncryptedInput(contractAddress, signers.outsider.address)
      .add8(1)
      .encrypt();
    await expect(
      contract.connect(signers.outsider).vote(0, enc.handles[0], enc.inputProof),
    ).to.be.revertedWith("Not a board member");
  });

  // ============ Finalization ============

  it("complete voting workflow: 3 voters, finalize, decrypt results", async function () {
    // Add 3 board members
    await (await contract.addBoardMember(signers.alice.address)).wait();
    await (await contract.addBoardMember(signers.bob.address)).wait();
    await (await contract.addBoardMember(signers.carol.address)).wait();

    // Create proposal with 3600 second duration
    await (await contract.createProposal("Hire CTO", "Hire a new CTO for the company", 3600)).wait();

    // Alice votes YES (1)
    const aliceEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add8(1)
      .encrypt();
    await (await contract.connect(signers.alice).vote(0, aliceEnc.handles[0], aliceEnc.inputProof)).wait();

    // Bob votes YES (1)
    const bobEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.bob.address)
      .add8(1)
      .encrypt();
    await (await contract.connect(signers.bob).vote(0, bobEnc.handles[0], bobEnc.inputProof)).wait();

    // Carol votes NO (0)
    const carolEnc = await fhevm
      .createEncryptedInput(contractAddress, signers.carol.address)
      .add8(0)
      .encrypt();
    await (await contract.connect(signers.carol).vote(0, carolEnc.handles[0], carolEnc.inputProof)).wait();

    // Verify voter count
    const proposal = await contract.proposals(0);
    expect(proposal.voterCount).to.eq(3);

    // Wait for voting to end (mine a block with future timestamp)
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    // Finalize
    await (await contract.finalizeProposal(0)).wait();

    const finalizedProposal = await contract.proposals(0);
    expect(finalizedProposal.isFinalized).to.eq(true);

    // Admin can decrypt results: 2 yes, 1 no
    const [encYes, encNo] = await contract.viewVoteCounts(0);
    const clearYes = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encYes,
      contractAddress,
      signers.deployer,
    );
    const clearNo = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encNo,
      contractAddress,
      signers.deployer,
    );

    expect(clearYes).to.eq(2);
    expect(clearNo).to.eq(1);
  });

  it("cannot finalize before voting ends", async function () {
    await (await contract.createProposal("Test", "test", 999999)).wait();
    await expect(contract.finalizeProposal(0)).to.be.revertedWith("Voting not ended");
  });

  it("cannot finalize twice", async function () {
    await (await contract.createProposal("Test", "test", 1)).wait();
    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);
    await (await contract.finalizeProposal(0)).wait();
    await expect(contract.finalizeProposal(0)).to.be.revertedWith("Already finalized");
  });

  it("non-admin cannot finalize", async function () {
    await (await contract.createProposal("Test", "test", 1)).wait();
    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      contract.connect(signers.alice).finalizeProposal(0),
    ).to.be.revertedWith("Only admin");
  });

  it("non-admin non-finalized cannot view vote counts", async function () {
    await (await contract.createProposal("Test", "test", 3600)).wait();
    await expect(
      contract.connect(signers.alice).viewVoteCounts(0),
    ).to.be.revertedWith("Not authorized");
  });
});
