# Company Job Postings

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Query job postings at companies. Performance: ✅ 18-122ms with company filter.

---

## ⚠️ Job Queries: Indexed vs Non-Indexed Columns

**Indexed (FAST):**

- `linkedin_company_id` — job queries filtered by company are fast
- `title_id` (FK to `job_title`) — enables exact job title matching across all 1.48B jobs

**NOT Indexed (SLOW without company filter):**

- `title`, `salary_max`, `location`, `address_locality` — filtering these across all jobs will timeout

---

## 🚨 CRITICAL: Browser Verification Required

**Before taking action on any job posting (outreach, reporting to users, etc.), you MUST verify that the job posting is still valid AND active by checking it in the browser.**

Job data can be stale — postings may have been:

- Closed or filled since the data was indexed
- Expired but not yet removed from the database
- Updated with different requirements

**Verification workflow:**

1. Query returns job postings from database
2. **MUST** use browser to visit each job's LinkedIn page
3. Check for "No longer accepting applications" message
4. Only return/proceed with jobs that are actually open

This ensures data quality and prevents embarrassing outreach about positions that no longer exist.

---

## 🎯 Exact Job Title Matching (GTM Pattern)

**Use Case:** "Find companies hiring for [exact role]" — e.g., "companies hiring Software Engineers"

The `linkedin_job` table has a `title_id` column (FK to `job_title`), and `job_title.title_key64` is indexed with the `key64()` function. This enables O(1) exact job title lookups across **1.48B job postings**.

### How It Works

```sql
-- Step 1: Get the job_title ID using key64 (35ms)
SELECT id, title FROM job_title WHERE title_key64 = key64('Software Engineer');
-- Returns: id = 64, title = "Software Engineer"

-- Step 2: Find all jobs with that exact title (11ms)
SELECT lj.company_name, lj.location, lj.salary_range, lj.posted_timestamp
FROM linkedin_job lj
JOIN job_title jt ON lj.title_id = jt.id
WHERE jt.title_key64 = key64('Software Engineer')
  AND lj.closed_since IS NULL                              -- Active jobs only
  AND (lj.valid_until IS NULL OR lj.valid_until > NOW())
  AND lj.posted_date >= CURRENT_DATE - INTERVAL '90 days'
LIMIT 100;
```

### Companies Hiring for Exact Role

```sql
-- Find companies actively hiring "Software Engineers" (exact title)
SELECT DISTINCT ON (lc.id)
  lc.company_name,
  lc.website,
  'https://www.linkedin.com/company/' || lc.universal_name AS linkedin_url,
  lc.employee_count,
  lc.locality AS city,
  lc.region AS state
FROM linkedin_company lc
JOIN linkedin_job lj ON lj.linkedin_company_id = lc.id
JOIN job_title jt ON lj.title_id = jt.id
WHERE jt.title_key64 = key64('Software Engineer')
  AND lc.country_code = 'US'
  AND lj.closed_since IS NULL
  AND (lj.valid_until IS NULL OR lj.valid_until > NOW())
  AND lj.posted_date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY lc.id
LIMIT 100;
```

### Funding Stage + Exact Title (Great GTM Pattern ~7s)

```sql
-- Series A companies hiring for exact role
SELECT DISTINCT ON (lc.id)
  lc.company_name,
  lc.website,
  'https://www.linkedin.com/company/' || lc.universal_name AS linkedin_url,
  lc.employee_count,
  f.round_name AS funding_round,
  f.round_amount AS funding_amount
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
WHERE lc.country_code = 'US'
  AND f.round_name ILIKE 'Series A%'
  AND EXISTS (
    SELECT 1 FROM linkedin_job lj
    JOIN job_title jt ON lj.title_id = jt.id
    WHERE lj.linkedin_company_id = lc.id
      AND jt.title_key64 = key64('Software Engineer')
      AND lj.closed_since IS NULL
  )
ORDER BY lc.id, f.round_date DESC
LIMIT 100;
```

### Multiple Exact Titles

```sql
-- Query multiple exact titles with IN()
SELECT jt.title, AVG(lj.salary_min) as avg_min, COUNT(*) as cnt
FROM linkedin_job lj
JOIN job_title jt ON lj.title_id = jt.id
WHERE jt.title_key64 IN (
  key64('Software Engineer'),
  key64('Data Scientist'),
  key64('Product Manager')
)
AND lj.salary_min IS NOT NULL
AND lj.salary_currency_id = 150  -- USD
GROUP BY jt.title;
```

---

## ⚡ Exact Title Query Performance Guide

### Fast Patterns (< 10s) — Use These

| Pattern                              | Time   | Example                                                |
| ------------------------------------ | ------ | ------------------------------------------------------ |
| Simple COUNT for exact title         | ~500ms | `SELECT COUNT(*) ... WHERE title_key64 = key64('CEO')` |
| Exact title + job `address_locality` | ~600ms | `WHERE ... AND lj.address_locality ILIKE '%Austin%'`   |
| Recent jobs + ORDER BY date          | ~3-4s  | `WHERE posted_date >= ... ORDER BY posted_date DESC`   |
| Funding stage + exact title          | ~7-8s  | Series A/B/C JOIN + EXISTS with exact title            |
| Industry filter + exact title        | ~8-9s  | `industry_code IN (4,6,96)` + EXISTS                   |
| Multiple exact titles with IN()      | ~10s   | `title_key64 IN (key64('A'), key64('B'))`              |

### Slow Patterns (20-35s) — Use Carefully

| Pattern                     | Time | Issue                              |
| --------------------------- | ---- | ---------------------------------- |
| EXISTS + company size range | ~23s | Scans many companies               |
| Exact title + salary filter | ~25s | `salary_min IS NOT NULL` filtering |
| COUNT per company GROUP BY  | ~34s | Aggregation on large result        |

### Timeout Patterns — AVOID

| Pattern                               | Why It Fails                                                      |
| ------------------------------------- | ----------------------------------------------------------------- |
| **Company `locality ILIKE` + EXISTS** | Company locality NOT indexed — use job `address_locality` instead |
| UNION of multiple title COUNTs        | Each COUNT scans millions of rows                                 |
| GROUP BY industry + EXISTS            | Aggregation with subquery = timeout                               |
| Multiple title counts per company     | Complex double-join + GROUP BY                                    |

### Critical Rules

1. **Filter job attributes, not company attributes** — `lj.address_locality ILIKE '%Austin%'` is fast (600ms), but `lc.locality ILIKE '%Austin%'` is slow (50s+) because the job table is already filtered by `title_id`

2. **Multiple exact titles work** — Use `IN()`:

   ```sql
   WHERE jt.title_key64 IN (key64('Software Engineer'), key64('Data Scientist'))
   ```

3. **Funding + exact title is a great GTM pattern** (~7s)

4. **Avoid GROUP BY with EXISTS** — Combining aggregation with EXISTS subqueries times out

5. **ORDER BY posted_date works** — Sorting by job date is fast when combined with exact title filter

```sql
-- ✅ FAST: Filter job location (600ms)
WHERE jt.title_key64 = key64('Account Executive')
  AND lj.address_locality ILIKE '%San Francisco%'

-- ❌ SLOW: Filter company location (50s+ timeout)
WHERE jt.title_key64 = key64('Account Executive')
  AND lc.locality ILIKE '%San Francisco%'
```

---

## Exact Match vs ILIKE

| Approach                                             | Performance | Use Case                                |
| ---------------------------------------------------- | ----------- | --------------------------------------- |
| `job_title.title_key64 = key64('Software Engineer')` | ⚡ 11-35ms  | Exact title match across all 1.48B jobs |
| `j.title ILIKE '%engineer%'` with company filter     | ✅ 18-122ms | Pattern match at specific companies     |
| `j.title ILIKE '%engineer%'` without company filter  | ❌ TIMEOUT  | Never do this — 1.48B rows              |

**Note:** For fuzzy/pattern matching (e.g., "any engineer role"), use `j.title ILIKE '%engineer%'` with a company filter first. Exact title matching is only for when you know the precise job title.

---

## Pattern Matching (With Company Filter)

**For PROSPECTING ("find companies hiring for X role"), decompose:**

1. **Get companies**: Query companies by `industry_code` or `domain` (indexed) → company list
2. **Enrichment column**: Add "Is Hiring [Role]" column - query jobs by `linkedin_company_id` (indexed) + title filter on small result
3. **Enrichment column**: Add "Has High Salary Roles" column - similar approach
4. **User filtering**: Let users filter the spreadsheet

**When to use direct JOINs (patterns below):**

- Querying jobs at a SPECIFIC company (company ID filter)
- Small company lists with LIMIT

---

## ⚠️ Companies That Are Hiring (EXISTS Pattern)

**CRITICAL: Always filter for ACTIVE jobs when searching for "hiring" companies!**

```sql
-- One-query pattern with EXISTS (for "companies that are hiring")
SELECT DISTINCT ON (lc.id)
  lc.company_name AS name,
  lc.website,
  'https://www.linkedin.com/company/' || lc.universal_name AS linkedin_url,
  lc.employee_count,
  lc.industry,
  lc.locality AS city,
  lc.region AS state,
  lc.description
FROM linkedin_company lc
WHERE lc.country_code = 'US'
  AND lc.employee_count BETWEEN 50 AND 500
  AND EXISTS (
    SELECT 1 FROM linkedin_job j
    WHERE j.linkedin_company_id = lc.id
      AND j.closed_since IS NULL                              -- ⚠️ REQUIRED: Not closed
      AND (j.valid_until IS NULL OR j.valid_until > NOW())    -- ⚠️ REQUIRED: Not expired
      AND j.posted_date >= CURRENT_DATE - INTERVAL '90 days'  -- ⚠️ REQUIRED: Recent
  )
ORDER BY lc.id
LIMIT 100;
```

### With Funding Filter (Recently Funded Companies That Are Hiring)

```sql
SELECT DISTINCT ON (lc.id)
  lc.company_name AS name,
  lc.website,
  'https://www.linkedin.com/company/' || lc.universal_name AS linkedin_url,
  lc.employee_count,
  f.round_name AS funding_round,
  f.round_amount AS funding_amount,
  f.round_date AS funding_date
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
WHERE lc.country_code = 'US'
  AND f.round_name = 'Seed'
  AND f.round_date >= '2023-01-01'
  AND EXISTS (
    SELECT 1 FROM linkedin_job j
    WHERE j.linkedin_company_id = lc.id
      AND j.closed_since IS NULL
      AND (j.valid_until IS NULL OR j.valid_until > NOW())
      AND j.posted_date >= CURRENT_DATE - INTERVAL '90 days'
  )
ORDER BY lc.id, f.round_date DESC
LIMIT 100;
```

### Step-by-Step Pattern (With Explicit IDs)

```sql
-- Step 1: Get company IDs
SELECT id FROM linkedin_company
WHERE employee_count BETWEEN 200 AND 500 AND country_code = 'US'
  AND industry_code IN (25, 55, 135) LIMIT 500;

-- Step 2: Check ACTIVE jobs (explicit IDs) - MUST include active job filters!
SELECT DISTINCT j.linkedin_company_id, j.title FROM linkedin_job j
WHERE j.linkedin_company_id IN (123, 456, 789, ...)
  AND j.title ILIKE '%business development representative%'
  AND j.closed_since IS NULL                              -- Not closed
  AND (j.valid_until IS NULL OR j.valid_until > NOW())    -- Not expired
  AND j.posted_date >= CURRENT_DATE - INTERVAL '90 days'  -- Recent
LIMIT 100;

-- Step 3: Enrich
SELECT company_name, website, domain FROM linkedin_company WHERE id IN (matched_ids);
```

---

## Company-First Lookups: Use Normalized

Job queries starting with a company ID are company-first patterns where normalized tables win.

| Pattern                 | Normalized | Denormalized | Winner             |
| ----------------------- | ---------- | ------------ | ------------------ |
| Jobs at company ID      | **18ms**   | ~80ms        | Normalized (~4x)   |
| Jobs with salary filter | **122ms**  | ~300ms       | Normalized (~2.5x) |

**Why?** The `linkedin_company_id` index on `linkedin_job` allows fast filtering.

**When to use denormalized:** If you need to add profile text filters (e.g., "find engineers at companies hiring for X role"), use `lkd_profile JOIN lkd_company`. But for job-only queries, stick with normalized.

---

## Jobs at Company by ID (~18ms)

**Why it's fast:** `linkedin_company_id` is indexed.

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT j.title AS j_title,
         j.location AS j_location,
         j.salary_range AS j_salary_range,
         j.posted_date AS j_posted_date
  FROM linkedin_job j
  WHERE j.linkedin_company_id = 2135371  -- Stripe
  LIMIT 20
`
});
```

---

## High-Paying Engineering Roles (~122ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.universal_name AS lc_linkedin_slug,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         j.title AS j_title,
         j.salary_range AS j_salary_range,
         j.salary_max AS j_salary_max,
         j.location AS j_location
  FROM linkedin_company lc
  JOIN linkedin_job j ON j.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND j.salary_max > 200000
    AND j.title ILIKE '%engineer%'
  LIMIT 20
`
});
```

---

## Jobs at Multiple Companies

```typescript
const companyIds = [2135371, 11130470, 1441]; // Stripe, OpenAI, Google
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         j.title AS j_title,
         j.location AS j_location,
         j.posted_date AS j_posted_date
  FROM linkedin_company lc
  JOIN linkedin_job j ON j.linkedin_company_id = lc.id
  WHERE j.linkedin_company_id IN (${companyIds.join(",")})
  LIMIT 50
`
});
```

**⚠️ Ordering Note:** Results come back in numeric ID order (smallest ID first). With LIMIT 50, you may only get jobs from the company with the smallest ID if it has 50+ jobs. For balanced results across companies, use UNION ALL with per-company limits. See `QUICK_REF.md` → "IN vs EXISTS" section.

---

## Job Table Columns

| Column                | Type | Notes                         |
| --------------------- | ---- | ----------------------------- |
| `title`               | text | Job title                     |
| `location`            | text | Job location                  |
| `salary_range`        | text | Human-readable: "$150k-$200k" |
| `salary_min`          | int  | Minimum salary                |
| `salary_max`          | int  | Maximum salary                |
| `posted_date`         | date | When posted                   |
| `linkedin_company_id` | int  | **Indexed** - filter by this  |

---

## ❌ What NOT to Do

### ❌ Remote Jobs with Date Filter - TIMEOUT

**Why it fails:** Location ILIKE + date filter requires scanning entire job table.

```typescript
// ❌ TIMEOUT
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT j.title AS j_title, j.location AS j_location
  FROM linkedin_job j
  WHERE j.location ILIKE '%remote%'
    AND j.posted_date >= '2024-06-01'
  LIMIT 20
`
});

// ✅ WORKS: Filter by company_id first
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT j.title AS j_title, j.location AS j_location
  FROM linkedin_job j
  WHERE j.linkedin_company_id = 2135371
    AND j.location ILIKE '%remote%'
  LIMIT 20
`
});
```

---

## Company Posts (~280ms - 3s)

**Note:** Stricter engagement filters take longer (fewer matches = more scanning).

### Viral Posts by Engagement

```typescript
// ~280ms: >1000 likes (many matches)
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         post.likes_count AS post_likes_count,
         post.comments_count AS post_comments_count,
         substring(post.content_html, 1, 200) AS post_content_preview
  FROM linkedin_company lc
  JOIN linkedin_company_post post ON post.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
    AND post.likes_count > 1000
  LIMIT 20
`
});

// ~3s: >5000 likes (stricter filter = slower)
// ... same query with post.likes_count > 5000
```

### ❌ Content ILIKE - TIMEOUT

```sql
-- ❌ TIMEOUT: Content search
WHERE post.content_html ILIKE '%AI%'

-- ✅ USE: Filter by engagement instead
WHERE post.likes_count > 1000
```

---

## Company Addresses (~600ms - 2.8s)

**Note:** Stricter HAVING filters require more scanning.

### Companies with Multiple Offices

```typescript
// ~635ms: >3 offices (common)
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website
  FROM linkedin_company lc
  JOIN linkedin_company_address2 addr ON addr.linkedin_company_id = lc.id
  WHERE lc.country_code = 'US'
  GROUP BY lc.id, lc.company_name, lc.website
  HAVING COUNT(addr.id) > 3
  LIMIT 20
`
});

// ~2.8s: >5 offices (stricter = slower)
// ... same query with HAVING COUNT(addr.id) > 5
```

---

## Industry Reference Data (~15-27ms)

### Top Industries by Company Count

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT id AS ind_id,
         name AS ind_name,
         "group" AS ind_group,
         company_count AS ind_company_count
  FROM linkedin_industry
  ORDER BY company_count DESC
  LIMIT 20
`
});
```

---

## Find Employees at Company

For people queries, see `person/linkedin/sql/lookups.md`. Quick example:

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         pos.title AS pos_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date IS NULL
  LIMIT 100
`
});
```
