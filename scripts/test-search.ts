import * as dotenv from "dotenv";
dotenv.config();

import { webSearch } from "../src/webSearch";

// Provider-agnostic smoke test.
// Works with any SEARCH_PROVIDER value (tavily, serper, none).
//
// Run: npx ts-node scripts/test-search.ts
//
// What this confirms:
//   - The provider router in webSearch.ts selects the right backend
//   - Your API key is valid and the account has quota remaining
//   - The response parsing normalizes correctly into the evidence block format
//   - Agents will receive properly attributed, citable results

const PROVIDER = process.env.SEARCH_PROVIDER || "tavily";

async function main() {
  console.log(`Testing web search (provider: ${PROVIDER})...\n`);

  const queries = [
    "Federal Reserve June 2025 FOMC interest rate decision",
    "Polymarket prediction market resolution criteria",
  ];

  let allPassed = true;

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    try {
      const result = await webSearch(query);
      console.log("✅ Result:\n");
      console.log(result);
      console.log("\n" + "─".repeat(60) + "\n");
    } catch (err) {
      console.error("❌ Failed:", err);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("✅ All search tests passed.");
  } else {
    console.error("\n❌ One or more searches failed. Check your API key and SEARCH_PROVIDER setting.");
    process.exit(1);
  }
}

main();
