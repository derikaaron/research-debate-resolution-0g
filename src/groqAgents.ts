import Groq from "groq-sdk";
import { ResearchAgent, AgentAnswer, Claim, Critique, DebateRound } from "./types";

// Reasoning models (like Qwen3) can leak their internal chain-of-thought as
// <think>...</think> blocks even when reasoning_format is set, if the model
// doesn't fully respect the parameter or gets cut off by max_tokens. This
// strips it defensively so it can NEVER leak into demo output, regardless
// of which model or provider produced the text.
function stripReasoningArtifacts(text: string): string {
  let cleaned = text;

  // Closed <think>...</think> blocks (handles multi-line, multiple occurrences)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // Unclosed <think> block (model got cut off mid-thought by max_tokens) -
  // if we see an opening tag with no closing tag, drop everything after it,
  // since there's no way to know where "thinking" ends and "answer" begins.
  if (/<think>/i.test(cleaned) && !/<\/think>/i.test(cleaned)) {
    cleaned = cleaned.split(/<think>/i)[0];
  }

  // Some models use other reasoning delimiters - cover the common ones too
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  cleaned = cleaned.replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, "");

  return cleaned.trim();
}

export class GroqAgent implements ResearchAgent {
  agentId: string;
  modelName: string;
  private persona: string;
  private client: Groq;
  private isReasoningModel: boolean;

  constructor(agentId: string, modelName: string, persona: string, apiKey: string) {
    this.agentId = agentId;
    this.modelName = modelName;
    this.persona = persona;
    this.client = new Groq({ apiKey });
    // Qwen3 and other reasoning-tuned models support reasoning_format to
    // separate thinking from the final answer at the API level - the
    // strip function above is the backup, this is the primary defense.
    this.isReasoningModel = modelName.toLowerCase().includes("qwen");
  }

  async answer(question: string, priorRounds: DebateRound[]): Promise<AgentAnswer> {
    const round = priorRounds.length;

    let prompt: string;
    if (round === 0) {
      prompt = `You are a research agent with a "${this.persona}" analytical style. 
Answer this question concisely (3-5 sentences max). Question: "${question}"
End your answer with a line: CONFIDENCE: <a number between 0 and 1>`;
    } else {
      const lastRound = priorRounds[priorRounds.length - 1];
      const myPriorClaim = lastRound.answers.find((a) => a.agentId === this.agentId);
      const critiquesOfMe = lastRound.critiques.filter(
        (c) => c.targetClaimId === myPriorClaim?.claims[0]?.id
      );
      const critiqueText = critiquesOfMe.map((c) => `- ${c.text}`).join("\n");

      prompt = `You are a research agent with a "${this.persona}" analytical style.
Original question: "${question}"
Your previous answer: "${myPriorClaim?.finalAnswer}"
Other agents critiqued your answer:
${critiqueText || "(no critiques received)"}

Respond to these critiques. Either defend your position or revise it. Keep it concise (3-5 sentences).
End your answer with a line: CONFIDENCE: <a number between 0 and 1>`;
    }

    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 800, // raised again - 500 still truncated mid-sentence for some models on revision turns
      ...(this.isReasoningModel ? { reasoning_format: "hidden" as any } : {}),
    });

    const wasTruncated = completion.choices[0]?.finish_reason === "length";
    if (wasTruncated) {
      console.warn(`[warning] ${this.agentId} (${this.modelName}) response was truncated by max_tokens. Consider raising it further for this model.`);
    }
    const rawText = completion.choices[0]?.message?.content || "";
    const text = stripReasoningArtifacts(rawText);
    const confidence = parseConfidence(text);
    const cleanText = text.replace(/CONFIDENCE:\s*[\d.]+/i, "").trim();

    const claim: Claim = {
      id: `${this.agentId}-r${round}-c0`,
      agentId: this.agentId,
      modelName: this.modelName,
      text: cleanText,
      confidence,
      round,
    };

    return {
      agentId: this.agentId,
      modelName: this.modelName,
      claims: [claim],
      finalAnswer: cleanText,
    };
  }

  async critique(targetClaim: Claim, question: string): Promise<Critique> {
    const prompt = `You are a research agent with a "${this.persona}" analytical style, acting as a critic.
Original question: "${question}"
Another agent (${targetClaim.modelName}) gave this answer: "${targetClaim.text}"

In 1-2 sentences, give your sharpest critique: what's wrong, missing, or weak about this answer? 
If you genuinely have no critique, say so briefly.`;

    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400, // raised again - 300 still truncated some non-reasoning model critiques mid-sentence
      ...(this.isReasoningModel ? { reasoning_format: "hidden" as any } : {}),
    });

    const rawText = completion.choices[0]?.message?.content || "(no critique generated)";
    const text = stripReasoningArtifacts(rawText);

    return {
      id: `${this.agentId}-critique-${targetClaim.id}`,
      fromAgentId: this.agentId,
      targetClaimId: targetClaim.id,
      text: text.trim(),
      round: targetClaim.round,
    };
  }
}

function parseConfidence(text: string): number {
  const match = text.match(/CONFIDENCE:\s*([\d.]+)/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val >= 0 && val <= 1) return val;
  }
  return 0.7; // fallback default if model didn't follow format
}

export function buildGroqAgents(apiKey: string): ResearchAgent[] {
  return [
    new GroqAgent("agent-1", "llama-3.3-70b-versatile", "Optimist", apiKey),
    new GroqAgent("agent-2", "qwen/qwen3-32b", "Skeptic", apiKey),
    new GroqAgent("agent-3", "openai/gpt-oss-120b", "Pragmatist", apiKey),
  ];
}
