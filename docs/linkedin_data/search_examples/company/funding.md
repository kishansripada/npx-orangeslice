# Company Funding Queries

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Query funding rounds and investors. Performance: ⚡ 19-55ms (well-indexed).

---

## ⚠️ For Prospecting: Use Decomposition

**Funding queries on companies are fast** (indexed by `linkedin_company_id`). But **combining funding + people + title filters** can timeout.

**For PROSPECTING (building broad lists of people at funded companies), decompose:**

1. **Get funded companies**: Query funding table with round filter → get company IDs
2. **Get employees**: Query employees at those companies via `linkedin_company_id` (indexed)
3. **Enrichment columns**: Add "Title", "Funding Round", "Funding Amount" columns
4. **User filtering**: Let users filter the spreadsheet by role, funding stage, etc.

**When to use direct JOINs (patterns below):**
- Small, specific lookups (e.g., "CEOs at these 5 funded companies")
- When you have a small subquery result (LIMIT 100 in subquery)

---

## Why Funding JOINs Use Normalized Tables

The `linkedin_crunchbase_funding` table has indexed foreign keys, making normalized JOINs fast.

| Pattern                            | Normalized  | Denormalized | Winner            |
| ---------------------------------- | ----------- | ------------ | ----------------- |
| Company + funding                  | **19-55ms** | 100-200ms    | Normalized (3-5x) |
| Decision makers at funded startups | **1,198ms** | 3,124ms      | Normalized (2.6x) |

**Why?** The funding table JOIN uses indexed `linkedin_company_id`. PostgreSQL can efficiently filter companies, then join profiles.

### Decision Makers at Funded Startups (~500-700ms) ✅

Use a subquery to first get funded company IDs, then join to profiles:

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.title AS lp_title, 
         lp.public_profile_url AS lp_linkedin_url,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  WHERE lc.id IN (
    SELECT DISTINCT cf.linkedin_company_id 
    FROM linkedin_crunchbase_funding cf
    JOIN linkedin_company lc2 ON lc2.id = cf.linkedin_company_id
    WHERE cf.round_name = 'Series A'
      AND lc2.country_code = 'US'
      AND lc2.industry_code = 4
    LIMIT 100
  )
    AND pos.end_date IS NULL
    AND lp.title ~* '(CEO|CTO)'
  LIMIT 20
`
});
```

**⚠️ Critical:** Direct 4-table JOINs to funding table timeout. Use a subquery to first get funded company IDs (with LIMIT), then join to profiles. The US and industry filters must be in the subquery to properly constrain the company selection.

**💡 Alternative:** For simpler "has funding" checks without specific round filters, use `EXISTS` which is 2-17x faster than `IN` subqueries. See `QUICK_REF.md` → "IN vs EXISTS" section.

**Contrast with profile text + company constraint:** If you add headline ILIKE to this query, it will timeout. In that case, use denormalized instead.

---

## Recently Funded Companies (~28ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.universal_name AS lc_linkedin_slug,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count,
         f.round_name AS f_round_name,
         f.round_date AS f_round_date,
         f.round_amount AS f_round_amount
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND f.round_date >= '2024-01-01'
  LIMIT 20
`
});
```

---

## Series A Companies (~34ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count,
         f.round_amount AS f_round_amount,
         f.investor_names[1:3] AS f_top_investors
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND f.round_name = 'Series A'
    AND lc.industry_code = 4
  LIMIT 20
`
});
```

---

## Series B Companies

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count,
         f.round_amount AS f_round_amount,
         f.round_date AS f_round_date
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND f.round_name = 'Series B'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});
```

---

## Companies Funded by Specific Investor (~55ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         f.round_name AS f_round_name,
         f.round_amount AS f_round_amount
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND 'Andreessen Horowitz' = ANY(f.investor_names)
  LIMIT 20
`
});
```

### Other Popular Investors

```sql
WHERE 'Sequoia Capital' = ANY(f.investor_names)
WHERE 'Y Combinator' = ANY(f.investor_names)
WHERE 'Accel' = ANY(f.investor_names)
WHERE 'Benchmark' = ANY(f.investor_names)
```

---

## Seed Stage with Recent Funding (~19ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count,
         f.round_amount AS f_round_amount
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND f.round_name = 'Seed'
    AND f.round_date >= '2023-01-01'
  LIMIT 20
`
});
```

---

## Multiple Funding Rounds

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         f.round_name AS f_round_name,
         f.round_date AS f_round_date,
         f.round_amount AS f_round_amount
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND f.round_name IN ('Series A', 'Series B', 'Series C')
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 50
`
});
```

---

## Average Funding by Round Type (~334ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT round_name AS f_round_name,
         COUNT(*) AS count,
         AVG(parsed_round_amount_number/100) AS avg_amount_usd
  FROM linkedin_crunchbase_funding
  WHERE round_name IN ('Seed', 'Series A', 'Series B', 'Series C')
    AND parsed_round_amount_number IS NOT NULL
  GROUP BY round_name
`
});
```

---

## Funding Table Columns

| Column                       | Type   | Notes                                |
| ---------------------------- | ------ | ------------------------------------ |
| `round_name`                 | text   | 'Seed', 'Series A', 'Series B', etc. |
| `round_date`                 | date   | When funding was announced           |
| `round_amount`               | text   | Human-readable: "$10M"               |
| `parsed_round_amount_number` | bigint | In cents (divide by 100 for USD)     |
| `investor_names`             | text[] | Array of investor names              |

---

## ORDER BY with DISTINCT

When using DISTINCT, ORDER BY column must be in SELECT:

```typescript
// ❌ ERROR: ORDER BY expressions must appear in select list
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT DISTINCT lc.company_name AS lc_name
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  ORDER BY f.round_date DESC
`
});

// ✅ CORRECT: Include ORDER BY column in SELECT
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT DISTINCT lc.company_name AS lc_name, f.round_date AS f_round_date
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  ORDER BY f.round_date DESC
`
});
```

---

## Funding Stage Patterns

| Stage | round_name Pattern | Notes |
| ----- | ------------------ | ----- |
| Pre-seed | `'Pre-seed%'` | Very early |
| Seed | `'Seed%'` | Early stage |
| Series A | `'Series A%'` | Growth stage |
| Series B | `'Series B%'` | Scaling |
| Series C+ | `'Series C%' OR 'Series D%' OR ...` | Late stage |
| Any VC-backed | Use EXISTS on funding table | Has any funding |

### Series C and Higher

```sql
AND (cf.round_name ILIKE 'Series C%'
     OR cf.round_name ILIKE 'Series D%'
     OR cf.round_name ILIKE 'Series E%'
     OR cf.round_name ILIKE 'Series F%'
     OR cf.round_name ILIKE 'Series G%')
```

### Recent Funding (last 12 months)

```sql
AND cf.round_date >= CURRENT_DATE - INTERVAL '12 months'
```

---

## Recently Funded Companies with DISTINCT ON

```sql
-- Use DISTINCT ON to avoid duplicates (companies may have multiple funding entries)
SELECT DISTINCT ON (lc.id)
  lc.company_name, lc.domain,
  'https://www.linkedin.com/company/' || lc.universal_name AS linkedin_url,
  cf.round_name, cf.round_amount, cf.round_date
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding cf ON cf.linkedin_company_id = lc.id
WHERE cf.round_name ILIKE '%series a%' AND cf.round_date >= '2024-01-01'
ORDER BY lc.id, cf.round_date DESC  -- id for DISTINCT ON, then by recency
LIMIT 50;
```
