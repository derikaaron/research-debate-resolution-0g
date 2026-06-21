import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

// Thin client around the deployed ResolutionRegistry contract.
// This is what turns a 0G Storage upload from "a filing cabinet" into
// "a commitment device" — see contracts/ResolutionRegistry.sol for why.

const DEFAULT_RPC_URL = "https://evmrpc-testnet.0g.ai";

export type VerdictCode = 0 | 1 | 2; // YES | NO | UNCLEAR

export function verdictToCode(verdict: "YES" | "NO" | "UNCLEAR"): VerdictCode {
  return verdict === "YES" ? 0 : verdict === "NO" ? 1 : 2;
}

export function codeToVerdict(code: number): "YES" | "NO" | "UNCLEAR" {
  return code === 0 ? "YES" : code === 1 ? "NO" : "UNCLEAR";
}

/**
 * Deterministic question identity: the same market question + resolution
 * rules always hashes to the same key, regardless of how many times the
 * tool is run. This is what prevents "keep re-running until I like the
 * answer" — the contract will reject a second commit for the same key.
 */
export function questionHash(marketQuestion: string, resolutionRules: string): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(`${marketQuestion.trim()}\n${resolutionRules.trim()}`)
  );
}

function loadAbi(): any {
  const abiPath = path.join(__dirname, "../contracts/ResolutionRegistry.abi.json");
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      "ResolutionRegistry.abi.json not found. Run `npx ts-node scripts/deployRegistry.ts` " +
      "once to deploy the contract and generate the ABI."
    );
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf-8"));
}

function getContract(withSigner: boolean) {
  const rpcUrl = process.env.ZG_RPC_URL || DEFAULT_RPC_URL;
  const address = process.env.REGISTRY_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error("REGISTRY_CONTRACT_ADDRESS is not set in .env. Run scripts/deployRegistry.ts first.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, 16602, { staticNetwork: true });
  const abi = loadAbi();

  if (withSigner) {
    const privateKey = process.env.ZG_PRIVATE_KEY;
    if (!privateKey) throw new Error("ZG_PRIVATE_KEY is not set in .env.");
    const wallet = new ethers.Wallet(privateKey, provider);
    return new ethers.Contract(address, abi, wallet);
  }
  return new ethers.Contract(address, abi, provider);
}

export interface OnChainAssessment {
  rootHash: string;
  committer: string;
  timestamp: number;
  verdict: "YES" | "NO" | "UNCLEAR";
  safeToPropose: boolean;
  exists: boolean;
}

/** Free read call — checks whether this exact question has already been assessed. */
export async function lookupAssessment(qHash: string): Promise<OnChainAssessment> {
  const contract = getContract(false);
  const result = await contract.getAssessment(qHash);
  return {
    rootHash: result[0],
    committer: result[1],
    timestamp: Number(result[2]),
    verdict: codeToVerdict(Number(result[3])),
    safeToPropose: result[4],
    exists: result[5],
  };
}

/**
 * Commits a NEW assessment on-chain. Will revert (and throw) if this
 * question was already committed by anyone, at any time — that's the
 * contract enforcing "first assessment wins, permanently."
 */
export async function commitAssessment(
  qHash: string,
  rootHash: string,
  verdict: "YES" | "NO" | "UNCLEAR",
  safeToPropose: boolean
): Promise<{ txHash: string; explorerUrl: string }> {
  const contract = getContract(true);
  const tx = await contract.commitAssessment(qHash, rootHash, verdictToCode(verdict), safeToPropose);
  const receipt = await tx.wait();
  return {
    txHash: receipt.hash,
    explorerUrl: `https://chainscan-galileo.0g.ai/tx/${receipt.hash}`,
  };
}
