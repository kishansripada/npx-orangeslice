# Company Employee Growth

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Query employee growth metrics. Performance: ✅ 25-126ms.

**Note:** Uses the `company` table (not `linkedin_company`).

---

## ⚠️ For Prospecting: Decompose Growth + People Queries

**Company growth queries are fast** (indexed on `company` table). But **combining growth + profile filters** can be slow.

**For PROSPECTING (building lists of people at growing companies), decompose:**

1. **Get growing companies**: Query `company` table with growth filter → company list
2. **Get employees**: Query employees at those companies via `linkedin_company_id` (indexed)
3. **Enrichment columns**: Add "Company Growth Rate", "Title" columns
4. **User filtering**: Let users filter the spreadsheet

**When to use direct JOINs (patterns below):**
- Small, specific lookups (LIMIT 50 or less)
- When denormalized tables are used (as shown below)

---

## Cross-Table: Growth + Profile Data

When combining growth data with profile filters, the table choice matters.

### Growth Data Only: Use Normalized

Company growth queries without profile filters work well with normalized tables.

```typescript
// ✅ Fast: Company-only query
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name, c.employee_growth_12mo AS c_growth
  FROM company c
  WHERE c.employee_growth_12mo > 1.5  -- 150% of previous = 50% growth
  LIMIT 20
`
});
```

### Growth + Profile Headline: Use Denormalized

When adding profile text filters, use denormalized for the profile join.

```typescript
// ✅ Best: Denormalized for profile+company constraint
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lkd.first_name AS lp_first_name, lkd.headline AS lp_headline,
         c.name AS c_name, c.employee_growth_12mo AS c_growth
  FROM lkd_profile lkd
  JOIN company c ON c.linkedin_id = lkd.linkedin_company_id
  WHERE lkd.headline ILIKE '%engineer%'
    AND c.employee_growth_12mo > 1.3  -- 130% of previous = 30% growth
  LIMIT 50
`
});
```

---

## Fast-Growing Companies (~43ms)

Companies with 50%+ headcount growth in the last 12 months:

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.slug AS c_slug,
         c.employee_count AS c_employee_count,
         c.employee_growth_12mo AS c_employee_growth_12mo,
         c.locality AS c_locality
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_growth_12mo > 1.5  -- 150% of previous = 50% growth
    AND c.employee_count > 50
  LIMIT 20
`
});
```

---

## Hypergrowth Companies (~41ms)

Companies with >20% headcount growth in the last 3 months:

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.slug AS c_slug,
         c.employee_count AS c_employee_count,
         c.employee_growth_03mo AS c_employee_growth_03mo,
         c.employee_growth_06mo AS c_employee_growth_06mo
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_growth_03mo > 1.2  -- 120% of previous = 20% growth
    AND c.employee_count BETWEEN 50 AND 1000
  LIMIT 20
`
});
```

---

## Growth with LinkedIn Data (~16ms)

Join `company` with `linkedin_company` for full details:

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.employee_growth_12mo AS c_employee_growth_12mo,
         lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url
  FROM company c
  JOIN linkedin_company lc ON lc.id = c.linkedin_id
  WHERE c.country_name = 'United States'
    AND c.employee_growth_12mo > 1.3  -- 130% of previous = 30% growth
    AND c.employee_count > 50
  LIMIT 20
`
});
```

---

## Shrinking Companies (~45ms - 3.4s)

**Note:** Stricter filters (e.g., >30% decline) require scanning more rows and take longer.

```typescript
// ~45ms: Moderate decline (>10%)
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.slug AS c_slug,
         c.employee_count AS c_employee_count,
         c.employee_growth_12mo AS c_employee_growth_12mo
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_growth_12mo < 0.9  -- Lost >10% headcount
    AND c.employee_growth_12mo > 0    -- Exclude nulls/errors
    AND c.employee_count > 100
  LIMIT 20
`
});

// ~3.4s: Severe decline (>30%) - stricter = slower
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.slug AS c_slug,
         c.employee_count AS c_employee_count,
         c.employee_growth_12mo AS c_employee_growth_12mo
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_growth_12mo < 0.7  -- Lost >30% headcount
    AND c.employee_growth_12mo > 0
    AND c.employee_count > 100
  LIMIT 20
`
});
```

**Growth value interpretation:**

- `0.9` = 90% of previous headcount (10% decline)
- `0.7` = 70% of previous headcount (30% decline)
- `0.5` = 50% of previous headcount (50% decline)
- `1.0` = same headcount
- `1.2` = 120% of previous headcount (20% growth)

---

## Growth by Size Tier

### Startups (10-50 employees)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.employee_count AS c_employee_count,
         c.employee_growth_06mo AS c_employee_growth_06mo
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_count BETWEEN 10 AND 50
    AND c.employee_growth_06mo > 1.3  -- 130% of previous = 30% growth
  LIMIT 20
`
});
```

### Scale-ups (50-500 employees)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT c.name AS c_name,
         c.employee_count AS c_employee_count,
         c.employee_growth_12mo AS c_employee_growth_12mo
  FROM company c
  WHERE c.country_name = 'United States'
    AND c.employee_count BETWEEN 50 AND 500
    AND c.employee_growth_12mo > 1.5  -- 150% of previous = 50% growth
  LIMIT 20
`
});
```

---

## Company Table Columns

| Column                 | Type    | Notes                  |
| ---------------------- | ------- | ---------------------- |
| `name`                 | text    | Company name           |
| `slug`                 | text    | URL slug               |
| `linkedin_id`          | int     | FK to linkedin_company |
| `employee_count`       | int     | Current headcount      |
| `employee_growth_03mo` | decimal | 3-month growth rate    |
| `employee_growth_06mo` | decimal | 6-month growth rate    |
| `employee_growth_12mo` | decimal | 12-month growth rate   |
| `locality`             | text    | City                   |

**Growth rate interpretation (ratio of current to previous headcount):**

- `1.5` = 150% of previous headcount (50% growth)
- `1.2` = 120% of previous headcount (20% growth)
- `1.0` = same headcount (no change)
- `0.9` = 90% of previous headcount (10% decline)
- `0.7` = 70% of previous headcount (30% decline)

---

## ❌ Avoid: Rank Columns

These columns are NOT indexed and will timeout:

```sql
-- ❌ TIMEOUT
WHERE c.rank_fortune IS NOT NULL
WHERE c.rank_incmagazine IS NOT NULL
```
