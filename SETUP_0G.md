# 0G Integration Setup

This covers the three things added: real web search, 0G Storage, and the
on-chain ResolutionRegistry contract.

## 1. Install

```
npm install
```

## 2. Environment variables

Copy `.env.example` to `.env` and fill in:

- `GROQ_API_KEY` — existing, unchanged
- `BRAVE_API_KEY` — free tier at https://brave.com/search/api/. Required:
  agents now fail loudly instead of fabricating evidence if this is missing.
- `ZG_PRIVATE_KEY` — a 0G testnet wallet private key. Get OG testnet tokens
  from the 0G faucet (see https://docs.0g.ai) before deploying or uploading.

## 3. Deploy the registry contract (one time only)

```
npm run deploy:registry
```

This compiles `contracts/ResolutionRegistry.sol`, deploys it to 0G testnet,
and prints a contract address. Copy that into `.env` as
`REGISTRY_CONTRACT_ADDRESS=0x...`. It also writes
`contracts/ResolutionRegistry.abi.json`, which `src/registry.ts` reads at
runtime — don't delete it.

You only need to do this once. The same contract serves every future run.

## 4. Run an assessment

```
npm run resolve
```

What happens now, in order:

1. Computes `questionHash = keccak256(marketQuestion + resolutionRules)`.
2. Checks the on-chain registry for that hash. If it's already been
   assessed (by anyone, ever), the original result is fetched from 0G
   Storage and displayed — no new LLM calls are made, and no new commit
   happens. This is intentional: it's what prevents re-running the tool
   until you get a favorable answer.
3. If it's new, runs the full multi-agent debate (now backed by real Brave
   Search results instead of simulated ones).
4. Uploads the complete session (every claim, critique, and the judge's
   verdict) to 0G Storage and gets back a root hash.
5. Commits `(questionHash → rootHash, verdict, safeToPropose)` on-chain via
   `ResolutionRegistry.commitAssessment()`. This call reverts if the
   question was somehow committed between steps 2 and 5 (race protection).

## Verifying the integration (for judges)

- 0G Storage root hash + explorer link are printed at the end of every
  fresh run.
- The registry contract address is in `.env` / on 0G Chainscan — every
  `commitAssessment` call is a visible, public transaction.
- Re-running `npm run resolve` on the exact same market question will skip
  straight to step 2 and return the original result, fetched live from 0G
  Storage by root hash — this is the easiest way to demonstrate that the
  commitment is real and not just a UI claim.
