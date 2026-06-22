# Polymarket Resolution Assistant  0G Hackathon

An AI-powered multi-agent debate system that helps Polymarket proposers decide **YES / NO / UNCLEAR** before staking $750 USDC on a resolution  with a full reasoning trail  designed to be stored permanently on 0G Storage and anchored on-chain via the included ResolutionRegistry contract.

## The Problem

Polymarket proposers stake $750 USDC to submit a resolution. If they get it wrong, they lose the stake. The market rules are often ambiguous, evidence is scattered, and there's no structured way to reason through edge cases before committing.

## The Solution

Three specialized AI agents debate the market question, search the web for evidence, critique each other's reasoning, and produce a structured verdict. The full session is uploaded to 0G Storage so the assessment is permanently verifiable — you can't re-run it until you get the answer you want.

## How It Works

```
Market Question + Rules
        ↓
┌─────────────────────────────────────────────┐
│  Agent 1: Rules Analyst                     │
│  Literal interpretation of resolution rules │
├─────────────────────────────────────────────┤
│  Agent 2: Evidence Assessor                 │
│  Web search · Source quality · Corroboration│
├─────────────────────────────────────────────┤
│  Agent 3: Edge Case Finder                  │
│  Counterarguments · Alternative readings    │
└─────────────────────────────────────────────┘
        ↓
  Round 1: Initial answers
  Round 2: Peer critiques + revisions
        ↓
     Judge evaluation
        ↓
  VERDICT: YES / NO / UNCLEAR
  CONFIDENCE: 0–100%
  SAFE TO PROPOSE: YES / NO
        ↓
  Session saved locally as JSON
  0G Storage upload prepared (ResolutionRegistry contract included)
  Evidence graph generated
```

## Demo

**Test market:** "Will the Fed cut interest rates at the June 2025 FOMC meeting?"

**Output:**
```
VERDICT:          NO
CONFIDENCE:       95%
SAFE TO PROPOSE:  YES ✓

Resolves NO because the Federal Reserve did not announce a reduction
in the federal funds rate target range at the June 17-18, 2025 FOMC
meeting, as confirmed by the official press release and other credible
sources.
```

## 0G Integration

| Component | File | Purpose |
|-----------|------|---------|
| Storage upload | `src/zgStorage.ts` | Upload full debate session JSON to 0G Storage |
| On-chain registry | `src/registry.ts` | Commit root hash to ResolutionRegistry contract |
| Smart contract | `contracts/ResolutionRegistry.sol` | Prevent re-running same question |
| Deploy script | `scripts/deployRegistry.ts` | Deploy registry to 0G Galileo testnet |

**Why 0G?** The assessment is only valuable if it can't be gamed. The architecture is designed so that storing it on 0G Storage and anchoring the root hash on-chain means:
- The reasoning trail is permanent and tamper-proof
- Anyone can verify the assessment matches the stored data
- Re-running the same question returns the original result instead of a fresh one

## Stack

- **AI Agents:** Groq (llama-3.3-70b, qwen3-32b, llama-3.1-8b)
- **Web Search:** Tavily (real-time evidence retrieval)
- **Storage:** 0G Storage (permanent session archive)
- **On-chain:** 0G Galileo Testnet — ResolutionRegistry contract
- **Language:** TypeScript / Node.js

## Quick Start

```bash
# Install dependencies
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env
# Fill in: GROQ_API_KEY, TAVILY_API_KEY
# Optional: ZG_PRIVATE_KEY, REGISTRY_CONTRACT_ADDRESS (for 0G integration)

# Run resolution assessment
npm run resolve

# Test web search
npm run test:search

# Test 0G storage (requires funded testnet wallet)
npm run test:storage
```

## Project Structure

```
src/
  resolution.ts         # Main entry point
  resolutionAgents.ts   # Three specialized AI agents + tool calling
  resolutionJudge.ts    # Judge evaluation logic
  orchestrator.ts       # Debate flow orchestration
  evidenceGraph.ts      # Visual evidence graph generation
  webSearch.ts          # Multi-provider search (Tavily / Serper)
  zgStorage.ts          # 0G Storage upload/download
  registry.ts           # On-chain registry integration

contracts/
  ResolutionRegistry.sol  # Prevents re-running same question

scripts/
  deployRegistry.ts     # Deploy to 0G Galileo testnet
  test-search.ts        # Validate search provider
  test-zg-storage.ts    # Validate 0G storage round-trip

viewer/
  evidence-graph-v3.html  # Interactive evidence graph viewer
```

## Environment Variables

```env
# Required
GROQ_API_KEY=          # Groq API key for AI agents
TAVILY_API_KEY=        # Tavily API key for web search

# Optional (enables 0G Storage + on-chain registry)
ZG_PRIVATE_KEY=        # Funded 0G Galileo testnet wallet
REGISTRY_CONTRACT_ADDRESS=  # After running deploy:registry

# Search provider (default: tavily)
SEARCH_PROVIDER=tavily
```

## 0G Network Details

- **Network:** 0G Galileo Testnet
- **Chain ID:** 16602
- **Flow Contract:** `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`
- **Indexer:** `https://indexer-storage-testnet-turbo.0g.ai`
- **Faucet:** https://faucet.0g.ai

## 0G Integration Status

The project includes a complete 0G integration layer:

| File | Purpose |
|------|---------|
| `src/zgStorage.ts` | Upload/download assessment sessions to 0G Storage |
| `contracts/ResolutionRegistry.sol` | On-chain anchoring of session root hashes |
| `src/registry.ts` | Registry interaction logic |
| `scripts/deployRegistry.ts` | Deployment script for Galileo testnet |

During testing on the Galileo testnet (chain 16602), storage uploads encountered Flow contract execution issues on the testnet infrastructure. The integration code is complete and the architecture is designed to store assessment sessions on 0G Storage and anchor their root hashes on-chain once the storage layer is stable.

All other components — multi-agent debate, web search, judge, evidence graph, and local session output — are fully working end-to-end.

## Built For

[0G Zero Cup Hackathon](https://0g.ai/arena/zero-cup)
