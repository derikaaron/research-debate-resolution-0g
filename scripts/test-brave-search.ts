import * as dotenv from "dotenv";
dotenv.config();

import { webSearch } from "../src/webSearch";

// Isolated smoke test — confirms BRAVE_API_KEY works and the response
// parsing logic in webSearch.ts handles a real API response correctly.
// Run: npx ts-node scripts/test-brave-search.ts

async function main() {
  console.log("Testing Brave Search...\n");
  try {
    const result = await webSearch("Federal Reserve June 2025 interest rate decision");
    console.log("✅ Search succeeded. Raw formatted result:\n");
    console.log(result);
  } catch (err) {
    console.error("❌ Search failed:", err);
    process.exit(1);
  }
}

main();
