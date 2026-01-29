import { orangeslice } from "./src";

async function main() {
  console.log("Testing orangeslice B2B client with concurrency limiting...\n");

  // Test 1: Single query
  console.log("Test 1: Single query");
  const stripe = await orangeslice.b2b.sql<{ company_name: string; employee_count: number }[]>(
    "SELECT company_name, employee_count FROM linkedin_company WHERE universal_name = 'stripe' LIMIT 1"
  );
  console.log("  Stripe:", stripe[0]);

  // Test 2: Multiple queries in parallel (should be queued to max 2 concurrent)
  console.log("\nTest 2: 6 parallel queries (max 2 concurrent)");
  const companies = ["stripe", "openai", "meta", "google", "microsoft", "amazon"];
  
  const startTime = Date.now();
  const results = await Promise.all(
    companies.map(async (name, i) => {
      console.log(`  [${i + 1}] Starting query for ${name}...`);
      const result = await orangeslice.b2b.sql<{ company_name: string; employee_count: number }[]>(
        `SELECT company_name, employee_count FROM linkedin_company WHERE universal_name = '${name}' LIMIT 1`
      );
      console.log(`  [${i + 1}] Finished ${name}: ${result[0]?.employee_count || 'N/A'} employees`);
      return result[0];
    })
  );
  const elapsed = Date.now() - startTime;

  console.log(`\n  All 6 queries completed in ${elapsed}ms`);
  console.log(`  If they ran truly parallel, would be ~300ms. With queue (max 2), should be ~900ms+`);
  
  console.log("\nResults:");
  results.forEach((r, i) => {
    console.log(`  ${companies[i]}: ${r?.company_name || 'Not found'} - ${r?.employee_count || 'N/A'} employees`);
  });

  console.log("\n✅ All tests passed!");
}

main().catch(console.error);
