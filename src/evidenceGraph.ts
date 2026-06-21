import { DebateRound, Verdict, EvidenceGraph, EvidenceNode, EvidenceEdge } from "./types";

export function buildEvidenceGraph(
  sessionId: string,
  question: string,
  rounds: DebateRound[],
  verdict: Verdict
): EvidenceGraph {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];

  for (const round of rounds) {
    // Claim nodes
    for (const ans of round.answers) {
      const claim = ans.claims[0];
      const cv = verdict.claimVerdicts.find((v) => v.claimId === claim.id);

      nodes.push({
        id: claim.id,
        type: "claim",
        agentId: ans.agentId,
        modelName: ans.modelName,
        text: claim.text,
        round: round.roundNumber,
        status: cv?.status,
        score: cv?.score,
      });

      // If this claim is a revision of a prior-round claim from the same agent, link them
      if (round.roundNumber > 0) {
        const priorRound = rounds[round.roundNumber - 1];
        const priorClaim = priorRound?.answers.find((a) => a.agentId === ans.agentId)?.claims[0];
        if (priorClaim) {
          edges.push({ from: claim.id, to: priorClaim.id, relation: "revises" });
        }
      }
    }

    // Critique nodes + edges (critique -> the claim it targets)
    for (const crit of round.critiques) {
      nodes.push({
        id: crit.id,
        type: "critique",
        agentId: crit.fromAgentId,
        modelName: "", // critiques don't carry a separate model field, agent's model is implied
        text: crit.text,
        round: round.roundNumber,
      });
      edges.push({ from: crit.id, to: crit.targetClaimId, relation: "critiques" });
    }
  }

  const finalRound = rounds[rounds.length - 1];
  const winningClaim = finalRound.answers.find((a) => a.agentId === verdict.winningAgentId)?.claims[0];

  return {
    sessionId,
    question,
    nodes,
    edges,
    winningNodeId: winningClaim?.id || "",
  };
}
