import { runDebate } from "./orchestrator";
import { buildMockAgents } from "./mockAgents";

async function main() {
  const agents = buildMockAgents();
  const question = "Should a beginner learn Python or JavaScript first for AI engineering?";

  const session = await runDebate(question, agents, 2);

  console.log("=== DEBATE SESSION ===");
  console.log("Question:", session.question);
  console.log("Session ID:", session.id);
  console.log("\n--- Rounds ---");
  for (const round of session.rounds) {
    console.log(`\nRound ${round.roundNumber}:`);
    for (const ans of round.answers) {
      console.log(`  [${ans.agentId} / ${ans.modelName}] -> ${ans.finalAnswer}`);
    }
    for (const crit of round.critiques) {
      console.log(`  CRITIQUE from ${crit.fromAgentId} on ${crit.targetClaimId}: ${crit.text}`);
    }
  }

  console.log("\n--- VERDICT ---");
  console.log("Winner:", session.verdict?.winningAgentId);
  console.log("Winning answer:", session.verdict?.winningAnswer);
  console.log("Reasoning:", session.verdict?.reasoning);
  console.log("\nRejected:");
  for (const rej of session.verdict?.rejectedAnswers || []) {
    console.log(`  - ${rej.agentId}: ${rej.rejectionReason}`);
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
