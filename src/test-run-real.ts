import * as dotenv from "dotenv";
dotenv.config();

import { runDebate } from "./orchestrator";
import { buildGroqAgents } from "./groqAgents";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("Missing GROQ_API_KEY. Create a .env file with GROQ_API_KEY=your_key_here");
    process.exit(1);
  }

  const agents = buildGroqAgents(apiKey);
  const question = process.argv[2] || "Should a beginner learn Python or JavaScript first for AI engineering?";

  console.log(`Running debate on: "${question}"\n(this calls real models, may take 10-30 seconds)\n`);

  const session = await runDebate(question, agents, 2, apiKey);

  console.log("=== DEBATE SESSION ===");
  console.log("Question:", session.question);
  console.log("\n--- Rounds ---");
  for (const round of session.rounds) {
    console.log(`\nRound ${round.roundNumber}:`);
    for (const ans of round.answers) {
      console.log(`\n  [${ans.agentId} / ${ans.modelName}]`);
      console.log(`  ${ans.finalAnswer}`);
    }
    console.log("");
    for (const crit of round.critiques) {
      console.log(`  CRITIQUE from ${crit.fromAgentId} -> ${crit.targetClaimId}:`);
      console.log(`    ${crit.text}`);
    }
  }

  console.log("\n--- CLAIM-LEVEL VERDICTS ---");
  for (const cv of session.verdict?.claimVerdicts || []) {
    console.log(`  [${cv.status.toUpperCase()}] ${cv.claimId} (${cv.agentId}) - score: ${cv.score.toFixed(2)}`);
    console.log(`    ${cv.judgeReasoning}`);
  }

  console.log("\n--- FINAL VERDICT ---");
  console.log("Winner:", session.verdict?.winningAgentId);
  console.log("Winning answer:", session.verdict?.winningAnswer);
  console.log("Overall reasoning:", session.verdict?.reasoning);
  console.log("\nRejected:");
  for (const rej of session.verdict?.rejectedAnswers || []) {
    console.log(`  - ${rej.agentId}: ${rej.answer}`);
    console.log(`    Why rejected: ${rej.rejectionReason}`);
  }

  console.log("\n--- EVIDENCE GRAPH SUMMARY ---");
  console.log(`  ${session.evidenceGraph?.nodes.length} nodes, ${session.evidenceGraph?.edges.length} edges`);
  console.log(`  Winning node: ${session.evidenceGraph?.winningNodeId}`);

  // Save full session as JSON for later use (this is what will eventually go to 0G Storage)
  const fs = require("fs");
  fs.writeFileSync(`session-${session.id}.json`, JSON.stringify(session, null, 2));
  console.log(`\nFull session saved to session-${session.id}.json`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
