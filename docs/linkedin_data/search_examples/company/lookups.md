# Company Lookups

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Fast indexed lookups for finding specific companies.

---

## Why Normalized Wins for Lookups

For all indexed lookups, normalized tables are significantly faster.

| Lookup Type     | Normalized | Denormalized | Winner             |
| --------------- | ---------- | ------------ | ------------------ |
| Company ID      | **4ms**    | 31ms         | Normalized (7.8x)  |
| Slug (key64)    | **4-7ms**  | ~70ms        | Normalized (~10x)  |
| Domain          | **3-800ms**| N/A          | Normalized         |

**Why?** Indexes exist on normalized tables. PostgreSQL uses them directly without view materialization overhead.

**Rule:** Always use `linkedin_company` (via `linkedin_company_slug` for slug lookups) for direct company lookups.

---

## Company by Slug using key64() (~4-7ms) - PREFERRED for LinkedIn URLs

**Why it's fast:** `slug_key64` is indexed. Using `key64()` hashes the slug to match the index.

**When to use:** When you have a LinkedIn company URL like `https://www.linkedin.com/company/stripe`

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lcs.linkedin_company_id AS lc_id,
         lc.company_name AS lc_name,
         lcs.slug AS lc_linkedin_slug,
         lc.website AS lc_website,
         lc.domain AS lc_domain,
         lc.employee_count AS lc_employee_count,
         lc.locality AS lc_location
  FROM linkedin_company_slug lcs
  JOIN linkedin_company lc ON lc.id = lcs.linkedin_company_id
  WHERE lcs.slug_key64 = key64('stripe')
  LIMIT 1
`
});
// Returns: lc_linkedin_slug = 'stripe', lc_id = 2135371
```

**⚠️ Never use direct slug comparison:**

```sql
-- ❌ SLOW: Direct comparison not indexed
WHERE lcs.slug = 'openai'

-- ✅ FAST: Use key64() hash function
WHERE lcs.slug_key64 = key64('openai')
```

---

## Company by ID (~5ms) - Primary Key

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         lc.domain AS lc_domain,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.id = 2135371
`
});
```

---

## Company by Domain (~3-800ms) - Highly Variable!

**Why it varies:** Performance depends on how many companies share the domain.
- Unique domains (anthropic.com, openai.com): ~3-5ms ✅
- Popular domains (google.com): ~800ms 🟡 (many subsidiaries/related companies)

```typescript
// ⚠️ stripe.com returns 28 companies!
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.universal_name AS lc_linkedin_slug,
         lc.website AS lc_website,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.domain = 'stripe.com'
  ORDER BY lc.employee_count DESC NULLS LAST
  LIMIT 1
`
});
// Returns main company (highest employee_count) with lc_linkedin_slug = 'stripe'
```

**⚠️ Always use ORDER BY employee_count DESC** to get the main company page, not a subsidiary.

---

## ⚠️ Similar Company Slugs Exist

Some slugs may map to unexpected companies. For well-known companies, verify with domain:

```typescript
// For well-known companies, domain lookup is most reliable
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         lc.domain AS lc_domain,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.domain = 'anthropic.com'
  ORDER BY lc.employee_count DESC NULLS LAST
  LIMIT 1
`
});
```

**When you have a LinkedIn URL slug, use key64:**

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lcs.linkedin_company_id AS lc_id,
         lc.company_name AS lc_name,
         lc.domain AS lc_domain,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company_slug lcs
  JOIN linkedin_company lc ON lc.id = lcs.linkedin_company_id
  WHERE lcs.slug_key64 = key64('anthropic')
  LIMIT 1
`
});
```

---

## Company Location Filtering

Company location columns are **indexed** and work efficiently:

```sql
lc.country_name    -- e.g., 'United States'
lc.region          -- e.g., 'California'
lc.locality        -- e.g., 'San Francisco'
```

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.website AS lc_website,
         lc.locality AS lc_location
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.industry_code IN (4, 6, 96)
    AND lc.description ILIKE '%AI%'
  LIMIT 100
`
});
```

---

## Company with Industry Name

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lcs.slug AS lc_linkedin_slug,
         lc.website AS lc_website,
         lc.employee_count AS lc_employee_count,
         ind.name AS ind_name
  FROM linkedin_company_slug lcs
  JOIN linkedin_company lc ON lc.id = lcs.linkedin_company_id
  LEFT JOIN linkedin_industry ind ON ind.id = lc.industry_code
  WHERE lcs.slug_key64 = key64('openai')
  LIMIT 1
`
});
```

---

## Public Companies

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         lc.domain AS lc_domain,
         lc.employee_count AS lc_employee_count,
         lc.industry AS lc_industry,
         lc.ticker AS lc_ticker
  FROM linkedin_company lc
  WHERE lc.ticker IS NOT NULL AND lc.ticker != ''
  LIMIT 20
`
});
```

---

## Lookup Priority

When looking up companies, use this order:

1. **key64(slug)** via `linkedin_company_slug` (for LinkedIn URL-based lookups - MOST COMMON)
2. **domain** (most reliable for well-known companies)
3. **id** (when you have it from prior queries)
