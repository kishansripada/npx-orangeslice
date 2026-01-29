# Company Query Anti-Patterns

> Common mistakes and WHY they cause timeouts.

---

## ILIKE Performance (~100ms - 10s)

**Key insight:** Performance depends on **term frequency**, not pattern type.

| Pattern Type | Common Terms (AI, cloud) | Uncommon Terms (fintech) |
|--------------|--------------------------|--------------------------|
| Single ILIKE | ~100-400ms ✅            | ~4-7s 🔴                 |
| OR pattern   | ~20-65ms ✅ **fastest**  | ~500ms 🟡                |
| AND pattern  | ~200-500ms 🟡            | ~2-3s 🔴                 |
| Phrase       | ~200-500ms 🟡            | ~1-3s 🔴                 |

### ✅ BEST: OR pattern (PostgreSQL optimizes)

```sql
-- ✅ FAST (~20-65ms): OR stops early when matches found
WHERE lc.description ILIKE '%AI%' OR lc.description ILIKE '%ML%'
```

### 🟡 OK: AND or Phrase (similar performance)

```sql
-- 🟡 AND pattern (~2s for uncommon terms)
WHERE lc.description ILIKE '%developer%' AND lc.description ILIKE '%API%'

-- 🟡 Phrase pattern (~3s) - can be slower due to consecutive matching
WHERE lc.description ILIKE '%developer%API%'
```

**Note:** Phrase patterns require terms to appear consecutively, which can actually require MORE scanning than AND patterns. Use whichever matches your semantic intent.

---

## ORDER BY with Text Search (~26s) 🔴

**Why it fails:** ORDER BY forces PostgreSQL to scan ALL matching rows before sorting, instead of stopping at LIMIT. For companies, this approaches the 30s timeout.

```sql
-- 🔴 SLOW (26s): With ORDER BY - near timeout
SELECT ... FROM linkedin_company lc
WHERE lc.description ILIKE '%saas%'
ORDER BY lc.id
LIMIT 2000

-- ✅ FAST (329ms): Skip ORDER BY
SELECT ... FROM linkedin_company lc
WHERE lc.description ILIKE '%saas%'
LIMIT 2000
```

**Comparison with people queries:** For `linkedin_profile`, ORDER BY adds ~7s (acceptable). For `linkedin_company`, it adds ~26s (near timeout).

---

## Missing industry_code Filter ❌

**Why it fails:** Without industry filter, PostgreSQL must scan billions of company rows.

```sql
-- ❌ TIMEOUT: No industry filter
WHERE lc.description ILIKE '%AI%'

-- ✅ WORKS (~128ms): With industry filter
WHERE lc.description ILIKE '%AI%'
  AND lc.industry_code IN (4, 6, 96)
```

Industry codes act as an index-first filter, narrowing to ~5% of data before text scan.

---

## Company Posts Content ILIKE ❌

**Why it fails:** Post content is large text, not indexed. Full table scan required.

```sql
-- ❌ TIMEOUT: Content search
WHERE post.content_html ILIKE '%AI%'

-- ✅ WORKS (~263ms): Filter by engagement instead
WHERE post.likes_count > 1000
```

---

## Remote Jobs with Date Filter ❌

**Why it fails:** Job location is not indexed. Adding date filter compounds the scan.

```sql
-- ❌ TIMEOUT
WHERE j.location ILIKE '%remote%'
  AND j.posted_date >= '2024-06-01'

-- ✅ WORKS: Filter by company_id first
WHERE j.linkedin_company_id = 2135371
  AND j.location ILIKE '%remote%'
```

---

## Sparse/Unreliable Fields ❌

**Why they fail:** These fields either aren't populated or aren't indexed.

| Field                | Why to Avoid                                             |
| -------------------- | -------------------------------------------------------- |
| `specialties` array  | <5% of companies have data. ~27s query, often 0 results. |
| `has_careers = true` | Field exists but was never populated. Always returns 0.  |
| `rank_fortune`       | Only Fortune 500 populated. Not indexed = timeout.       |
| `rank_incmagazine`   | Same issue as rank_fortune.                              |

```sql
-- ❌ These will timeout or return 0 results
WHERE 'Machine Learning' = ANY(lc.specialties)
WHERE lc.has_careers = true
WHERE c.rank_fortune IS NOT NULL
```

---

## Direct Slug Comparison ❌

**Why it fails:** `slug` column is not indexed. Only `slug_key64` is indexed.

```sql
-- ❌ SLOW: Direct comparison
WHERE slug.slug = 'openai'

-- ✅ FAST (~20ms): Use key64() hash function
WHERE slug.slug_key64 = key64('openai')
```

---

## Domain Lookup Without employee_count ❌

**Why it fails:** Multiple companies can share a domain. You might get the wrong one.

```sql
-- ❌ BAD: May return wrong company (28 companies share stripe.com!)
SELECT * FROM linkedin_company WHERE domain = 'stripe.com' LIMIT 1

-- ✅ CORRECT: Filter by employee_count to get main company
SELECT * FROM linkedin_company WHERE domain = 'stripe.com'
ORDER BY employee_count DESC NULLS LAST
LIMIT 1
```

---

## Looking Up Companies by Slug ⚠️

**Use key64 for LinkedIn URL slug lookups:** The `universal_name` column on `linkedin_company` is not reliably indexed and can return incorrect results. Instead, use the `linkedin_company_slug` table with `key64()`.

```sql
-- ❌ AVOID: universal_name lookup (not reliable)
WHERE lc.universal_name = 'anthropic'

-- ✅ CORRECT: Use key64 with linkedin_company_slug
SELECT lcs.linkedin_company_id AS id, lc.company_name, lc.domain
FROM linkedin_company_slug lcs
JOIN linkedin_company lc ON lc.id = lcs.linkedin_company_id
WHERE lcs.slug_key64 = key64('anthropic')
LIMIT 1;

-- ✅ ALSO CORRECT: Use domain for well-known companies
WHERE lc.domain = 'anthropic.com'
ORDER BY employee_count DESC NULLS LAST
LIMIT 1
```

---

## ORDER BY with DISTINCT Missing Column ❌

**Why it fails:** PostgreSQL requires ORDER BY columns in SELECT when using DISTINCT.

```sql
-- ❌ ERROR: ORDER BY expressions must appear in select list
SELECT DISTINCT lc.company_name AS lc_name
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
ORDER BY f.round_date DESC

-- ✅ CORRECT: Include ORDER BY column in SELECT
SELECT DISTINCT lc.company_name AS lc_name, f.round_date AS f_round_date
FROM linkedin_company lc
JOIN linkedin_crunchbase_funding f ON f.linkedin_company_id = lc.id
ORDER BY f.round_date DESC
```

---

---

## Cross-Table Anti-Patterns

### ❌ Denormalized for Company-First Queries

**Why it fails:** Company lookups use indexes on normalized tables. Denormalized views don't have these indexes.

| Pattern | Normalized | Denormalized | Winner |
|---------|------------|--------------|--------|
| Company ID lookup | **4ms** | 31ms | Normalized (7.8x) |
| Company name (org) | **274ms** | 8,600ms | Normalized (31x) |
| Company ID → employees | **48ms** | 279ms | Normalized (5.8x) |

```sql
-- ❌ SLOW: Denormalized company lookup
SELECT * FROM lkd_company WHERE linkedin_company_id = 2135371

-- ✅ FAST: Normalized
SELECT * FROM linkedin_company WHERE id = 2135371
```

### ❌ Normalized for Profile Text + Company Constraint

**Why it fails:** Text filters on the huge profile table + company JOINs create massive intermediate results. Denormalized pre-joins are 20-93x faster.

```sql
-- ❌ 20,205ms: Normalized multi-JOIN
SELECT lp.id, lp.headline, lc.company_name
FROM linkedin_profile lp
JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
JOIN linkedin_company lc ON lc.id = pos.linkedin_company_id
WHERE lp.headline ILIKE '%engineer%'
  AND lc.employee_count > 1000

-- ✅ 217ms: Denormalized (93x faster)
SELECT lkd.profile_id, lkd.headline, lkdc.name
FROM lkd_profile lkd
JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
WHERE lkd.headline ILIKE '%engineer%'
  AND lkdc.employee_count > 1000
```

### ✅ When to Use Each

```
Company-first (ID, name, domain) → Normalized (3-31x faster)
Profile text + company filter → Denormalized (20-93x faster)
Funding table JOINs → Normalized (indexed)
Skills + company constraint → Denormalized (13x faster)
```

---

---

## IN Subquery with Large Result Set ❌

**Why it fails:** `IN (SELECT ...)` builds the complete ID list before filtering. For large tables like funding (264K+ companies), this is slow and can timeout.

```sql
-- ❌ TIMEOUT: IN builds full list of 264K funded company IDs
SELECT lc.company_name, lc.description
FROM linkedin_company lc
WHERE lc.id IN (
  SELECT DISTINCT f.linkedin_company_id
  FROM linkedin_crunchbase_funding f
)
AND lc.description ILIKE '%AI%'

-- ✅ FAST (2-17x faster): EXISTS stops at first match
SELECT lc.company_name, lc.description
FROM linkedin_company lc
WHERE EXISTS (
  SELECT 1 FROM linkedin_crunchbase_funding f
  WHERE f.linkedin_company_id = lc.id
)
AND lc.description ILIKE '%AI%'
```

**When IN is fine:** Small, hardcoded value lists like `WHERE id IN (123, 456, 789)`.

---

## Alphabetical Ordering with Multiple Companies ⚠️

**Why it happens:** B-tree indexes store values in sorted order. Using `WHERE id IN (...)` or slug lookups returns results in sorted order, not the order specified in the IN clause.

```sql
-- ⚠️ Results come back in sorted order
-- With LIMIT 100, you may ONLY get employees from the company with smallest ID!
WHERE lc.id IN (company_id_1, company_id_2, company_id_3)
```

**Fix options:**
1. **UNION ALL** with per-company limits for balanced results:
```sql
(SELECT ... WHERE pos.linkedin_company_id = 2135371 LIMIT 30)  -- Stripe
UNION ALL
(SELECT ... WHERE pos.linkedin_company_id = 30628689 LIMIT 30)  -- Anthropic
UNION ALL
(SELECT ... WHERE pos.linkedin_company_id = 11130470 LIMIT 30)  -- OpenAI
```
2. **Use explicit company IDs** from key64 lookups
3. **Accept the ordering** if it's fine for your use case

See `QUICK_REF.md` → "IN vs EXISTS" section for detailed patterns.

---

## Regex on Description Field ❌

**Why it fails:** Regex (`~*`) requires full table scan and complex pattern matching. Always times out on large text fields.

```sql
-- ❌ TIMEOUT: Regex pattern on description
WHERE lc.description ~* 'SaaS.*(usage|consumption|metered)'

-- ✅ WORKS: Use OR with ILIKE instead
WHERE lc.description ILIKE '%SaaS%'
  AND (lc.description ILIKE '%usage%' 
    OR lc.description ILIKE '%consumption%' 
    OR lc.description ILIKE '%metered%')
```

---

## Summary Table

| Anti-Pattern              | Duration      | Fix                            |
| ------------------------- | ------------- | ------------------------------ |
| Uncommon ILIKE terms      | ~4-7s 🔴      | Use common terms or OR         |
| ILIKE LIMIT 1000+         | ~10s 🔴       | Reduce limit or use indexed    |
| ORDER BY + text           | ~26s          | Skip ORDER BY                  |
| Missing industry_code     | TIMEOUT       | Add filter                     |
| Regex `~*`                | TIMEOUT       | Use ILIKE OR instead           |
| Post content ILIKE        | TIMEOUT       | Use engagement filter          |
| Remote jobs + date        | TIMEOUT       | Filter by company_id first     |
| specialties array         | ~27s / 0      | Don't use                      |
| has_careers = true        | ~28s / 0      | Don't use                      |
| rank_fortune              | TIMEOUT       | Don't use                      |
| Direct slug               | SLOW          | Use key64()                    |
| Domain without sort       | Wrong data    | ORDER BY employee_count        |
| universal_name lookup     | Unreliable    | Use key64 via linkedin_company_slug |
| Denorm company lookup     | ~31ms         | Use normalized (7.8x)          |
| Norm profile+company      | ~20s          | Use denormalized (93x)         |
| IN large subquery         | TIMEOUT       | Use EXISTS (2-17x faster)      |
| ID IN (multiple)          | Sorted order  | UNION ALL or use IDs           |
| Stricter filters          | Slower        | Stricter = more scanning       |
