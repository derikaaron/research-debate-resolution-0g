import Groq from "groq-sdk";
import { DebateRound, Verdict, ClaimVerdict, MarketInput, ResolutionRecommendation } from "./types";

interface ResolutionJudgeOutput {
  winningAgentId: string;
  overallReasoning: string;
  resolutionVerdict: "YES" | "NO" | "UNCLEAR";
  resolutionConfidence: number;
  oneLiner: string;
  keyRisk: string;
  safeToPropose: boolean;
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

export async function judgeResolutionDebate(
  marketInput: MarketInput,
  rounds: DebateRound[],
  apiKey: string,
  judgeModel: string = "llama-3.3-70b-versatile"
): Promise<{ verdict: Verdict; recommendation: ResolutionRecommendation }> {
  const client = new Groq({ apiKey });

  const allClaims = rounds.flatMap(r => r.answers.flatMap(a => a.claims));
  const transcript = buildTranscript(marketInput, rounds);

  const prompt = `You are an impartial judge evaluating a prediction market resolution assessment.
Three specialist analysts (Rules Analyst, Evidence Assessor, Edge Case Identifier) have
each independently assessed whether a Polymarket market should resolve YES or NO.

${transcript}

Your job:
1. Evaluate each analyst's assessment claim-by-claim
2. Determine the correct resolution verdict (YES / NO / UNCLEAR)
3. Give a safeToPropose rating — would you stake $750 on this?

safeToPropose should be TRUE only if:
- At least 2 of 3 analysts agree on the outcome
- The evidence assessor found credible sources confirming the outcome
- The edge case finder didn't find a plausible dispute angle
- Confidence is above 0.75

Respond ONLY with valid JSON in exactly this shape:
{
  "winningAgentId": "<agent id of the analyst whose reasoning was strongest>",
  "overallReasoning": "<2-4 sentences explaining the resolution assessment>",
  "resolutionVerdict": "YES" | "NO" | "UNCLEAR",
  "resolutionConfidence": <0 to 1>,
  "oneLiner": "<one sentence: 'Resolves YES because...' or 'Resolves NO because...' or 'UNCLEAR because...'>",
  "keyRisk": "<the single biggest reason this resolution could be disputed or wrong>",
  "safeToPropose": true | false,
  "claimVerdicts": [
    {
      "claimId": "<claim id>",
      "status": "accepted" | "rejected" | "partially_accepted",
      "score": <0 to 1>,
      "reasoning": "<1-2 specific sentences about THIS claim>"
    }
  ],
  "comparativeLosingReasons": [
    {
      "agentId": "<non-winning agent id>",
      "reasonItLostToWinner": "<why this analyst's reasoning was weaker than the winner's>"
    }
  ]
}

Include a claimVerdicts entry for every claim ID in the transcript.
Include a comparativeLosingReasons entry for every agent that is NOT the winningAgentId.`;

  const completion = await client.chat.completions.create({
    model: judgeModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: "json_object" }
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed: ResolutionJudgeOutput;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Resolution judge returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const claimVerdicts: ClaimVerdict[] = parsed.claimVerdicts.map(cv => {
    const claim = allClaims.find(c => c.id === cv.claimId);
    return {
      claimId: cv.claimId,
      agentId: claim?.agentId || "unknown",
      status: cv.status,
      score: cv.score,
      judgeReasoning: cv.reasoning
    };
  });

  const finalRound = rounds[rounds.length - 1];
  const rejectedAnswers = finalRound.answers
    .filter(a => a.agentId !== parsed.winningAgentId)
    .map(a => {
      const comparative = parsed.comparativeLosingReasons?.find(r => r.agentId === a.agentId);
      return {
        agentId: a.agentId,
        answer: a.finalAnswer,
        rejectionReason: comparative?.reasonItLostToWinner || "Weaker reasoning than the winning analyst."
      };
    });

  const winningAnswer = finalRound.answers.find(a => a.agentId === parsed.winningAgentId)?.finalAnswer || "";

  const verdict: Verdict = {
    winningAgentId: parsed.winningAgentId,
    winningAnswer,
    reasoning: parsed.overallReasoning,
    claimVerdicts,
    rejectedAnswers
  };

  const recommendation: ResolutionRecommendation = {
    verdict: parsed.resolutionVerdict,
    confidence: parsed.resolutionConfidence,
    oneLiner: parsed.oneLiner,
    keyRisk: parsed.keyRisk,
    safeToPropose: parsed.safeToPropose
  };

  return { verdict, recommendation };
}

function buildTranscript(marketInput: MarketInput, rounds: DebateRound[]): string {
  let out = `MARKET QUESTION: "${marketInput.marketQuestion}"\n`;
  out += `RESOLUTION RULES: "${marketInput.resolutionRules}"\n`;
  out += `EVENT CONTEXT: "${marketInput.eventDescription}"\n\n`;

  for (const round of rounds) {
    out += `--- ROUND ${round.roundNumber} ---\n`;
    for (const ans of round.answers) {
      const claim = ans.claims[0];
      out += `\nCLAIM [id: ${claim.id}] by ${ans.agentId}:\n"${claim.text}"\n(confidence: ${claim.confidence.toFixed(2)})\n`;
    }
    if (round.critiques.length > 0) {
      out += `\nCritiques:\n`;
      for (const c of round.critiques) {
        out += `- ${c.fromAgentId} on ${c.targetClaimId}: "${c.text}"\n`;
      }
    }
    out += "\n";
  }
  return out;
}
