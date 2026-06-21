export interface Claim {
  id: string;
  agentId: string;
  modelName: string;
  text: string;
  confidence: number;
  supportingEvidence?: string[];
  round: number;
}

export interface Critique {
  id: string;
  fromAgentId: string;
  targetClaimId: string;
  text: string;
  round: number;
}

export interface AgentAnswer {
  agentId: string;
  modelName: string;
  claims: Claim[];
  finalAnswer: string;
}

export interface DebateRound {
  roundNumber: number;
  answers: AgentAnswer[];
  critiques: Critique[];
}

export interface ClaimVerdict {
  claimId: string;
  agentId: string;
  status: "accepted" | "rejected" | "partially_accepted";
  score: number;
  judgeReasoning: string;
}

export interface Verdict {
  winningAgentId: string;
  winningAnswer: string;
  reasoning: string;
  claimVerdicts: ClaimVerdict[];
  rejectedAnswers: {
    agentId: string;
    answer: string;
    rejectionReason: string;
  }[];
}

export interface EvidenceNode {
  id: string;
  type: "claim" | "critique";
  agentId: string;
  modelName: string;
  text: string;
  round: number;
  status?: "accepted" | "rejected" | "partially_accepted";
  score?: number;
}

export interface EvidenceEdge {
  from: string;
  to: string;
  relation: "critiques" | "revises" | "supports";
}

export interface EvidenceGraph {
  sessionId: string;
  question: string;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  winningNodeId: string;
}

// --- Resolution assistant specific types ---

export interface MarketInput {
  marketQuestion: string;
  resolutionRules: string;
  eventDescription: string;
  marketUrl?: string;
}

export interface ResolutionRecommendation {
  verdict: "YES" | "NO" | "UNCLEAR";
  confidence: number;
  oneLiner: string;
  keyRisk: string;
  safeToPropose: boolean;
}

export interface DebateSession {
  id: string;
  question: string;
  rounds: DebateRound[];
  verdict: Verdict | null;
  evidenceGraph: EvidenceGraph | null;
  createdAt: string;
  // Resolution-specific — only populated when used as resolution assistant
  marketInput?: MarketInput;
  resolutionRecommendation?: ResolutionRecommendation;
}

export interface ResearchAgent {
  agentId: string;
  modelName: string;
  answer(question: string, priorRounds: DebateRound[]): Promise<AgentAnswer>;
  critique(targetClaim: Claim, question: string): Promise<Critique>;
}
