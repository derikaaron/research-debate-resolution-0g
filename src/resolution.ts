import * as dotenv from "dotenv";
dotenv.config();

import { runDebate } from "./orchestrator";
import { buildResolutionAgents } from "./resolutionAgents";
import { judgeResolutionDebate } from "./resolutionJudge";
import { buildEvidenceGraph } from "./evidenceGraph";
import { MarketInput, DebateSession } from "./types";
import { uploadSessionToZG, downloadSessionFromZG } from "./zgStorage";
import { questionHash, lookupAssessment, commitAssessment } from "./registry";

export async function runResolutionAssessment(
  marketInput: MarketInput,
  apiKey: string,
  numRounds: number = 2
): Promise<DebateSession> {
  console.log(`\nAssessing: "${marketInput.marketQuestion}"`);
  console.log("Building specialized resolution agents...");

  const agents = buildResolutionAgents(apiKey, marketInput);

  console.log("Running multi-agent assessment (agents will search for evidence)...");
  // Run the debate using the existing orchestrator — no changes needed there.
  // We pass undefined for judgeApiKey because we use the resolution-specific
  // judge below instead of the generic one.
  const session = await runDebate(marketInput.marketQuestion, agents, numRounds, undefined);

  console.log("Running resolution judge...");
  const { verdict, recommendation } = await judgeResolutionDebate(
    marketInput, session.rounds, apiKey
  );

  const evidenceGraph = buildEvidenceGraph(session.id, marketInput.marketQuestion, session.rounds, verdict);

  return {
    ...session,
    verdict,
    evidenceGraph,
    marketInput,
    resolutionRecommendation: recommendation
  };
}

// --- CLI entry point ---
async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("Missing GROQ_API_KEY in .env");
    process.exit(1);
  }

  // Demo market: a real historical Polymarket market with known resolution
  // Change this to any market you want to assess
const question = process.argv.slice(2).join(" ");
  const marketInput: MarketInput = {
  marketQuestion:
    question || "Will ETH reach $10,000 before December 31, 2026?",

  resolutionRules:
    "This market resolves YES if Ethereum trades at or above $10,000 on any major exchange before 23:59 UTC on December 31, 2026. Resolution source: CoinMarketCap.",

  eventDescription:
    "Ethereum price target market.",

  marketUrl: "https://coinmarketcap.com/currencies/ethereum/"
};

  const qHash = questionHash(marketInput.marketQuestion, marketInput.resolutionRules);
  console.log(`\nQuestion hash: ${qHash}`);

  // --- Optional: check on-chain registry for an existing assessment ---
  // Skipped gracefully if REGISTRY_CONTRACT_ADDRESS or ZG_PRIVATE_KEY are
  // not yet configured — the assessment still runs and saves locally.
  const registryReady =
    !!process.env.REGISTRY_CONTRACT_ADDRESS && !!process.env.ZG_PRIVATE_KEY;

  if (registryReady) {
    try {
      console.log("Checking on-chain registry for an existing assessment...");
      const existing = await lookupAssessment(qHash);
      if (existing.exists) {
        console.log("\n⚠️  This question has ALREADY been assessed on-chain. Showing the original result.\n");
        const session = await downloadSessionFromZG(existing.rootHash);
        printResults(session);
        console.log(`\nOriginally committed by ${existing.committer} at ${new Date(existing.timestamp * 1000).toISOString()}`);
        console.log(`0G Storage root hash: ${existing.rootHash}`);
        return;
      }
    } catch (err) {
      console.warn("\n⚠️  Registry check failed (skipping):", (err as Error).message);
    }
  } else {
    console.log("ℹ️  Registry check skipped — REGISTRY_CONTRACT_ADDRESS or ZG_PRIVATE_KEY not set.");
    console.log("    (Assessment will run and save locally. 0G integration can be added later.)\n");
  }

  // --- Run the core assessment — always happens regardless of 0G status ---
  let session: DebateSession;
  try {
    session = await runResolutionAssessment(marketInput, apiKey);
  } catch (err) {
    console.error("ERROR during assessment:", err);
    process.exit(1);
  }

  printResults(session);

  const fs = require("fs");
  const filename = `resolution-${session.id}.json`;
  fs.writeFileSync(filename, JSON.stringify(session, null, 2));
  console.log(`\nFull session saved locally to ${filename}`);
  console.log(`Load this file in viewer/evidence-graph-v3.html to see the evidence graph.`);

  // --- Optional: upload to 0G Storage and commit on-chain ---
  if (!registryReady) {
    console.log("\nℹ️  0G Storage/registry skipped — add ZG_PRIVATE_KEY and REGISTRY_CONTRACT_ADDRESS to .env to enable.");
    console.log("    The local file above is your assessment output for now.");
    return;
  }

  try {
    console.log("\nUploading session to 0G Storage...");
    const upload = await uploadSessionToZG(session);
    console.log(`  Root hash: ${upload.rootHash}`);
    console.log(`  Tx: ${upload.explorerUrl}`);

    console.log("\nCommitting assessment to ResolutionRegistry...");
    const rec = session.resolutionRecommendation!;
    const commit = await commitAssessment(qHash, upload.rootHash, rec.verdict, rec.safeToPropose);
    console.log(`  Committed: ${commit.explorerUrl}`);

    console.log("\n" + "═".repeat(60));
    console.log("This assessment is now permanently verifiable on-chain.");
    console.log(`Question hash: ${qHash}`);
    console.log(`0G root hash:  ${upload.rootHash}`);
    console.log("Running this tool again on the same question will return");
    console.log("this exact result instead of generating a new one.");
    console.log("═".repeat(60));
  } catch (err) {
    console.error("\n⚠️  0G Storage/registry step failed (assessment already saved locally):", (err as Error).message);
    console.log("    Fix the 0G setup and re-run to commit. The local JSON is still valid.");
  }
}

function printResults(session: DebateSession) {
  const rec = session.resolutionRecommendation!;

  console.log("\n" + "═".repeat(60));
  console.log("RESOLUTION ASSESSMENT COMPLETE");
  console.log("═".repeat(60));
  console.log(`Market: ${session.marketInput?.marketQuestion}`);
  console.log("\n┌─────────────────────────────────────┐");
  console.log(`│  VERDICT:    ${rec.verdict.padEnd(25)} │`);
  console.log(`│  CONFIDENCE: ${(rec.confidence * 100).toFixed(0).padEnd(24)}% │`);
  console.log(`│  SAFE TO PROPOSE: ${rec.safeToPropose ? "YES ✓" : "NO  ✗"}               │`);
  console.log("└─────────────────────────────────────┘");
  console.log(`\n${rec.oneLiner}`);
  console.log(`\nKey risk: ${rec.keyRisk}`);

  console.log("\n--- Agent assessments ---");
  const finalRound = session.rounds[session.rounds.length - 1];
  for (const ans of finalRound.answers) {
    console.log(`\n[${ans.agentId}]`);
    console.log(ans.finalAnswer);
  }

  console.log("\n--- Claim-level verdicts ---");
  for (const cv of session.verdict?.claimVerdicts || []) {
    console.log(`  [${cv.status.toUpperCase()}] ${cv.claimId} — score: ${cv.score.toFixed(2)}`);
    console.log(`    ${cv.judgeReasoning}`);
  }

  console.log("\n--- Why other analysts were weaker ---");
  for (const rej of session.verdict?.rejectedAnswers || []) {
    console.log(`  ${rej.agentId}: ${rej.rejectionReason}`);
  }

  console.log("\n--- Evidence graph ---");
  console.log(`  ${session.evidenceGraph?.nodes.length} nodes, ${session.evidenceGraph?.edges.length} edges`);
}

main();
