# orangeslice

B2B LinkedIn database prospector. **1.15B profiles, 85M companies.**

```bash
npx orangeslice
```

This installs documentation your AI agent needs to master the database. Point your agent (Claude Code, Cursor, etc.) to `./AGENTS.md` and it becomes a B2B prospecting expert.

## What It Does

Your AI agent gets:
- Full database schema (40+ tables)
- Query patterns and examples
- Anti-patterns to avoid
- Performance rules
- **Parallelization patterns** — agents must run queries in parallel, never sequentially
- **AI structured output** — extract structured data from text with `orangeslice.ai.generateObject()`

## 🚨 CRITICAL: Always Parallelize

**The #1 rule: NEVER run queries sequentially. ALWAYS use `Promise.all()`.**

The API handles rate limiting automatically. Fire all queries at once.

```typescript
// ❌ WRONG - Sequential (SLOW)
const company = await orangeslice.b2b.sql("...");
const funding = await orangeslice.b2b.sql("...");
const jobs = await orangeslice.b2b.sql("...");

// ✅ CORRECT - Parallel (FAST)
const [company, funding, jobs] = await Promise.all([
  orangeslice.b2b.sql("..."),
  orangeslice.b2b.sql("..."),
  orangeslice.b2b.sql("..."),
]);
```

## Quick Example

```typescript
import { orangeslice } from 'orangeslice';

// Research a company - ALL queries in parallel
const [company, funding, recentJobs, leadership] = await Promise.all([
  orangeslice.b2b.sql(`SELECT * FROM linkedin_company WHERE domain = 'stripe.com'`),
  orangeslice.b2b.sql(`SELECT * FROM linkedin_crunchbase_funding WHERE linkedin_company_id = 123`),
  orangeslice.b2b.sql(`SELECT * FROM linkedin_job WHERE linkedin_company_id = 123 LIMIT 10`),
  orangeslice.b2b.sql(`
    SELECT p.first_name, p.last_name, pos.title
    FROM linkedin_profile p
    JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = p.id
    WHERE pos.linkedin_company_id = 123 AND pos.end_date IS NULL
    LIMIT 10
  `),
]);

// Research multiple companies - ALL in parallel
const domains = ['stripe.com', 'openai.com', 'anthropic.com'];
const companies = await Promise.all(
  domains.map(d => orangeslice.b2b.sql(`SELECT * FROM linkedin_company WHERE domain = '${d}'`))
);
```

## Documentation

After running `npx orangeslice`, you get:

```
orangeslice-docs/
├── AGENTS.md              # Agent instructions (includes parallelization rules)
└── linkedin_data/
    ├── QUICK_REF.md       # START HERE - Critical rules & patterns
    ├── tables/            # Full schema (denormalized + normalized)
    └── search_examples/   # Query patterns for people & companies
```

**Read `linkedin_data/QUICK_REF.md` before writing any queries.**

## Installation

```bash
npm install orangeslice
```

## API

### `orangeslice.b2b.sql<T>(query: string): Promise<T>`

Execute SQL and return rows. **Always wrap multiple calls in `Promise.all()`.**

```typescript
// Single query
const companies = await orangeslice.b2b.sql<Company[]>(
  "SELECT * FROM linkedin_company WHERE employee_count > 1000 LIMIT 10"
);

// Multiple queries - ALWAYS parallel
const [techCos, healthCos, financeCos] = await Promise.all([
  orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE industry_code = 4 LIMIT 10"),
  orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE industry_code = 14 LIMIT 10"),
  orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE industry_code = 43 LIMIT 10"),
]);
```

### `orangeslice.b2b.query<T>(query: string): Promise<QueryResult<T>>`

Execute SQL and return full result with metadata.

```typescript
const result = await orangeslice.b2b.query("SELECT * FROM linkedin_company LIMIT 10");
// result.rows, result.rowCount, result.duration_ms
```

### `orangeslice.b2b.configure(options)`

Configure rate limiting. Default settings handle parallelization automatically.

```typescript
orangeslice.b2b.configure({
  concurrency: 3,      // default: 2 concurrent requests
  minDelayMs: 200,     // default: 100ms between requests
});
```

### `orangeslice.ai.generateObject<T>(options): Promise<T>`

Generate structured data from text using AI.

```typescript
const result = await orangeslice.ai.generateObject({
  prompt: "Extract company info: Stripe was founded in 2010 by Patrick Collison",
  schema: {
    type: "object",
    properties: {
      company: { type: "string" },
      year: { type: "number" },
      founder: { type: "string" }
    },
    required: ["company", "year"]
  }
});
// { company: "Stripe", year: 2010, founder: "Patrick Collison" }
```

### `orangeslice.ai.extract<T>(text, schema, instructions?): Promise<T>`

Convenience method to extract structured data from text.

```typescript
const data = await orangeslice.ai.extract(
  "Apple Inc was founded in 1976 by Steve Jobs in Cupertino",
  { type: "object", properties: { company: { type: "string" }, year: { type: "number" } } },
  "Extract the company name and founding year"
);
```

## Restrictions

- No direct contact data (email/phone)
- No Indeed job board data
- No traffic/analytics data
