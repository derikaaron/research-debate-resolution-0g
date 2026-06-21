import Groq from "groq-sdk";
import { DebateRound, Verdict, ClaimVerdict, Claim } from "./types";

// The judge is deliberately a SEPARATE, neutral model call - not one of the
// debating agents grading itself, and not a hand-tuned formula. This is what
// makes the verdict defensible: a fourth, disinterested model reads the full
// transcript (all claims + all critiques across all rounds) and explains,
// claim by claim, why each one was accepted or rejected.

interface JudgeLLMOutput {
  winningAgentId: string;
  overallReasoning: string;
  claimVerdicts: {
    claimId: string;
    status: "accepted" | "rejected" | "partially_accepted";
    score: number;
    reasoning: string;
  }[];
  comparativeLosingReasons: {
    agentId: string;
    reasonItLostToWinner: string;
  }[];
}

export async function judgeDebateWithLLM(
  question: string,
  rounds: DebateRound[],
  apiKey: string,
  judgeModel: string = "llama-3.3-70b-versatile"
): Promise<Verdict> {
  const client = new Groq({ apiKey });

  const allClaims: Claim[] = rounds.flatMap((r) => r.answers.flatMap((a) => a.claims));
  const allCritiques = rounds.flatMap((r) => r.critiques);

  const transcript = buildTranscript(question, rounds);

  const prompt = `You are an impartial research judge. You did NOT participate in this debate.
Your job is to evaluate every claim made and decide which final answer is strongest, with clear reasoning.

${transcript}

Evaluate every claim listed above. For EACH claim, decide if it was "accepted", "rejected", or 
"partially_accepted" based on whether it held up to critique, was factually sound, and was well-reasoned.
Then decide an overall winning agent (the one whose FINAL round claim is strongest).

Respond with ONLY valid JSON, no other text, in exactly this shape:
{
  "winningAgentId": "<agent id>",
  "overallReasoning": "<2-4 sentences explaining why this agent's final answer is the strongest, referencing specific critiques it survived or specific reasoning that held up>",
  "claimVerdicts": [
    {
      "claimId": "<claim id from the transcript>",
      "status": "accepted" | "rejected" | "partially_accepted",
      "score": <0 to 1>,
      "reasoning": "<1-2 sentences specific to THIS claim, not generic>"
    }
  ],
  "comparativeLosingReasons": [
    {
      "agentId": "<agent id of an agent who did NOT win>",
      "reasonItLostToWinner": "<1-2 sentences explaining specifically why this agent's final answer was WEAKER than the winner's, even if this agent's own claim was individually sound. This must be a head-to-head comparison against the winner, not a standalone judgment of the claim.>"
    }
  ]
}

IMPORTANT: A claim can be individually "accepted" (the reasoning in it is sound) while its
agent STILL loses the debate, because the winner's answer was even stronger or more complete.
comparativeLosingReasons must always explain the loss relative to the winner, never just
restate whether the claim itself was good or bad in isolation.

Include a claimVerdicts entry for EVERY claim ID listed in the transcript, and a
comparativeLosingReasons entry for every agent that is NOT the winningAgentId.`;

  const completion = await client.chat.completions.create({
    model: judgeModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2, // low temperature - we want consistent, careful judging, not creative variety
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: JudgeLLMOutput;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Judge LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const claimVerdicts: ClaimVerdict[] = parsed.claimVerdicts.map((cv) => {
    const claim = allClaims.find((c) => c.id === cv.claimId);
    return {
      claimId: cv.claimId,
      agentId: claim?.agentId || "unknown",
      status: cv.status,
      score: cv.score,
      judgeReasoning: cv.reasoning,
    };
  });

  // Build rejectedAnswers from the final round's losing agents, using the
  // judge's COMPARATIVE reasoning (why they lost to the winner specifically),
  // not the standalone claimVerdict reasoning - those answer a different
  // question ("was this claim sound on its own?") and mixing them up produces
  // contradictory-looking output (e.g. "rejected... because it was accepted").
  const finalRound = rounds[rounds.length - 1];
  const rejectedAnswers = finalRound.answers
    .filter((a) => a.agentId !== parsed.winningAgentId)
    .map((a) => {
      const comparative = parsed.comparativeLosingReasons?.find((r) => r.agentId === a.agentId);
      return {
        agentId: a.agentId,
        answer: a.finalAnswer,
        rejectionReason:
          comparative?.reasonItLostToWinner ||
          "Did not edge out the winning answer, though no specific comparative reason was returned by the judge.",
      };
    });

  const winningAnswer =
    finalRound.answers.find((a) => a.agentId === parsed.winningAgentId)?.finalAnswer || "";

  return {
    winningAgentId: parsed.winningAgentId,
    winningAnswer,
    reasoning: parsed.overallReasoning,
    claimVerdicts,
    rejectedAnswers,
  };
}

function buildTranscript(question: string, rounds: DebateRound[]): string {
  let out = `QUESTION: "${question}"\n\n`;

  for (const round of rounds) {
    out += `--- ROUND ${round.roundNumber} ---\n`;
    for (const ans of round.answers) {
      const claim = ans.claims[0];
      out += `\nCLAIM [id: ${claim.id}] by ${ans.agentId} (${ans.modelName}):\n"${claim.text}"\n(self-reported confidence: ${claim.confidence.toFixed(2)})\n`;
    }
    if (round.critiques.length > 0) {
      out += `\nCritiques in this round:\n`;
      for (const c of round.critiques) {
        out += `- ${c.fromAgentId} on ${c.targetClaimId}: "${c.text}"\n`;
      }
    }
    out += "\n";
  }

  return out;
}
