# B2B SQL Reference

## 🚨 #1 RULE: ALWAYS PARALLELIZE

**NEVER run queries sequentially. ALWAYS run independent queries in parallel using `Promise.all()`.**

```typescript
// ❌ WRONG - Sequential (SLOW, UNACCEPTABLE)
const company = await orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'");
const funding = await orangeslice.b2b.sql("SELECT * FROM linkedin_crunchbase_funding WHERE linkedin_company_id = 123");
const jobs = await orangeslice.b2b.sql("SELECT * FROM linkedin_job WHERE linkedin_company_id = 123");

// ✅ CORRECT - Parallel (FAST, REQUIRED)
const [company, funding, jobs] = await Promise.all([
  orangeslice.b2b.sql("SELECT * FROM linkedin_company WHERE domain = 'stripe.com'"),
  orangeslice.b2b.sql("SELECT * FROM linkedin_crunchbase_funding WHERE linkedin_company_id = 123"),
  orangeslice.b2b.sql("SELECT * FROM linkedin_job WHERE linkedin_company_id = 123"),
]);
```

**This applies to EVERYTHING:**
- Researching multiple companies? `Promise.all(companies.map(...))`
- Getting company + employees + funding? `Promise.all([company, employees, funding])`
- Any 2+ queries? `Promise.all()`

The API handles rate limiting. You CANNOT overwhelm it. Fire everything at once.

---

**Core principle:** Query indexed columns first → collect IDs → enrich with details.

Database scale: 1.48B jobs, 1.15B profiles, 2.6B positions. Naive queries timeout.

---

## ⛔ COMPLEX QUERIES WILL TIMEOUT - ONLY Use Indexed Columns

**ONLY queries using indexed columns won't timeout. Complex queries with multiple filters WILL timeout.**

> **⚠️ IMPORTANT: If LinkedIn queries keep timing out, FALL BACK TO GOOGLE SERP SEARCH IN PARALLEL.**
>
> Use `web.search` with Google dorks to find companies/people, then enrich with LinkedIn data. This is often **MUCH faster** for complex searches that don't map well to indexed columns.
>
> **Google Dork Examples:**
> - People: `site:linkedin.com/in "software engineer" "San Francisco" "Series B"`
> - Companies: `site:linkedin.com/company "AI" "Austin" "Series B" -jobs`
> - Specific role at company type: `site:linkedin.com/in "VP Sales" "SaaS" "startup"`
>
> Run SERP searches in parallel with LinkedIn queries - whichever returns first, use it.
>
> **⚠️ VERIFY SERP RESULTS:** Google SERP results are NOT guaranteed accurate - snippets may be outdated or misleading. **ALWAYS enrich** extracted LinkedIn URLs with `person.linkedin.enrich` or `company.linkedin.enrich` to verify the data matches your criteria before returning to users.

### Indexed Columns (FAST - use for top-of-funnel)

| Table                         | Indexed Columns                                          |
| ----------------------------- | -------------------------------------------------------- |
| `linkedin_company`            | `id`, `universal_name`, `domain`, `company_id`, `ticker` |
| `linkedin_profile`            | `id`, `linkedin_user_id`, `updated_at`                   |
| `linkedin_profile_position3`  | `linkedin_profile_id`, `linkedin_company_id`             |
| `linkedin_job`                | `linkedin_company_id`, `title_id`, `updated_at`          |
| `job_title`                   | `title_key64` (via `key64()`) — exact job title matching |
| `linkedin_crunchbase_funding` | `linkedin_company_id`                                    |
| `linkedin_company_slug`       | `slug_key64` (via `key64()`)                             |
| `linkedin_profile_slug`       | `slug_key64` (via `key64()`)                             |

### NOT Indexed (WILL TIMEOUT as primary filter)

- `headline`, `title`, `description`, `locality`, `region`, `location_name`
- Any `ILIKE` on text fields without indexed filter first
- Any multi-table JOIN without indexed FK filter

### ALWAYS Decompose Complex Requests

**NEVER try to satisfy complex user requests with a single query.** ALWAYS decompose:

1. **Top-of-funnel query** - Simple query using ONLY indexed columns, broad results (500+ rows)
2. **Enrichment columns** - Add columns to classify/filter results (AI classification, data lookups)
3. **User filtering** - Let users filter the enriched spreadsheet data

**Example - User asks: "Find lawyers at AI startups in Austin that are hiring"**

❌ **WRONG (WILL TIMEOUT)** - uses locality ILIKE, round_name ILIKE, title ILIKE:

```sql
SELECT ... FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON ...
JOIN linkedin_profile_position3 pos ON ...
WHERE lc.locality ILIKE '%Austin%'      -- NOT INDEXED
  AND f.round_name ILIKE 'Series%'      -- NOT INDEXED
  AND pos.title ILIKE '%lawyer%'        -- NOT INDEXED
  AND EXISTS (SELECT 1 FROM linkedin_job j WHERE ...)
```

✅ **CORRECT** - decompose into indexed queries + enrichment:

1. **Query**: Get companies by `industry_code IN (4,6,96)` (INDEXED) + `domain` lookups
2. **Enrich column**: "Location" - check if company HQ in Austin
3. **Enrich column**: "Has Funding" - check funding via `linkedin_company_id` (INDEXED)
4. **Enrich column**: "Is Hiring" - check jobs via `linkedin_company_id` (INDEXED)
5. **Enrich column**: "Has Legal Staff" - check positions via `linkedin_company_id` (INDEXED)
6. **User filters** spreadsheet by these columns

---

**IMPORTANT:**

1. **Purpose-built services first** — use `company.getEmployeesFromLinkedin` when finding employees at a specific company. It handles deduplication, pagination, and edge cases automatically.
2. **Resolve company first** — if only given company name/domain, resolve to LinkedIn URL using `company.linkedin.findUrl` or `company.linkedin.enrich`, then confirm with the user before calling `company.getEmployeesFromLinkedin`
3. **Raw search/SQL only when needed** — for cross-company queries, complex joins, or when no abstraction exists
4. **⚠️ ALWAYS use `DISTINCT ON` when JOINing normalized tables** — JOINs on funding, positions, education, etc. cause 1.6-17x row multiplication. Use `DISTINCT ON (primary_table.id)` to get one row per entity. See "JOIN Duplicates" section.

---

## 🔍 Query Sanity Check (Do This First!)

**Before writing any query, validate that the user's request maps well to the database schema.** User queries are often vague, use industry jargon, or assume data exists that doesn't. Clarify BEFORE running expensive queries.

### Step 0: Interpret Intent, Not Literal Words

| User Says         | They Probably Mean                                                  | Why It Matters                                                        |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| "AI companies"    | Tech-enabled companies using AI (Edward Jones, Emerson, WWT)        | Pure-play AI startups are rare; most "AI" is at traditional companies |
| "startups"        | Companies with <500 employees, or VC-backed                         | No `is_startup` field; use employee_count + funding data              |
| "tech companies"  | `industry_code IN (4, 6, 96)` OR companies with tech in description | Industry codes are imperfect; many tech companies miscategorized      |
| "lawyers"         | People with legal titles (attorney, counsel, paralegal, compliance) | "Lawyer" alone misses 80% of legal professionals                      |
| "based in [city]" | Company HQ in city, OR person lives in city?                        | Clarify: company location vs person location vs both                  |
| "hiring"          | Has **active, recent** job postings (see ⚠️ HIRING QUERIES below)   | Jobs table is 1.48B rows; **MUST filter for active jobs**             |
| "growing"         | Employee growth >10% in 12mo                                        | Requires `company` table, not `linkedin_company`                      |

### ⚠️ HIRING QUERIES - CRITICAL

**When users ask for "companies that are hiring" or "actively hiring", you MUST filter for active/recent jobs.** The `linkedin_job` table has 1.48B records including many expired postings.

**WRONG - Returns companies with ANY job ever posted (including expired):**

```sql
EXISTS (
  SELECT 1 FROM linkedin_job j 
  WHERE j.linkedin_company_id = lc.id
  -- ❌ No active/recent filter = includes years-old expired jobs!
)
```

**CORRECT - Filter for active, recent jobs:**

```sql
EXISTS (
  SELECT 1 FROM linkedin_job j 
  WHERE j.linkedin_company_id = lc.id
    AND j.closed_since IS NULL                              -- Not closed
    AND (j.valid_until IS NULL OR j.valid_until > NOW())    -- Not expired
    AND j.posted_date >= CURRENT_DATE - INTERVAL '90 days'  -- Recent
)
```

**Key `linkedin_job` columns for filtering active jobs:**

| Column        | Type      | Filter For Active Jobs                    |
| ------------- | --------- | ----------------------------------------- |
| `closed_since`| timestamp | `IS NULL` = job not explicitly closed     |
| `valid_until` | timestamp | `> NOW()` or `IS NULL` = not expired      |
| `posted_date` | date      | `>= CURRENT_DATE - INTERVAL '90 days'`    |

**Adjust the interval based on context:**
- Aggressive/recent: `30 days`
- Standard: `60-90 days` 
- Lenient: `180 days`

---

### When to Ask for Clarification

**ASK the user if:**

- The query combines multiple rare/expensive filters (location + niche role + niche industry)
- The search term doesn't map to indexed columns (will timeout)
- The category is subjective ("innovative companies", "top talent", "good culture")
- Results would likely be <10 or >10,000 (too narrow or too broad)

**Example clarifying questions:**

- "When you say 'AI companies', do you mean pure AI/ML startups, or larger companies using AI in their products? St. Louis has few pure-play AI startups but many tech-enabled companies like World Wide Technology, Edward Jones, and Emerson."
- "For 'lawyers in St. Louis at AI companies' — should I search for people located in St. Louis, or people at companies headquartered in St. Louis (who might work remotely)?"
- "Do you want just 'lawyers/attorneys', or should I include related roles like General Counsel, Paralegals, Compliance Officers, and Legal Assistants?"

### Common Query Pitfalls

| Query Type                                 | Pitfall                                    | Better Approach                                                            |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- |
| "[Role] at [Industry] companies in [City]" | Too many ILIKE filters = timeout           | Get company IDs first (by city + industry), THEN search roles at those IDs |
| "Companies doing [buzzword]"               | Description ILIKE on 50M+ companies = slow | Add `industry_code` filter to narrow first                                 |
| "Find me [niche role]"                     | Rare titles = few results                  | Suggest broader title patterns, confirm with user                          |
| "[Role] in [small city]"                   | Small cities have few tech workers         | Warn user, suggest metro area or remote workers                            |
| "All [X] in the US"                        | 1.15B profiles; any ILIKE = timeout        | Must have company filter or industry constraint                            |

### Query Feasibility Check

Before executing, verify:

1. **Does the filter map to indexed columns?**
   - ✅ `company_id`, `domain`, `slug_key64` (via `key64('slug')`), `industry_code`
   - ❌ `description ILIKE` without industry filter, `headline ILIKE` without company filter

2. **Is the result set size reasonable?**
   - < 10 results: Query too narrow, suggest broadening
   - 100-500 results: Ideal for prospecting
   - > 10,000 results: Too broad, suggest additional filters

3. **Will the query complete in <30s?**
   - ❌ Multiple ILIKE on unindexed columns
   - ❌ Large CTE (1000s of rows) + ILIKE
   - ✅ Indexed filter → small ID set → ILIKE on small set

### Reinterpreting Vague Queries

| Vague Query                | Reinterpretation                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------- |
| "Find me leads"            | "What industry, role, and company size are you targeting?"                         |
| "Companies like Stripe"    | Use Stripe's industry_code, employee_count range, or look at `similar_company_ids` |
| "Decision makers"          | "Which function? (Sales, Engineering, Product, C-Suite)"                           |
| "Recently funded startups" | Companies with funding in last 12mo + employee_count < 500                         |
| "Fast-growing companies"   | `employee_growth_12mo > 0.2` in `company` table                                    |

### The "Expand, Then Filter" Strategy

When the literal query returns too few results:

1. **Broaden the company criteria** — "AI companies" → "tech/software companies (industry 4,6,96)"
2. **Broaden the role criteria** — "lawyers" → "lawyers, attorneys, counsel, legal, paralegal, compliance"
3. **Broaden the location** — "St. Louis" → "Missouri" or "Greater St. Louis metro"
4. **Run the broader query**, then filter/rank results client-side
5. **Report back** — "I found 150 legal professionals at tech companies in the St. Louis area. Here are the top matches..."

**Key insight:** The database has billions of rows, but specific intersections (niche role + niche industry + specific city) are rare. It's better to cast a wider net and filter than to timeout on an overly specific query.

## Output

```ts
const { rows } = await person.linkedin.search({
   sql: "SELECT ... FROM ... WHERE ... LIMIT 100"
});
// rows: Record<string, unknown>[]
```

## Table Schemas

Read schema files in `./linkedin_data/tables/` before using any table.

```
linkedin_data/tables/
├── denormalized/          # For cross-table + text filters
│   ├── lkd_company.md     # 13-93x faster for headline+company
│   └── lkd_profile.md
└── normalized/            # Standard indexed tables
    ├── linkedin_company.md, linkedin_profile.md, linkedin_job.md
    ├── linkedin_crunchbase_funding.md, linkedin_profile_position3.md
    ├── linkedin_profile_education2.md, linkedin_profile_slug.md
    ├── linkedin_company_slug.md, company.md, person.md
```

### Normalized vs Denormalized

| World        | Tables                                       | Use Case                                            |
| ------------ | -------------------------------------------- | --------------------------------------------------- |
| Normalized   | `linkedin_company`, `linkedin_profile`, etc. | ID lookups, indexed filters                         |
| Denormalized | `lkd_company`, `lkd_profile`                 | Headline ILIKE + company constraint (13-93x faster) |

**NEVER mix:** `lkd_profile JOIN linkedin_company` = BROKEN

### Column Name Differences

| Normalized                      | Denormalized               | Notes        |
| ------------------------------- | -------------------------- | ------------ |
| `lp.id`                         | `lkd.profile_id`           | PK           |
| `lp.location_country_code`      | `lkd.country_iso`          | US filter    |
| `lp.public_profile_url`         | `lkd.url`                  | LinkedIn URL |
| `lc.id`                         | `lkdc.linkedin_company_id` | PK           |
| `lc.country_code`               | `lkdc.country_iso`         | US filter    |
| (construct from universal_name) | `lkdc.linkedin_url`        | URL          |

## Query Methodology

### Step 1: Parse Request

| Component     | Extract                         |
| ------------- | ------------------------------- |
| Target Entity | Companies or People?            |
| Filters       | Size, industry, location, title |
| Signals       | Hiring, funding, growth         |
| Output        | Required columns                |

### Step 2: Check Indexes

**Indexed (Fast):**
| Table | Indexed Column | Speed |
|-------|----------------|-------|
| `linkedin_company` | `id`, `domain` | 5-50ms |
| `linkedin_company_slug` | `slug_key64` (use `key64('slug')`) | 4-7ms |
| `linkedin_job` | `linkedin_company_id` | 18-122ms |
| `linkedin_profile_position3` | `linkedin_company_id`, `linkedin_profile_id` | 500ms |
| `linkedin_profile_slug` | `slug_key64` (use `key64('slug')`) | 400ms |
| `linkedin_crunchbase_funding` | `linkedin_company_id` | Fast |

**Non-Indexed (Apply After Index Lookup):**
| Column | Risk | Workaround |
|--------|------|------------|
| `company_name ILIKE` | TIMEOUT | Use `domain` or `key64('slug')` via `linkedin_company_slug` |
| `job.title ILIKE` (no company filter) | TIMEOUT | Filter `linkedin_company_id` first |
| `position.title ILIKE` (no company filter) | TIMEOUT | Filter `linkedin_company_id` first |
| `headline ILIKE` | Slow | Use `industry_code` or denormalized |

### Step 3: Query Sequence

```
Indexed filters → Collect IDs → Non-indexed filters → Enrich
```

**Pattern A: Employees at Specific Company**

```
Use company.getEmployeesFromLinkedin (handles deduplication, pagination, edge cases)
1. If only have name/domain → resolve to LinkedIn URL first
2. Confirm with user it's the correct company
3. Call company.getEmployeesFromLinkedin with titlePattern if needed
```

**Pattern B: Cross-Company Query**

```
1. Get reference data (industry codes)
2. Filter linkedin_company → collect company IDs
3. Apply signal filters (jobs, funding) using IDs
4. Find people at those companies (raw SQL needed for multi-company)
5. Enrich with details
```

**Pattern C: Person Lookup**

```
1. Look up person by slug (use key64)
2. Get positions → find current company
3. Enrich with company details
```

### Step 4: Execute with Explicit IDs or Small CTEs

**CTE Behavior:** PostgreSQL materializes CTEs. This can be good or bad:

| CTE Result Size     | Behavior                             | Recommendation                |
| ------------------- | ------------------------------------ | ----------------------------- |
| Small (< 200 rows)  | CTE acts as optimization fence, fast | ✅ Use CTE                    |
| Large (1000s+ rows) | Materializes huge list, slow         | ❌ Use explicit IDs or EXISTS |

```sql
-- BAD: CTE with large result (1000s of companies)
WITH target AS (SELECT id FROM linkedin_company WHERE industry_code = 4)  -- Returns 1M+ rows!
SELECT * FROM linkedin_job WHERE linkedin_company_id IN (SELECT id FROM target)  -- TIMEOUT

-- GOOD: CTE with small, highly-filtered result (note: DISTINCT removes funding duplicates)
WITH target AS (
  SELECT DISTINCT lc.id
  FROM linkedin_company lc
  JOIN linkedin_crunchbase_funding cf ON cf.linkedin_company_id = lc.id
  WHERE lc.locality ILIKE '%Austin%' AND lc.region ILIKE '%Texas%'
    AND cf.round_name ILIKE 'Series C%'
)  -- Returns ~50 unique company IDs (DISTINCT handles duplicate funding entries)
SELECT * FROM linkedin_job WHERE linkedin_company_id IN (SELECT id FROM target)  -- FAST

-- GOOD: Explicit IDs (when you have them from a previous query)
SELECT * FROM linkedin_job WHERE linkedin_company_id IN (123, 456, 789, ...)
```

**Rule of thumb:** If your CTE filters to < 200 rows (like a specific city + funding stage), CTEs work great. If the CTE would return 1000s+ rows, use explicit IDs or EXISTS.

**Batch Sizes:**
| Table | Batch Size | Time |
|-------|------------|------|
| `linkedin_job` by company_id | 200-500 IDs | 3-10s |
| `linkedin_profile_position3` by company_id | 100-200 IDs | 2-5s |
| `linkedin_company` by id | 500-1000 IDs | 1-3s |

### Step 5: Non-Indexed Filters Last

```sql
-- CORRECT: Index first, ILIKE second
SELECT j.title, lc.company_name
FROM linkedin_job j
JOIN linkedin_company lc ON lc.id = j.linkedin_company_id
WHERE j.linkedin_company_id IN (123, 456, 789)  -- indexed
  AND j.title ILIKE '%sales development%'       -- applied to small set

-- WRONG: ILIKE on full table (scans 1.48B rows)
SELECT * FROM linkedin_job WHERE title ILIKE '%sales development%'
```

## Anti-Patterns

| Don't                                            | Do                                                                  | Why                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Raw SQL for employees at single company          | `company.getEmployeesFromLinkedin`                         | Handles dedup, pagination                             |
| CTE returning 1000s+ rows                        | Explicit ID list or EXISTS                                          | Large CTEs materialize slowly                         |
| CTE with broad filter (industry alone)           | CTE with narrow filter (city + funding)                             | Small CTEs (< 200 rows) are fast                      |
| `job.title ILIKE` without company filter         | Filter `linkedin_company_id` first                                  | 1.48B rows scanned otherwise                          |
| `position.title ILIKE` without company filter    | Filter by company IDs first                                         | 2.6B rows scanned otherwise                           |
| Skip LIMIT                                       | Always LIMIT                                                        | Tables are massive                                    |
| `WHERE lc.universal_name = 'x'`                  | `WHERE lcs.slug_key64 = key64('x')` via `linkedin_company_slug lcs` | universal_name not reliable, key64 is indexed         |
| `WHERE slug = 'x'`                               | `WHERE slug_key64 = key64('x')`                                     | slug not indexed, key64 is                            |
| Query all jobs to find hiring companies          | Get company IDs first, then jobs                                    | Jobs table is 1.48B rows                              |
| **`EXISTS (job)` without active filter**         | **Filter: `closed_since IS NULL`, `valid_until > NOW()`, recent `posted_date`** | **Returns expired jobs = false "hiring" results**     |
| **JOIN without DISTINCT ON**                     | **ALWAYS use `DISTINCT ON (primary.id)`**                           | 1.6-17x row multiplication — users get duplicate rows |
| `IN (SELECT ...)` large subqueries (1000s+)      | `EXISTS` (2-17x faster)                                             | IN materializes full list                             |
| Filter by company locality without region        | Include region too                                                  | "Austin" exists in multiple states                    |
| Person location + title filter in same query     | Filter by company first, then client-side                           | Person location ILIKE on large joins = timeout        |
| Confusing headline whitelist with position title | Whitelist = headline only, not `pos.title`                          | `pos.title` is fast when company-filtered             |

## IN vs EXISTS

`IN (SELECT ...)` with large subquery = TIMEOUT + alphabetical ordering. `EXISTS` stops at first match (2-17x faster).

| Scenario                 | Use                  |
| ------------------------ | -------------------- |
| Small, static list       | `IN ('a', 'b', 'c')` |
| Large subquery (1000s+)  | `EXISTS`             |
| Avoid alphabetical order | `EXISTS`             |
| `NOT` logic with NULLs   | `NOT EXISTS`         |

**Balanced results:** Use `UNION ALL` with per-company limits instead of `IN (id1, id2, id3)` which returns alphabetically.

## ⚠️ JOIN Duplicates (ALWAYS Use DISTINCT ON)

**JOINs on normalized tables cause row multiplication.** The same company/person will appear multiple times if they have multiple funding rounds, positions, or education entries. `DISTINCT` alone often doesn't help because non-key columns differ.

**RULE: ALWAYS use `DISTINCT ON (primary_table.id)` when JOINing normalized tables, unless the user explicitly asks for duplicate rows (e.g., "show me all funding rounds for each company").**

| Table Joined                  | Multiplication      | Why                                 |
| ----------------------------- | ------------------- | ----------------------------------- |
| `linkedin_crunchbase_funding` | 1.6x avg, up to 17x | Multiple funding rounds per company |
| `linkedin_profile_position3`  | 1.7x avg, up to 14x | Multiple positions per person       |
| `linkedin_profile_education2` | 1.5x avg, up to 21x | Multiple schools per person         |
| `linkedin_company` by domain  | 10-30x              | Subsidiaries, regional entities     |

### DISTINCT ON Pattern

```sql
-- GOOD: One row per company, most recent funding round
SELECT DISTINCT ON (lc.id)
  lc.company_name, lc.website, f.round_amount, f.round_date
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
WHERE lc.country_code = 'US' AND f.round_name = 'Series A'
ORDER BY lc.id, f.round_date DESC  -- id for DISTINCT ON, then order by recency
LIMIT 100;
```

**Other approaches:** Two-step (get unique IDs first, then enrich), LATERAL JOIN for latest record, or `ORDER BY employee_count DESC NULLS LAST LIMIT 1` for domain lookups.

> **See `./search_examples/company/funding.md`** for more JOIN patterns with funding data.

## Critical Rules

| Rule                                                    | Reason                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| **ALWAYS filter for ACTIVE jobs when checking "hiring"**| Without: `closed_since`, `valid_until`, `posted_date` filters, you get expired jobs |
| **ALWAYS `DISTINCT ON (id)` with JOINs**                | JOINs cause 1.6-17x duplicates; users don't want duplicate rows |
| Use `industry_code IN (4, 6, 96)` for description ILIKE | Without it, scans billions of rows                              |
| Never `ILIKE ... AND ... ILIKE`                         | 2 scans × 12s = 24s. Use `%AI%video%` or OR                     |
| Use `key64('slug')` for slug lookups                    | Direct slug NOT indexed. 100x faster                            |
| Always LIMIT                                            | Without: millions of rows → timeout                             |
| Required aliases: `lp` (person), `lc` (company)         | Column name ambiguity                                           |
| Don't return raw IDs to users                           | Return names, domains, URLs                                     |
| Check headline whitelist                                | Whitelist → normalized, else → denormalized                     |

### Headline Whitelist (ONLY applies to headline search)

**IMPORTANT:** This whitelist ONLY applies to searching `lp.headline` directly. It does NOT apply to:

- `pos.title` (position title) - indexed by `linkedin_company_id`, fast when company-filtered
- `lp.title` (current title on profile) - similar to headline

```
WHITELIST (normalized headline search): engineer, developer, software, manager, director,
sales, marketing, product, analyst, consultant, operations, finance, founder, data, cto

NOT on whitelist → denormalized (lkd_profile, lkd_company) for headline search
```

**Headline vs Position Title - Key Distinction:**

| Field         | Table                        | When to Use                                              | Performance                                    |
| ------------- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `lp.headline` | `linkedin_profile`           | Searching ALL profiles by what they say about themselves | Use whitelist rules                            |
| `pos.title`   | `linkedin_profile_position3` | Searching job titles at SPECIFIC companies               | Fast when `linkedin_company_id` filtered first |
| `lp.title`    | `linkedin_profile`           | Current title (denormalized)                             | Similar to headline                            |

**Example: "Find lawyers at [specific companies]"**

- Use `pos.title ILIKE '%lawyer%'` with company filter → FAST (normalized)
- The whitelist does NOT apply because you're searching positions, not headlines

**Example: "Find all lawyers in the US"**

- Searching `lp.headline ILIKE '%lawyer%'` without company filter → SLOW
- "lawyer" not on whitelist → use denormalized `lkd_profile`

## US Filtering

Default to US unless user specifies otherwise.

| Table              | US Filter                         |
| ------------------ | --------------------------------- |
| `linkedin_company` | `lc.country_code = 'US'`          |
| `linkedin_profile` | `lp.location_country_code = 'US'` |
| `lkd_profile`      | `lkd.country_iso = 'US'`          |
| `company`          | `country_name = 'United States'`  |

**Multi-table queries:** Filter BOTH person AND company location.

## IDs: Internal Use Only

Use IDs in WHERE/JOIN/subqueries. Don't return to users.

| Instead of | Return                                         |
| ---------- | ---------------------------------------------- |
| `lc.id`    | `lc.company_name`, `lc.website`, `lc.domain`   |
| `lp.id`    | `lp.first_name`, `lp.last_name`, `lp.headline` |

**Always include LinkedIn URLs:**

```sql
-- Companies
'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url

-- People
lp.public_profile_url AS lp_linkedin_url
```

## Normalized vs Denormalized Decision

Table sizes: `linkedin_profile` ~1.15B rows, `linkedin_company` ~millions (100-1000x smaller)

### Whitelist Performance

| Term       | Time | Term       | Time |
| ---------- | ---- | ---------- | ---- |
| analyst    | 0.2s | operations | 0.3s |
| manager    | 0.5s | sales      | 0.7s |
| engineer   | 0.9s | cto        | 1.1s |
| software   | 1.2s | data       | 1.5s |
| director   | 1.5s | marketing  | 2.2s |
| consultant | 2.3s | finance    | 2.9s |
| developer  | 3.1s | product    | 3.3s |
| founder    | 4.8s |            |      |

**Borderline (5-10s):** designer, vp, recruiter, scientist

**Non-whitelist examples:**
| Category | Normalized | Denormalized |
|----------|------------|--------------|
| C-suite (ceo, cfo) | 16-30s | 1.0s |
| Tech (python, react, aws) | 10-30s | 0.3-1.5s |
| Professions (lawyer, doctor) | 8-19s | 0.7s |
| Niche (devrel, growth hacker) | timeout | 1-2s |

### Decision Trees

**Profile-Only:**

```
ID/slug/updated_at (indexed) → NORMALIZED
Numeric (connections, followers) → NORMALIZED
Single skill array → DENORMALIZED
Headline WHITELIST term → NORMALIZED
Headline OTHER term → DENORMALIZED
3+ filters → DENORMALIZED
```

**Cross-Table:**

```
Company description only → NORMALIZED (33-123x faster)
Profile headline:
  WHITELIST → NORMALIZED (0.2-5s)
  Non-whitelist → DENORMALIZED
Profile text (non-whitelist) + company → DENORMALIZED (13-93x faster)
```

## Valid Table Combinations

| World        | Person             | Company            |
| ------------ | ------------------ | ------------------ |
| Normalized   | `linkedin_profile` | `linkedin_company` |
| Denormalized | `lkd_profile`      | `lkd_company`      |

**NEVER:** `lkd_profile JOIN linkedin_company` or vice versa

## Rare Pattern Workaround

If NOT on whitelist, use denormalized. If still slow, broaden SQL + filter client-side:

| Rare (times out)  | Broader      | Filter client-side |
| ----------------- | ------------ | ------------------ |
| `%iOS developer%` | `%mobile%`   | iOS in results     |
| `%Rust engineer%` | `%engineer%` | Rust in results    |

## Industry Codes

| Code | Name                              |
| ---- | --------------------------------- |
| 4    | Computer Software                 |
| 6    | Information Technology & Services |
| 96   | IT Services and IT Consulting     |
| 25   | Manufacturing                     |
| 48   | Construction                      |
| 44   | Real Estate                       |

```sql
WHERE lc.industry_code IN (4, 6, 96)
```

## Required Aliases

| Table                         | Alias | Required  |
| ----------------------------- | ----- | --------- |
| `linkedin_profile`            | `lp`  | Yes       |
| `linkedin_company`            | `lc`  | Yes       |
| `linkedin_profile_position3`  | `pos` | Suggested |
| `linkedin_profile_education2` | `edu` | Suggested |
| `linkedin_crunchbase_funding` | `f`   | Suggested |
| `linkedin_job`                | `j`   | Suggested |

## Example Queries

> **See `./search_examples/` for detailed SQL examples with performance benchmarks.**
>
> - Person queries: `./search_examples/person/joins.md`, `./search_examples/person/headline-search.md`
> - Company queries: `./search_examples/company/lookups.md`, `./search_examples/company/funding.md`

## Pattern Index

### Person Queries

| Need                                     | File                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| Find by slug/company ID                  | `./search_examples/person/lookups.md`         |
| Search by headline                       | `./search_examples/person/headline-search.md` |
| **Find employees at a specific company** | **Use `company.getEmployeesFromLinkedin`**         |
| Find people across multiple companies    | `./search_examples/person/joins.md`           |
| Query by school/degree                   | `./search_examples/person/education.md`       |
| Find by skills                           | `./search_examples/person/certifications.md`  |
| Former employees                         | `./search_examples/person/alumni.md`          |
| Anti-patterns                            | `./search_examples/person/anti-patterns.md`   |

### Company Queries

| Need                     | File                                                            |
| ------------------------ | --------------------------------------------------------------- |
| Find by domain/slug/name | `./search_examples/company/lookups.md`            |
| Search by description    | `./search_examples/company/description-search.md` |
| Funding rounds           | `./search_examples/company/funding.md`            |
| Employee growth          | `./search_examples/company/growth.md`             |
| Job postings + **exact title matching** | `./search_examples/company/jobs.md`               |
| **Companies hiring for [exact role]** | `./search_examples/company/jobs.md` — use `key64()` |
| Anti-patterns            | `./search_examples/company/anti-patterns.md`      |

### Cross-Entity Queries

| Need                                          | File/Section                                       |
| --------------------------------------------- | -------------------------------------------------- |
| **⚠️ "Companies that are hiring"**            | **⚠️ HIRING QUERIES - CRITICAL** + `./search_examples/company/jobs.md` |
| People by role at companies matching criteria | `./search_examples/person/joins.md`                |
| Funding stage filtering (Series A, B, C+)     | `./search_examples/company/funding.md`             |
| Location filtering (company HQ vs person)     | `./search_examples/person/joins.md`                |
| Role/title search patterns                    | `./search_examples/person/headline-search.md`      |
| When to use CTEs vs explicit IDs              | Step 4: Execute with Explicit IDs or Small CTEs    |

## Data Quality

- **Domain lookups return multiple records** — `stripe.com` returns 28 companies. Always use `ORDER BY employee_count DESC NULLS LAST LIMIT 1`
- **Slug lookups** — Use `key64('slug')` with `linkedin_company_slug` table (see `./search_examples/company/lookups.md`)
- **Sparse fields (avoid):** `specialties`, `has_careers`, `influencer`, `rank_fortune`

## Prospecting Patterns

> **For detailed SQL examples and performance benchmarks, see:**
> - `./search_examples/person/joins.md` — Multi-table joins, people by role at companies
> - `./search_examples/company/funding.md` — Funding stage patterns
> - `./search_examples/company/jobs.md` — Hiring queries, exact title matching
> - `./search_examples/company/lookups.md` — Company by domain/slug/URL
> - `./search_examples/person/lookups.md` — Person by slug/URL

**Strategy: Company-first, two-phase approach**

1. Filter companies by criteria (small set: 50-200 companies)
2. Find people with target role at those companies

**Key patterns:**

| Pattern | See File |
| ------- | -------- |
| People by role at funded companies | `./search_examples/person/joins.md` |
| Funding stage filters (Seed, Series A-C+) | `./search_examples/company/funding.md` |
| Companies hiring for exact role | `./search_examples/company/jobs.md` |
| Location filtering (company HQ vs person) | `./search_examples/person/joins.md` |
| Decision makers at target companies | Use `company.getEmployeesFromLinkedin` or `./search_examples/person/joins.md` |
| Company/Person by LinkedIn URL | `./search_examples/company/lookups.md`, `./search_examples/person/lookups.md` |

**Role/Title patterns table:**

| Role Category | Title Patterns |
| ------------- | -------------- |
| Legal | `'%lawyer%'`, `'%attorney%'`, `'%counsel%'`, `'%legal%'` |
| Engineering | `'%engineer%'`, `'%developer%'`, `'%swe%'` |
| Sales | `'%sales%'`, `'%account executive%'`, `'%ae%'`, `'%sdr%'`, `'%bdr%'` |
| Marketing | `'%marketing%'`, `'%growth%'`, `'%demand gen%'` |
| C-Suite | `'%ceo%'`, `'%cto%'`, `'%cfo%'`, `'%chief%'` |
| VP+ | `'%vp%'`, `'%vice president%'`, `'%svp%'`, `'%evp%'` |

**Funding stage patterns:**

| Stage | round_name Pattern |
| ----- | ------------------ |
| Seed | `'Seed%'` |
| Series A | `'Series A%'` |
| Series B | `'Series B%'` |
| Series C+ | `'Series C%' OR 'Series D%' OR ...` |

## Execution Times

| Query Type                | Expected | If Slower            |
| ------------------------- | -------- | -------------------- |
| Company by domain/id      | 5-50ms   | Domain may not exist |
| Company by industry       | 1-5s     | Reduce LIMIT         |
| Jobs at company           | 18-122ms | Normal               |
| Jobs batch (200-500)      | 3-10s    | Reduce batch         |
| Positions at company      | 500ms-2s | Normal               |
| Positions batch (100-200) | 2-10s    | Reduce batch         |
| Profile by slug (key64)   | 400ms    | Use key64()          |
| Headline ILIKE (denorm)   | 2-15s    | Broader pattern      |

**30s timeout.** Redesign if exceeded.

## Query Algorithm

```
0. CHECK for purpose-built service:
   - Employees at specific company → company.getEmployeesFromLinkedin
   - If only have name/domain → resolve to LinkedIn URL first, confirm with user

0b. CHECK for "hiring" queries:
   - If user asks for "companies that are hiring" or "actively hiring"
   - MUST filter jobs: closed_since IS NULL, valid_until > NOW(), posted_date recent
   - See "⚠️ HIRING QUERIES - CRITICAL" section

1. PARSE: target entity, filters, signals, output columns

2. CHECK headline terms:
   WHITELIST: engineer, developer, software, manager, director, sales,
              marketing, product, analyst, consultant, operations, finance,
              founder, data, cto
   On list → normalized. Not on list → denormalized.

3. CHECK indexes: indexed → use directly, non-indexed → apply after

4. DESIGN sequence: indexed filters → collect IDs → non-indexed → enrich

5. ⚠️ ADD DISTINCT ON: If query has ANY JOIN on normalized tables (funding, positions,
   education, slugs), ALWAYS add DISTINCT ON (primary_table.id) to prevent duplicates.
   Only skip if user explicitly wants all rows (e.g., "show all funding rounds").

6. EXECUTE: 200-500 IDs (jobs), 100-200 IDs (positions), explicit lists NOT CTEs

7. MERGE and return
```
