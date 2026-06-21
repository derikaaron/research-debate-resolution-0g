import { ResearchAgent, AgentAnswer, Claim, Critique, DebateRound } from "./types";

// A mock agent that returns canned but varied answers, so we can prove the
// orchestration (multiple agents -> debate -> verdict) actually works before
// wiring up any real model or any 0G call.
export class MockAgent implements ResearchAgent {
  agentId: string;
  modelName: string;
  private persona: string;

  constructor(agentId: string, modelName: string, persona: string) {
    this.agentId = agentId;
    this.modelName = modelName;
    this.persona = persona;
  }

  async answer(question: string, priorRounds: DebateRound[]): Promise<AgentAnswer> {
    const round = priorRounds.length;
    const claimText =
      round === 0
        ? `[${this.persona}] Initial take on "${question}": answer leans toward option A because of reason X.`
        : `[${this.persona}] Revised take after seeing critiques: still favor option A but acknowledging caveat Y.`;

    const claim: Claim = {
      id: `${this.agentId}-r${round}-c0`,
      agentId: this.agentId,
      modelName: this.modelName,
      text: claimText,
      confidence: 0.6 + Math.random() * 0.3,
      supportingEvidence: [`Mock evidence snippet from ${this.modelName}`],
      round,
    };

    return {
      agentId: this.agentId,
      modelName: this.modelName,
      claims: [claim],
      finalAnswer: claimText,
    };
  }

  async critique(targetClaim: Claim, question: string): Promise<Critique> {
    return {
      id: `${this.agentId}-critique-${targetClaim.id}`,
      fromAgentId: this.agentId,
      targetClaimId: targetClaim.id,
      text: `[${this.persona}] disagrees with ${targetClaim.agentId}'s claim: missing consideration of edge case Z.`,
      round: targetClaim.round,
    };
  }
}

export function buildMockAgents(): ResearchAgent[] {
  return [
    new MockAgent("agent-1", "mock-llama-3.3-70b", "Optimist"),
    new MockAgent("agent-2", "mock-gemma-3-27b", "Skeptic"),
    new MockAgent("agent-3", "mock-glm-5", "Pragmatist"),
  ];
}
