import { v4 as uuidv4 } from "uuid";
import {
  ResearchAgent,
  DebateSession,
  DebateRound,
  Verdict,
  Claim,
} from "./types";
import { judgeDebateWithLLM } from "./judge";
import { buildEvidenceGraph } from "./evidenceGraph";

export async function runDebate(
  question: string,
  agents: ResearchAgent[],
  numRounds: number = 2,
  judgeApiKey?: string // if provided, uses the real LLM judge; otherwise falls back to the formula judge
): Promise<DebateSession> {
  const rounds: DebateRound[] = [];

  for (let r = 0; r < numRounds; r++) {
    // Every agent produces an answer for this round, seeing prior rounds
    const answers = await Promise.all(
      agents.map((agent) => agent.answer(question, rounds))
    );

    // Every agent critiques one claim from a DIFFERENT agent (simple round-robin)
    const critiques = await Promise.all(
      agents.map((agent, i) => {
        const targetAnswer = answers[(i + 1) % answers.length]; // critique the "next" agent
        const targetClaim = targetAnswer.claims[0];
        return agent.critique(targetClaim, question);
      })
    );

    rounds.push({ roundNumber: r, answers, critiques });
  }

  const verdict = judgeApiKey
    ? await judgeDebateWithLLM(question, rounds, judgeApiKey)
    : judgeDebateFormula(question, rounds);

  const sessionId = uuidv4();
  const evidenceGraph = buildEvidenceGraph(sessionId, question, rounds, verdict);

  return {
    id: sessionId,
    question,
    rounds,
    verdict,
    evidenceGraph,
    createdAt: new Date().toISOString(),
  };
}

// Fallback judge with no LLM call - used when no judgeApiKey is provided
// (e.g. the mock-agent test path). Kept simple and explicit; the real judge
// (judge.ts) is what's used for any actual demo/submission.
function judgeDebateFormula(question: string, rounds: DebateRound[]): Verdict {
  const finalRound = rounds[rounds.length - 1];
  const allRounds = rounds;

  const scored = finalRound.answers.map((answer) => {
    const claim = answer.claims[0];
    const critiquesAgainst = allRounds
      .flatMap((r) => r.critiques)
      .filter((c) => c.targetClaimId.startsWith(answer.agentId)).length;

    const score = claim.confidence - critiquesAgainst * 0.1;
    return { answer, score, critiquesAgainst };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const losers = scored.slice(1);

  return {
    winningAgentId: winner.answer.agentId,
    winningAnswer: winner.answer.finalAnswer,
    reasoning: `${winner.answer.agentId} (${winner.answer.modelName}) had the highest confidence-adjusted score (${winner.score.toFixed(
      2
    )}) after surviving ${winner.critiquesAgainst} critique(s) across ${allRounds.length} round(s).`,
    claimVerdicts: finalRound.answers.map((a) => ({
      claimId: a.claims[0].id,
      agentId: a.agentId,
      status: a.agentId === winner.answer.agentId ? "accepted" : "rejected",
      score: scored.find((s) => s.answer.agentId === a.agentId)?.score || 0,
      judgeReasoning: "Formula-based fallback judge (no LLM judge configured).",
    })),
    rejectedAnswers: losers.map((l) => ({
      agentId: l.answer.agentId,
      answer: l.answer.finalAnswer,
      rejectionReason: `Scored lower (${l.score.toFixed(
        2
      )}) after receiving ${l.critiquesAgainst} critique(s) that lowered confidence in this answer relative to the winner.`,
    })),
  };
}
