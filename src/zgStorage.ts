import { ethers } from "ethers";
import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import { DebateSession } from "./types";

// --- 0G Storage integration ---
// Uploads the full debate session (every claim, every critique, the judge's
// reasoning, the final verdict) to 0G Storage. The returned root hash is a
// deterministic Merkle hash of the content — it's what makes the assessment
// tamper-evident: anyone can re-fetch the exact bytes by root hash and verify
// nothing was altered after the fact.
//
// This is intentionally separate from registry.ts. This file only answers
// "how do I get content onto 0G and get a root hash back." The registry is
// what makes that root hash *mean* something (see registry.ts for why).

const DEFAULT_RPC_URL = "https://evmrpc-testnet.0g.ai";
const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";

export interface ZgUploadResult {
  rootHash: string;
  txHash: string;
  explorerUrl: string;
}

function getSigner(): { signer: ethers.Wallet; rpcUrl: string } {
  const privateKey = process.env.ZG_PRIVATE_KEY;
  const rpcUrl = process.env.ZG_RPC_URL || DEFAULT_RPC_URL;

  if (!privateKey) {
    throw new Error(
      "ZG_PRIVATE_KEY is not set. This needs a funded 0G testnet wallet " +
      "(get OG testnet tokens from the 0G faucet: https://docs.0g.ai). " +
      "Add it to .env as ZG_PRIVATE_KEY=0x..."
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, 16602, { staticNetwork: true });
  const signer = new ethers.Wallet(privateKey, provider);
  return { signer, rpcUrl };
}

/**
 * Uploads a completed DebateSession (already includes the verdict and
 * resolutionRecommendation) to 0G Storage as raw JSON bytes via MemData,
 * so there's no temp file to manage.
 */
export async function uploadSessionToZG(session: DebateSession): Promise<ZgUploadResult> {
  const { signer, rpcUrl } = getSigner();
  const indexerRpc = process.env.ZG_INDEXER_RPC || DEFAULT_INDEXER_RPC;
  const indexer = new Indexer(indexerRpc);

  const json = JSON.stringify(session, null, 2);
  const data = new MemData(new TextEncoder().encode(json));

  const [tree, treeErr] = await data.merkleTree();
  if (treeErr !== null) {
    throw new Error(`0G Storage: failed to build merkle tree: ${treeErr}`);
  }
  const rootHash = tree!.rootHash()!;

  const [tx, uploadErr] = await indexer.upload(data, rpcUrl, signer);
  if (uploadErr !== null) {
    throw new Error(`0G Storage upload failed: ${uploadErr}`);
  }

  const txHash = "txHash" in tx ? tx.txHash : (tx as any).txHashes?.[0];

  return {
    rootHash,
    txHash,
    explorerUrl: `https://chainscan-galileo.0g.ai/tx/${txHash}`,
  };
}

/**
 * Downloads and parses a session back from 0G Storage by root hash.
 * Used by the registry lookup path so a cached assessment can be displayed
 * in full, not just referenced by hash.
 */
export async function downloadSessionFromZG(rootHash: string): Promise<DebateSession> {
  const indexerRpc = process.env.ZG_INDEXER_RPC || DEFAULT_INDEXER_RPC;
  const indexer = new Indexer(indexerRpc);

  const tmpPath = `/tmp/zg-session-${rootHash.slice(2, 10)}.json`;
  const err = await indexer.download(rootHash, tmpPath, true); // withProof = true
  if (err !== null) {
    throw new Error(`0G Storage download failed: ${err}`);
  }

  const fs = require("fs");
  const raw = fs.readFileSync(tmpPath, "utf-8");
  return JSON.parse(raw) as DebateSession;
}
