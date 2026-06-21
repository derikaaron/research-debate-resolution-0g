import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import solc from "solc";

// One-time deploy script. Run with: npx ts-node scripts/deployRegistry.ts
// Prints the deployed contract address — copy it into .env as
// REGISTRY_CONTRACT_ADDRESS. You only need to run this once per network;
// the contract has no upgrade logic and doesn't need redeploying between runs.

const RPC_URL = process.env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai";

function compile(): { abi: any; bytecode: string } {
  const contractPath = path.join(__dirname, "../contracts/ResolutionRegistry.sol");
  const source = fs.readFileSync(contractPath, "utf-8");

  const input = {
    language: "Solidity",
    sources: { "ResolutionRegistry.sol": { content: source } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const fatal = output.errors.filter((e: any) => e.severity === "error");
    if (fatal.length > 0) {
      fatal.forEach((e: any) => console.error(e.formattedMessage));
      throw new Error("Solidity compilation failed.");
    }
  }

  const contract = output.contracts["ResolutionRegistry.sol"]["ResolutionRegistry"];
  return { abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object };
}

async function main() {
  const privateKey = process.env.ZG_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Missing ZG_PRIVATE_KEY in .env — needs a funded 0G testnet wallet.");
    process.exit(1);
  }

  console.log("Compiling ResolutionRegistry.sol...");
  const { abi, bytecode } = compile();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Deploying from ${wallet.address} to ${RPC_URL}...`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ ResolutionRegistry deployed!");
  console.log(`   Address: ${address}`);
  console.log(`   Add this to .env as: REGISTRY_CONTRACT_ADDRESS=${address}`);

  // Save the ABI alongside so registry.ts doesn't need solc at runtime
  const abiPath = path.join(__dirname, "../contracts/ResolutionRegistry.abi.json");
  fs.writeFileSync(abiPath, JSON.stringify(abi, null, 2));
  console.log(`   ABI saved to ${abiPath}`);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
