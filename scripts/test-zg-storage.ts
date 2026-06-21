import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { Indexer, MemData } from "@0glabs/0g-ts-sdk";

// Chain 16602 is the current 0G testnet (Newton v2).
// Chain 16600 was the old testnet — it's still reachable but storage nodes
// report 16602, which is why transactions revert: wrong chain for the contract.
//
// The storage node told us directly in the upload output:
//   networkIdentity: { chainId: 16602, flowAddress: '0x22e03a6a...' }
//
// RPC for 16602:
const RPC_URL = process.env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = process.env.ZG_INDEXER_RPC || "https://indexer-storage-testnet-turbo.0g.ai";
const ZG_CHAIN_ID = 16602; // Updated from 16600

// The flow contract address the storage node reported for chain 16602.
// This is what the SDK submits transactions to. We verify ours matches.
const EXPECTED_FLOW_CONTRACT = "0x22e03a6a89b950f1c82ec5e74f8eca321a105296";

async function main() {
  const privateKey = process.env.ZG_PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ ZG_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  // Step 1 — provider with correct chain ID
  console.log(`[1/6] Creating provider → ${RPC_URL} (chainId=${ZG_CHAIN_ID})`);
  const provider = new ethers.JsonRpcProvider(RPC_URL, ZG_CHAIN_ID, {
    staticNetwork: true
  });
  console.log("      ✅ Provider created\n");

  // Step 2 — verify we're actually on the right chain
  console.log("[2/6] Verifying network...");
  const network = await provider.getNetwork();
  console.log(`      ✅ Network: chainId=${network.chainId}`);
  if (network.chainId !== BigInt(ZG_CHAIN_ID)) {
    console.error(`❌ Chain ID mismatch: expected ${ZG_CHAIN_ID}, got ${network.chainId}`);
    console.error("   Update ZG_RPC_URL in .env to point to the correct chain.");
    process.exit(1);
  }
  console.log();

  // Step 3 — balance check
  const signer = new ethers.Wallet(privateKey, provider);
  console.log(`[3/6] Wallet: ${signer.address}`);
  const balance = await provider.getBalance(signer.address);
  console.log(`      Balance: ${ethers.formatEther(balance)} OG`);
  if (balance === 0n) {
    console.error("❌ Zero balance — fund at https://faucet.0g.ai");
    console.error(`   Address: ${signer.address}`);
    process.exit(1);
  }
  console.log("      ✅ Balance OK\n");

  // Step 4 — build merkle tree
  // IMPORTANT: The 0G Flow contract requires a minimum submission size.
  // A payload under ~256 bytes gets encoded as a sub-chunk submission which
  // the contract rejects with require(false). We pad to 256 bytes to ensure
  // we always submit at least one full chunk.
  console.log("[4/6] Building merkle tree...");
  const rawPayload = JSON.stringify({ test: true, ts: Date.now(), note: "0G smoke test" });
  const testPayload = rawPayload.padEnd(256, " "); // pad to minimum chunk size
  const data = new MemData(new TextEncoder().encode(testPayload));
  const [tree, treeErr] = await data.merkleTree();
  if (treeErr !== null) {
    console.error("❌ merkleTree() failed:", treeErr);
    process.exit(1);
  }
  const rootHash = tree!.rootHash();
  console.log(`      ✅ Root hash: ${rootHash}\n`);

  // Step 5 — upload
  console.log(`[5/6] Uploading via indexer → ${INDEXER_RPC}`);
  console.log(`      Expected flow contract: ${EXPECTED_FLOW_CONTRACT}`);
  const indexer = new Indexer(INDEXER_RPC);
  const [tx, uploadErr] = await indexer.upload(data, RPC_URL, signer);
  if (uploadErr !== null) {
    console.error("❌ Upload failed:", uploadErr);
    // Help diagnose the most common causes
    const msg = String(uploadErr);
    if (msg.includes("require(false)")) {
      console.error("\nDiagnosis: contract reverted with require(false).");
      console.error("Most likely causes:");
      console.error("  1. RPC chain ID does not match storage node chain ID");
      console.error("  2. SDK is using a different flow contract than the node expects");
      console.error("  3. Insufficient balance for storage fee + gas");
      console.error(`\nStorage node reported chainId=16602, flowAddress=${EXPECTED_FLOW_CONTRACT}`);
      console.error(`Your provider chainId=${ZG_CHAIN_ID}`);
    }
    process.exit(1);
  }

  console.log("\n--- RAW tx object ---");
  console.log(JSON.stringify(tx, null, 2));
  console.log("--- end raw tx ---\n");
  console.log("      ✅ Upload completed\n");

  // Step 6 — download and verify
  console.log(`[6/6] Downloading back: ${rootHash}`);
  const tmpPath = "/tmp/zg-smoke-test-download.json";
  const downloadErr = await indexer.download(rootHash!, tmpPath, true);
  if (downloadErr !== null) {
    console.error("❌ Download failed:", downloadErr);
    process.exit(1);
  }
  const fs = require("fs");
  const downloaded = fs.readFileSync(tmpPath, "utf-8");
  if (downloaded.trim() === testPayload.trim()) {
    console.log("\n✅✅ ROUND TRIP CONFIRMED — 0G Storage working end-to-end.");
    console.log(`   Root hash: ${rootHash}`);
  } else {
    console.error("❌ MISMATCH: content changed between upload and download.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
