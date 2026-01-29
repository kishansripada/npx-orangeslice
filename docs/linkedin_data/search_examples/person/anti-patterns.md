# Person Query Anti-Patterns

> Common mistakes and WHY they cause timeouts.

---

## ILIKE AND (~24s) ❌

**Why it fails:** Each ILIKE requires a full sequential scan. AND doesn't combine them—PostgreSQL runs two independent scans and intersects results. 2 scans × 12s = 24s.

```sql
-- ❌ BAD: Double text scan
WHERE lp.headline ILIKE '%founder%' AND lp.headline ILIKE '%AI%'
```

### ✅ FIX: Single phrase (one scan)

```sql
WHERE lp.headline ILIKE '%AI%founder%'
```

### ✅ FIX: OR pattern (PostgreSQL optimizes to single scan)

```sql
WHERE lp.headline ILIKE '%founder%' OR lp.headline ILIKE '%AI%'
```

### ✅ FIX: Subquery pattern for targeted search

See `joins.md` for the subquery pattern with `ts_token()`.

---

## ORDER BY with Headline Search (~7s) 🟡

**Why it fails:** ORDER BY forces PostgreSQL to scan ALL matching rows before sorting, instead of stopping at LIMIT. 30x overhead.

```sql
-- 🟡 SLOWER (7s): With ORDER BY
SELECT ... FROM linkedin_profile lp
WHERE lp.headline ~* '(founder|CEO)'
ORDER BY lp.id
LIMIT 2000

-- ✅ FASTER (241ms): Skip ORDER BY
SELECT ... FROM linkedin_profile lp
WHERE lp.headline ~* '(founder|CEO)'
LIMIT 2000
```

**When ORDER BY is acceptable:** 7s is within timeout if you need consistent ordering or pagination.

**When to skip:** For top-of-funnel queries where speed matters more than order.

---

## ts_token on Headline (~2.5s) 🟡

**Why it's slower:** `ts_token()` has overhead on profile table. Regex is faster.

```sql
-- 🟡 SLOWER: ts_token
WHERE ts_token(lp.headline) @@ to_tsquery('simple', 'CEO')

-- ✅ FASTER: Use regex with word boundaries
WHERE lp.headline ~* '\\mCEO\\M'
```

---

## Rare Patterns + Location Filter ❌

**Why it fails:** Database scans rows sequentially until LIMIT is satisfied. Rare patterns (`%iOS developer%`) require scanning millions of rows. Adding location filter doesn't help because person location is not indexed.

```sql
-- ❌ TIMEOUT: Rare pattern + location
WHERE lp.headline ILIKE '%iOS developer%'
  AND lp.location_country_code = 'US'
```

### ✅ FIX: Two-step approach

```typescript
// Step 1: Query with broader pattern (no location)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.location_name AS lp_location
  FROM linkedin_profile lp
  WHERE lp.headline ILIKE '%mobile%'  -- Broader
  LIMIT 200
`
});

// Step 2: Filter in code
const usIOSDevelopers = rows.filter(
   (r) => r.lp_location?.toLowerCase().includes("united states") && r.lp_headline.toLowerCase().includes("ios")
);
```

---

## Education + Large Company ❌

**Why it fails:** Education join + company position join creates massive intermediate result set.

```sql
-- ❌ TIMEOUT: Stanford alumni at Google
WHERE pos.linkedin_company_id = 1441
  AND edu.school_name ILIKE '%stanford%'
```

### ✅ FIX: Filter by one dimension only

```sql
-- ✅ WORKS: School only, check company in code
WHERE edu.school_name ILIKE '%stanford%' LIMIT 100
```

---

## Complex Alumni Queries ❌

**Why it fails:** Joining multiple positions per person (past + current) creates exponential row explosion.

```sql
-- ❌ TIMEOUT: Ex-Google now at startups
FROM linkedin_profile lp
JOIN linkedin_profile_position3 prev ON prev.linkedin_profile_id = lp.id
JOIN linkedin_profile_position3 curr ON curr.linkedin_profile_id = lp.id
JOIN linkedin_company curr_co ON curr_co.id = curr.linkedin_company_id
WHERE prev.linkedin_company_id = 1441 AND prev.end_date IS NOT NULL
  AND curr.end_date IS NULL AND curr_co.employee_count < 500
```

### ✅ FIX: Break into multiple queries

See `alumni.md` for the two-step workaround.

---

## 4-Table Joins with ORDER BY ❌

**Why it fails:** Sorting after 4 joins requires materializing all matching rows.

```sql
-- ❌ TIMEOUT
SELECT ... FROM (4 tables)
ORDER BY f.round_date DESC
```

### ✅ FIX: Sort in code

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT ..., f.round_date AS f_round_date
  FROM (4 tables)
  LIMIT 20
`
});
// Sort in code
rows.sort((a, b) => new Date(b.f_round_date) - new Date(a.f_round_date));
```

---

## Missing industry_code Filter ❌

**Why it fails:** Without industry filter, PostgreSQL scans entire company table.

```sql
-- ❌ TIMEOUT: No industry filter
WHERE pos.title ~* '(VP|Vice President)' AND f.round_name = 'Series B'

-- ✅ WORKS: Add industry filter
WHERE pos.title ~* '(VP|Vice President)'
  AND lc.industry_code IN (4, 6, 96)
  AND f.round_name = 'Series B'
```

---

## Subquery with Rare Keywords ❌

**Why it fails:** Rare keywords like "fintech" don't have enough matches in company_name index.

```sql
-- ❌ TIMEOUT: Rare keyword
WHERE ts_token(company_name) @@ to_tsquery('simple', 'fintech')

-- ✅ WORKS: Broader keyword
WHERE ts_token(company_name) @@ to_tsquery('simple', 'finance')
```

---

## Non-Indexed Boolean Filters ❌

**Why it fails:** These columns are not indexed, causing full table scan.

```sql
-- ❌ TIMEOUT: influencer not indexed
WHERE influencer = true

-- ✅ WORKAROUND: Use follower count
WHERE num_followers > 50000  -- ~4s but works
```

---

## Normalized vs Denormalized Anti-Patterns

### ❌ Using Normalized for Headline + Company Size

**Why it fails:** Profile text filter + company constraint requires joining huge profile table with company table through position table. 93x slower than denormalized.

```sql
-- ❌ 20,205ms: Normalized multi-JOIN with headline filter
SELECT lp.id, lp.headline, lc.company_name
FROM linkedin_profile lp
JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
WHERE pos.end_date IS NULL
  AND lp.headline ILIKE '%engineer%'
  AND lc.employee_count > 1000

-- ✅ 217ms: Denormalized JOIN (93x faster)
SELECT lkd.profile_id, lkd.headline, lkdc.name
FROM lkd_profile lkd
JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
WHERE lkd.headline ILIKE '%engineer%'
  AND lkdc.employee_count > 1000
```

### ❌ Using Denormalized for Company Name Search

**Why it fails:** The `org` column on `linkedin_profile` has a GIN index. `lkd_profile.company_name` does not.

```sql
-- ❌ 8,600ms: Denormalized company_name search
WHERE lkd.company_name ILIKE '%Google%'

-- ✅ 274ms: Normalized org field (31x faster)
WHERE lp.org ILIKE '%Google%'
```

### ❌ Using Denormalized for ID Lookups

**Why it fails:** Indexes exist on normalized tables, not denormalized views.

```sql
-- ❌ 31ms: Denormalized ID lookup
SELECT * FROM lkd_company WHERE linkedin_company_id = 2135371

-- ✅ 4ms: Normalized ID lookup (7.8x faster)
SELECT * FROM linkedin_company WHERE id = 2135371
```

---

---

## Alphabetical/Sorted Ordering with Multiple Companies ⚠️

**Why it happens:** B-tree indexes store values in sorted order. Using `WHERE lc.id IN (...)` or `WHERE pos.linkedin_company_id IN (...)` returns results in sorted order, not the order specified in the IN clause.

```sql
-- ⚠️ Results come back in sorted order by company ID
-- With LIMIT 100, you may ONLY get employees from the company with smallest ID!
SELECT lp.first_name, lc.company_name
FROM linkedin_profile lp
JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
WHERE pos.linkedin_company_id IN (2135371, 30628689, 11130470)  -- Stripe, Anthropic, OpenAI
  AND pos.end_date IS NULL
LIMIT 100
```

**Fix:** Use UNION ALL with per-company limits for balanced results:

```sql
(SELECT ... WHERE pos.linkedin_company_id = 2135371 LIMIT 30)  -- Stripe
UNION ALL
(SELECT ... WHERE pos.linkedin_company_id = 30628689 LIMIT 30)  -- Anthropic
UNION ALL
(SELECT ... WHERE pos.linkedin_company_id = 11130470 LIMIT 30)  -- OpenAI
```

**Note:** Get company IDs using key64 lookups first:
```sql
SELECT lcs.linkedin_company_id FROM linkedin_company_slug lcs WHERE lcs.slug_key64 = key64('stripe')
```

See `QUICK_REF.md` → "IN vs EXISTS" section for detailed patterns.

---

---

## Uncommon Skills Array Filter ❌

**Why it fails:** Skills array requires `ANY()` scan. For uncommon skills, PostgreSQL must scan millions of rows to find matches.

```sql
-- ❌ TIMEOUT: Uncommon skills
WHERE 'React' = ANY(lp.skills)
WHERE 'Kubernetes' = ANY(lp.skills)
WHERE 'TypeScript' = ANY(lp.skills)

-- ✅ WORKS: Common skills only
WHERE 'Python' = ANY(lp.skills)      -- ~230ms
WHERE 'JavaScript' = ANY(lp.skills)  -- ~200ms
WHERE 'SQL' = ANY(lp.skills)         -- ~70ms
WHERE 'Machine Learning' = ANY(lp.skills)  -- ~1.3s
```

### ✅ FIX: Use headline search for uncommon skills

```sql
-- Instead of skill array, search headline
WHERE lp.headline ILIKE '%kubernetes%'
WHERE lp.headline ILIKE '%react%'
```

---

## Summary Table

| Anti-Pattern            | Duration | Fix                 |
| ----------------------- | -------- | ------------------- |
| ILIKE AND               | ~24s     | Single phrase or OR |
| ORDER BY + text         | ~7s      | Skip ORDER BY       |
| ts_token on headline    | ~2.5s    | Use regex           |
| Rare pattern + location | TIMEOUT  | Two-step approach   |
| Education + company     | TIMEOUT  | Single dimension    |
| Complex alumni          | TIMEOUT  | Multiple queries    |
| 4-table + ORDER BY      | TIMEOUT  | Sort in code        |
| Missing industry_code   | TIMEOUT  | Add filter          |
| Rare subquery keywords  | TIMEOUT  | Broader keywords    |
| influencer = true       | TIMEOUT  | Use num_followers   |
| Normalized headline+co  | ~20s     | Use denormalized    |
| Denorm company name     | ~8.6s    | Use org GIN index   |
| Denorm ID lookup        | ~31ms    | Use normalized      |
| ID IN (multiple)        | Sorted     | UNION ALL with IDs |
| **Uncommon skills**     | TIMEOUT  | Use headline ILIKE  |
