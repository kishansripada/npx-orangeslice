# Person Multi-Table Joins

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Find people at companies with industry, funding, and title filters.

---

## ⚠️ When to Use These Patterns vs Decomposition

**These multi-table JOIN patterns are for SPECIFIC, SMALL result sets only** (single company lookup, specific funding round check, etc.).

**For PROSPECTING (building broad lists), ALWAYS decompose instead:**

1. **Top-of-funnel**: Get companies using indexed columns (`domain`, `industry_code`, `id`)
2. **Get people**: Query employees at those companies via `linkedin_company_id` (indexed)
3. **Enrichment columns**: Add columns for title, funding stage, etc.
4. **User filtering**: Let users filter the spreadsheet

**Why?** The patterns below use multiple non-indexed filters (title ILIKE, description ILIKE, location) that can timeout on large result sets. For prospecting, decompose into indexed queries + enrichment.

**Example decomposition for "Engineers at funded AI companies":**

```
❌ WRONG: Complex 4-table JOIN with title + funding + description filters → TIMEOUT risk

✅ CORRECT:
1. Get tech companies by industry_code IN (4,6,96) → 500 companies
2. Add "Has Series A+ Funding" enrichment column (query funding by linkedin_company_id)
3. Add "Description Mentions AI" enrichment column (AI classification)
4. Get employees at those companies → Add "Is Engineer" column (title filter)
5. User filters spreadsheet by funding + AI + engineer columns
```

---

## Normalized vs Denormalized: When to Use Which

Cross-table queries have dramatically different performance depending on table choice.

### The Decision Rule

```
Need profile text filter (headline/skills) + company constraint?
  └─ YES → Use lkd_profile JOIN lkd_company (20-93x faster)

Need company-first lookup (ID, name, org field)?
  └─ YES → Use normalized tables (5-31x faster)

Need funding table JOIN?
  └─ YES → Use normalized (indexed JOIN is fast)
```

### Why This Matters

| Pattern                   | Normalized | Denormalized | Winner             |
| ------------------------- | ---------- | ------------ | ------------------ |
| Headline + employee_count | 20,205ms   | **217ms**    | Denormalized (93x) |
| Skill + company industry  | TIMEOUT    | **3,553ms**  | Denormalized (∞)   |
| Company ID → employees    | **48ms**   | 279ms        | Normalized (5.8x)  |
| Company name (org) search | **274ms**  | 8,600ms      | Normalized (31x)   |

### Profile Text + Company Constraint: Denormalized

```typescript
// ✅ BEST: 226ms (vs 20,205ms normalized - 89x faster)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkdc.name AS lc_name
  FROM lkd_profile lkd
  JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
  WHERE lkd.country_iso = 'US'
    AND lkd.headline ILIKE '%engineer%'
    AND lkdc.employee_count > 1000
  LIMIT 50
`
});
```

### Company Name Search: Normalized (GIN Index)

```typescript
// ✅ BEST: 274ms (vs 8,600ms denormalized - 31x faster)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.id, lp.first_name AS lp_first_name, lp.headline AS lp_headline
  FROM linkedin_profile lp
  WHERE lp.location_country_code = 'US'
    AND lp.org ILIKE '%Google%'
  LIMIT 50
`
});
```

The `org` column has a GIN index. Never use `lkd_profile.company_name` for company name searches.

---

## 3-Table Joins (200ms - 2.5s)

Join `linkedin_profile` + `linkedin_profile_position3` + `linkedin_company`.

**Critical:** Always include `industry_code` filter to avoid timeout.

### Engineers at Tech Companies (~241ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  WHERE lp.location_country_code = 'US'
    AND lc.country_code = 'US'
    AND pos.end_date IS NULL
    AND lc.industry_code IN (4, 6, 96)
    AND pos.title ~* '(engineer|developer|architect)'
  LIMIT 100
`
});
```

### Decision Makers at AI Video Companies (~659ms - can be slower)

**⚠️ Warning:** `description ILIKE` filters can make queries very slow (10-22s tested). Prefer using `industry_code` alone when possible.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  WHERE lp.location_country_code = 'US'
    AND lc.country_code = 'US'
    AND pos.end_date IS NULL
    AND lc.description ILIKE '%AI%video%'
    AND lc.industry_code IN (4, 6, 96)
    AND pos.title ~* '(VP|director|head of|chief)'
  LIMIT 20
`
});
```

---

## 4-Table Joins with Funding (44ms - 4s)

Join `linkedin_profile` + `linkedin_profile_position3` + `linkedin_company` + `linkedin_crunchbase_funding`.

**Key requirements:**

- Use regex for title patterns (not multiple ILIKE)
- Include `industry_code` filter
- **Skip ORDER BY** (causes timeout)
- For simple "has funding" checks, consider `EXISTS` over `IN` subquery (2-17x faster)

### VPs Engineering at Series B (~900ms) ✅

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lp.location_country_code = 'US'
    AND lc.country_code = 'US'
    AND pos.end_date IS NULL
    AND pos.title ~* '(VP|Vice President).*(Engineering|Eng)'
    AND lc.industry_code IN (4, 6, 96)
    AND f.round_name = 'Series B'
  LIMIT 20
`
});
```

### Engineers at Series A Startups (~42ms) ✅

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         f.round_name AS f_round_name
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lp.location_country_code = 'US'
    AND lc.country_code = 'US'
    AND pos.end_date IS NULL
    AND pos.title ~* '(engineer|developer)'
    AND lc.industry_code IN (4, 6, 96)
    AND f.round_name = 'Series A'
  LIMIT 20
`
});
```

### CTOs at Series A-C AI Companies (~1.4s - may timeout) 🟡

**⚠️ Warning:** This query can timeout depending on the data volume. Consider reducing filters or splitting into multiple queries if it times out.

```typescript
// Note: Include round_date in SELECT if you want to order later in code
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT DISTINCT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         f.round_date AS f_round_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
  WHERE lp.location_country_code = 'US'
    AND lc.country_code = 'US'
    AND pos.end_date IS NULL
    AND pos.title ~* '(\\mCTO\\M|Chief Technology)'
    AND lc.description ILIKE '%AI%'
    AND lc.industry_code IN (4, 6, 96)
    AND f.round_name IN ('Series A', 'Series B', 'Series C')
  LIMIT 20
`
});
// Sort in code if needed: rows.sort((a, b) => b.f_round_date - a.f_round_date)
```

---

## ❌ What NOT to Do with Joins

### ❌ Multiple ILIKE patterns (use regex)

```sql
-- ❌ TIMEOUT
WHERE (pos.title ILIKE '%VP%Engineering%' OR pos.title ILIKE '%Vice President%Engineering%')

-- ✅ WORKS
WHERE pos.title ~* '(VP|Vice President).*(Engineering|Eng)'
```

### ❌ ORDER BY on 4-table join

```sql
-- ❌ TIMEOUT
SELECT ... FROM (4 tables) ORDER BY f.round_date DESC

-- ✅ WORKS: Sort in code
-- rows.sort((a, b) => b.f_round_date - a.f_round_date)
```

### ❌ Missing industry_code filter

```sql
-- ❌ TIMEOUT: No industry filter
WHERE pos.title ~* '(VP|Vice President)' AND f.round_name = 'Series B'

-- ✅ WORKS: Add industry filter
WHERE pos.title ~* '(VP|Vice President)'
  AND lc.industry_code IN (4, 6, 96)
  AND f.round_name = 'Series B'
```

---

## Subquery Pattern for Company Name Search

**Works for common keywords** (AI, SaaS). **Fails for rare keywords** (fintech).

### AI Founders (~5.3s) ✅

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT DISTINCT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         pos.title AS pos_title,
         lc.company_name AS lc_name
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id IN (
      SELECT id FROM linkedin_company
      WHERE ts_token(company_name) @@ to_tsquery('simple', 'AI')
        AND country_code = 'US'
        AND industry_code IN (4, 6, 96)
      LIMIT 300
    )
    AND pos.end_date IS NULL
    AND pos.title ~* '(founder|CEO|CTO)'
  LIMIT 200
`
});
```

### ❌ Fintech CTOs - TIMEOUT

```typescript
// ❌ TIMEOUT: 'fintech' is too rare
WHERE ts_token(company_name) @@ to_tsquery('simple', 'fintech')

// ✅ WORKAROUND: Use broader keyword
WHERE ts_token(company_name) @@ to_tsquery('simple', 'finance')
```

| Keyword | Duration | Status      |
| ------- | -------- | ----------- |
| AI      | 5.3s     | ✅ Works    |
| SaaS    | 4.4s     | ✅ Works    |
| fintech | TIMEOUT  | ❌ Too rare |

---

## Skill + Company Constraint: Use Denormalized

Multi-skill queries with company filters are 13-22x faster with denormalized tables.

### Multi-Skill + Company Size (~1,281ms) ✅

```typescript
// ✅ BEST: Denormalized (normalized: 28,173ms - 22x slower)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkdc.name AS lc_name
  FROM lkd_profile lkd
  JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
  WHERE lkd.country_iso = 'US'
    AND 'Python' = ANY(lkd.skills)
    AND 'SQL' = ANY(lkd.skills)
    AND lkdc.employee_count BETWEEN 100 AND 5000
  LIMIT 50
`
});
```

### Skill + Company Industry (~3,553ms) ✅

```typescript
// ✅ ONLY OPTION: Normalized times out
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkdc.name AS lc_name
  FROM lkd_profile lkd
  JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
  WHERE lkd.country_iso = 'US'
    AND 'Kubernetes' = ANY(lkd.skills)
    AND lkdc.industry ILIKE '%technology%'
  LIMIT 50
`
});
```

---

## Aggregation: Role Distribution (~5.7s)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT pos.title AS pos_title, COUNT(*) AS count
  FROM linkedin_profile_position3 pos
  WHERE pos.linkedin_company_id = 11130470  -- OpenAI
    AND pos.end_date IS NULL
  GROUP BY pos.title
  ORDER BY count DESC
  LIMIT 20
`
});
```

---

## Location Filtering Patterns

### Company HQ Location

```sql
-- City + State (most reliable)
WHERE lc.locality ILIKE '%Austin%' AND lc.region ILIKE '%Texas%'

-- Metro area
WHERE lc.locality ILIKE '%San Francisco%' OR lc.locality ILIKE '%Bay Area%'

-- Country
WHERE lc.country_code = 'US'
```

### Person Location

```sql
-- City
WHERE lp.location_name ILIKE '%austin%' OR lp.location_city ILIKE '%austin%'

-- State
WHERE lp.location_region ILIKE '%Texas%'

-- Country (most reliable, indexed)
WHERE lp.location_country_code = 'US'
```

### Combined (people in city at companies HQ'd in city)

```sql
WHERE (lc.locality ILIKE '%Austin%' AND lc.region ILIKE '%Texas%')
  AND (lp.location_name ILIKE '%austin%' OR lp.location_city ILIKE '%austin%')
```

⚠️ **Person location filter can timeout** when combined with title/role filters. If this happens:

1. Remove the person location filter from SQL
2. Run query with just company location + role filter
3. Filter results client-side by `location_name` field
4. Company-filtered results are small enough for fast client-side filtering

---

## GTM Pattern: People by Role at Funded Companies (with Location)

This is a common GTM pattern: "Find [role] at [company criteria]"

**Strategy: Company-first, two-phase approach with CTE**

```sql
-- Example: Lawyers at Series C+ startups in Austin
-- Phase 1: Get qualifying companies with DISTINCT ON to avoid funding duplicates
WITH target_companies AS (
  SELECT DISTINCT ON (lc.id)
    lc.id as company_id, lc.company_name, lc.employee_count,
    cf.round_name, cf.round_amount
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding cf ON cf.linkedin_company_id = lc.id
  WHERE lc.locality ILIKE '%Austin%'
    AND lc.region ILIKE '%Texas%'
    AND (cf.round_name ILIKE 'Series C%'
         OR cf.round_name ILIKE 'Series D%'
         OR cf.round_name ILIKE 'Series E%'
         OR cf.round_name ILIKE 'Series F%')
  ORDER BY lc.id, cf.round_date DESC  -- Keep most recent funding round per company
)
-- Phase 2: Find people with target role, DISTINCT ON to avoid position duplicates
SELECT DISTINCT ON (lp.id)
  lp.first_name, lp.last_name, lp.headline, lp.location_name,
  pos.title, c.company_name, c.employee_count, c.round_name
FROM target_companies c
JOIN linkedin_profile_position3 pos ON pos.linkedin_company_id = c.company_id
JOIN linkedin_profile lp ON lp.id = pos.linkedin_profile_id
WHERE pos.end_date IS NULL
  AND (pos.title ILIKE '%lawyer%'
       OR pos.title ILIKE '%attorney%'
       OR pos.title ILIKE '%counsel%'
       OR pos.title ILIKE '%legal%')
ORDER BY lp.id, c.employee_count DESC  -- id for DISTINCT ON, then by company size
LIMIT 100;
```

**Why CTEs work here:** The CTE narrows to ~50-200 companies first. `DISTINCT ON` in both phases prevents duplicates from multiple funding rounds or multiple positions per person.

---

## Decision Makers at Multiple Companies

**For a single company:** Use `services.company.getEmployeesFromLinkedin` with `titlePattern`.

**For multiple companies (cross-company query):** Use raw SQL with DISTINCT ON:

```sql
-- DISTINCT ON prevents duplicates if person has multiple VP Marketing positions
SELECT DISTINCT ON (lp.id)
  lp.first_name, lp.last_name, pos.title, lc.company_name
FROM linkedin_profile lp
JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
WHERE lp.location_country_code = 'US'
  AND pos.linkedin_company_id IN (company_ids)
  AND pos.end_date IS NULL
  AND pos.title ILIKE '%vp%marketing%'
ORDER BY lp.id, pos.start_date DESC  -- id for DISTINCT ON, then most recent
LIMIT 100;
```

---

## Role/Title Search Patterns

| Role Category | Title Patterns |
| ------------- | -------------- |
| Legal | `'%lawyer%'`, `'%attorney%'`, `'%counsel%'`, `'%legal%'` |
| Engineering | `'%engineer%'`, `'%developer%'`, `'%swe%'` |
| Sales | `'%sales%'`, `'%account executive%'`, `'%ae%'`, `'%sdr%'`, `'%bdr%'` |
| Marketing | `'%marketing%'`, `'%growth%'`, `'%demand gen%'` |
| Product | `'%product manager%'`, `'%pm%'`, `'%product%'` |
| C-Suite | `'%ceo%'`, `'%cto%'`, `'%cfo%'`, `'%chief%'` |
| VP+ | `'%vp%'`, `'%vice president%'`, `'%svp%'`, `'%evp%'` |
| Finance | `'%finance%'`, `'%controller%'`, `'%fp&a%'`, `'%accounting%'` |
| HR/People | `'%human resources%'`, `'%hr %'`, `'%people ops%'`, `'%recruiter%'` |

**Multi-pattern OR:**

```sql
AND (pos.title ILIKE '%lawyer%'
     OR pos.title ILIKE '%attorney%'
     OR pos.title ILIKE '%counsel%'
     OR pos.title ILIKE '%general counsel%')
```
