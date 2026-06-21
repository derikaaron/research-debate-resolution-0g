import Groq from "groq-sdk";
import {
  ResearchAgent, AgentAnswer, Claim, Critique, DebateRound, MarketInput
} from "./types";
import { webSearch } from "./webSearch";

// --- Web search tool definition for Groq tool calling ---
// Each agent can call this to actually fetch evidence rather than guessing
// from training data. This is what makes the resolution assessment credible.
const WEB_SEARCH_TOOL: Groq.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information about an event or claim. Use this to verify whether something actually happened, find official announcements, check dates, or look up source credibility.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A specific, targeted search query. Keep it focused — 3-8 words work best."
        }
      },
      required: ["query"]
    }
  }
};

// Strips <think> and reasoning artifacts from model output
function stripReasoningArtifacts(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (/<think>/i.test(cleaned) && !/<\/think>/i.test(cleaned)) {
    cleaned = cleaned.split(/<think>/i)[0];
  }
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  return cleaned.trim();
}

function parseConfidence(text: string): number {
  const match = text.match(/CONFIDENCE:\s*([\d.]+)/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val >= 0 && val <= 1) return val;
  }
  return 0.7;
}

// Some Groq-hosted models (especially llama-3.3-70b during critique prompts)
// occasionally emit tool calls as raw text instead of structured tool_calls:
//   <function=web_search {"query": "..."} </function>
// or the slightly different:
//   <function=web_search>{"query": "..."}</function>
// Groq rejects these at the API level with a 400 tool_use_failed before they
// reach our loop. We handle this by catching that specific error, extracting
// the query from the failed_generation, executing the search ourselves, and
// injecting the result back into a plain (no-tools) follow-up call.
function extractTextToolCall(failedGeneration: string): string | null {
  // Matches: <function=web_search {"query": "..."} </function>
  // and:     <function=web_search>{"query": "..."}</function>
  const patterns = [
    /<function=web_search\s*\{[^}]*"query"\s*:\s*"([^"]+)"[^}]*\}/,
    /<function=web_search>\s*\{[^}]*"query"\s*:\s*"([^"]+)"[^}]*\}/,
  ];
  for (const pattern of patterns) {
    const match = failedGeneration.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isToolUseFailedError(err: unknown): { failedGeneration: string } | null {
  if (
    err &&
    typeof err === "object" &&
    "error" in err &&
    (err as any).error?.error?.code === "tool_use_failed"
  ) {
    return { failedGeneration: (err as any).error.error.failed_generation || "" };
  }
  return null;
}

// Runs the agent's LLM call with tool calling enabled, handles tool calls by
// actually executing the web search, then gets the final answer.
// This is the loop: think → search → think → answer
async function runWithTools(
  client: Groq,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  isReasoningModel: boolean
): Promise<string> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // Allow up to 3 tool call rounds so agents can search → refine → search again
  for (let i = 0; i < 3; i++) {
    let completion: Groq.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: modelName,
        messages,
        tools: [WEB_SEARCH_TOOL],
        tool_choice: "auto",
        max_tokens: 800,
        temperature: 0.3,
        ...(isReasoningModel ? { reasoning_format: "hidden" as any } : {})
      });
    } catch (err) {
      // Check if this is a text-format tool call that Groq rejected
      const toolFail = isToolUseFailedError(err);
      if (toolFail) {
        const query = extractTextToolCall(toolFail.failedGeneration);
        if (query) {
          // Execute the search the model was trying to make
          let searchResult: string;
          try {
            searchResult = await webSearch(query);
          } catch (searchErr) {
            searchResult = `[SEARCH FAILED: ${(searchErr as Error).message}]`;
          }
          // Inject as a plain user message and retry without tools to get
          // the model's final answer given this evidence
          messages.push({
            role: "user",
            content: `Here are the search results for "${query}":\n\n${searchResult}\n\nNow give your final assessment based on this evidence.`
          });
          // One more call, no tools this time to avoid another format failure
          const fallback = await client.chat.completions.create({
            model: modelName,
            messages,
            max_tokens: 800,
            temperature: 0.3,
            ...(isReasoningModel ? { reasoning_format: "hidden" as any } : {})
          });
          const rawText = fallback.choices[0]?.message?.content || "";
          return stripReasoningArtifacts(rawText);
        }
      }
      // Not a text-format tool call — rethrow
      throw err;
    }

    const choice = completion.choices[0];
    const msg = choice.message;

    // If the model wants to call a tool, execute it and loop back
    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      messages.push(msg); // add assistant's tool call message to history
      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        let searchResult: string;
        try {
          searchResult = await webSearch(args.query);
        } catch (err) {
          // Surface the failure to the agent explicitly rather than feeding
          // it a fabricated result. The agent is instructed to treat this
          // as "evidence unavailable" and lower confidence / lean UNCLEAR.
          searchResult = `[SEARCH FAILED: ${(err as Error).message}. Treat this query as unverified — do not assume an answer.]`;
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: searchResult
        });
      }
      continue; // go back and let the model process the search results
    }

    // Model is done with tool calls — return the final text
    const rawText = msg.content || "";
    return stripReasoningArtifacts(rawText);
  }

  return "Agent did not produce a final answer after tool call rounds.";
}

export class ResolutionAgent implements ResearchAgent {
  agentId: string;
  modelName: string;
  private role: string;
  private systemPrompt: string;
  private client: Groq;
  private isReasoningModel: boolean;
  private marketInput: MarketInput;

  constructor(
    agentId: string,
    modelName: string,
    role: string,
    systemPrompt: string,
    apiKey: string,
    marketInput: MarketInput
  ) {
    this.agentId = agentId;
    this.modelName = modelName;
    this.role = role;
    this.systemPrompt = systemPrompt;
    this.client = new Groq({ apiKey });
    this.isReasoningModel = modelName.toLowerCase().includes("qwen");
    this.marketInput = marketInput;
  }

  async answer(question: string, priorRounds: DebateRound[]): Promise<AgentAnswer> {
    const round = priorRounds.length;
    const { marketQuestion, resolutionRules, eventDescription } = this.marketInput;

    let userPrompt: string;
    if (round === 0) {
      userPrompt = `MARKET QUESTION: ${marketQuestion}

RESOLUTION RULES:
${resolutionRules}

KNOWN EVENT CONTEXT:
${eventDescription}

Assess whether this market should resolve YES or NO.
Use web_search to verify any facts you're uncertain about before concluding.
Be specific — reference the actual resolution rules, not just the market title.
End your answer with:
VERDICT: YES | NO | UNCLEAR
CONFIDENCE: <0 to 1>`;
    } else {
      const lastRound = priorRounds[priorRounds.length - 1];
      const myPrior = lastRound.answers.find(a => a.agentId === this.agentId);
      const critiquesOfMe = lastRound.critiques.filter(
        c => c.targetClaimId === myPrior?.claims[0]?.id
      );
      const critiqueText = critiquesOfMe.map(c => `- ${c.text}`).join("\n");

      userPrompt = `MARKET QUESTION: ${marketQuestion}
RESOLUTION RULES:
${resolutionRules}

Your prior assessment: "${myPrior?.finalAnswer}"
Critiques received:
${critiqueText || "(none)"}

Respond to these critiques from your ${this.role} perspective.
Search for any new evidence that addresses the critique points.
Either defend your position with new evidence or revise it.
End with:
VERDICT: YES | NO | UNCLEAR
CONFIDENCE: <0 to 1>`;
    }

    const text = await runWithTools(
      this.client, this.modelName, this.systemPrompt, userPrompt, this.isReasoningModel
    );

    const confidence = parseConfidence(text);
    const cleanText = text.replace(/CONFIDENCE:\s*[\d.]+/i, "").trim();

    const claim: Claim = {
      id: `${this.agentId}-r${round}-c0`,
      agentId: this.agentId,
      modelName: this.modelName,
      text: cleanText,
      confidence,
      round
    };

    return {
      agentId: this.agentId,
      modelName: this.modelName,
      claims: [claim],
      finalAnswer: cleanText
    };
  }

  async critique(targetClaim: Claim, question: string): Promise<Critique> {
    const userPrompt = `You are reviewing another analyst's resolution assessment.
Market: "${this.marketInput.marketQuestion}"
Resolution rules: "${this.marketInput.resolutionRules}"

Their assessment: "${targetClaim.text}"

From your ${this.role} perspective, identify the single most important flaw, gap, or
unchecked assumption in their analysis. Be specific and direct.

If you need to verify a factual claim, call the web_search tool with a specific query.
After searching (or if no search is needed), write your critique in 2-3 sentences.
Do NOT embed function calls in your text — use the tool_calls mechanism only.`;

    const text = await runWithTools(
      this.client, this.modelName, this.systemPrompt, userPrompt, this.isReasoningModel
    );

    return {
      id: `${this.agentId}-critique-${targetClaim.id}`,
      fromAgentId: this.agentId,
      targetClaimId: targetClaim.id,
      text: stripReasoningArtifacts(text).trim(),
      round: targetClaim.round
    };
  }
}

// The three specialized roles. Each has a different adversarial lens so
// disagreement is structural, not random — a Rules Analyst and an Edge Case
// Identifier are designed to disagree when resolution language is ambiguous.
export function buildResolutionAgents(apiKey: string, marketInput: MarketInput): ResearchAgent[] {
  return [
    new ResolutionAgent(
      "rules-analyst",
      "llama-3.3-70b-versatile",
      "Rules Analyst",
      `You are a Rules Analyst specializing in prediction market resolution.
Your job is to read the market's resolution rules LITERALLY and determine whether
the stated conditions have been met — exactly as written, not as implied.
You are strict about language: "announced" is not the same as "implemented",
"ceasefire" is not the same as "peace deal", "by date X" means before midnight UTC on X.
Search for the specific sources named in the resolution rules. If those exact sources
haven't confirmed the outcome, lean toward UNCLEAR rather than guessing.`,
      apiKey,
      marketInput
    ),
    new ResolutionAgent(
      "evidence-assessor",
      "qwen/qwen3-32b",
      "Evidence Assessor",
      `You are an Evidence Assessor specializing in source quality and factual verification.
Your job is to determine how strong the evidence is for the proposed outcome —
regardless of what the resolution rules say, focus on what actually happened.
Search for multiple independent sources. Assess whether the event occurred,
when it occurred, and whether any of the sources that confirmed it are unreliable,
biased, or have been retracted. Flag any conflicting reports.
If major news sources disagree or the evidence is thin, say so explicitly.`,
      apiKey,
      marketInput
    ),
    new ResolutionAgent(
      "edge-case-finder",
      "openai/gpt-oss-120b",
      "Edge Case Identifier",
      `You are an Edge Case Identifier specializing in finding the ways a prediction
market resolution can go wrong.
Your job is to actively look for reasons why the obvious resolution might be challenged:
- Does the event technically meet the rules, or just feel like it does?
- Are there timing issues (happened too late, retracted after deadline)?
- Is there an alternative interpretation of the rules a disputer might use?
- Has Polymarket resolved similar markets differently in the past?
Search specifically for edge cases, disputes, or complications.
Your default is skepticism — if you can find a plausible dispute angle, flag it.`,
      apiKey,
      marketInput
    )
  ];
}
