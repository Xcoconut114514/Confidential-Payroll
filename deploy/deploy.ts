import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFHECounter = await deploy("FHECounter", {
    from: deployer,
    log: true,
  });

  console.log(`FHECounter contract: `, deployedFHECounter.address);

  const deployedPayroll = await deploy("ConfidentialPayroll", {
    from: deployer,
    args: ["Zama Corp"],
    log: true,
  });

  console.log(`ConfidentialPayroll contract: `, deployedPayroll.address);
};
export default func;
func.id = "deploy_all";
func.tags = ["FHECounter", "ConfidentialPayroll"];
