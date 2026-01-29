# Person Lookups

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Fast indexed lookups for finding specific people. All queries here are ⚡ <100ms.

---

## 🎯 PREFERRED: Use Service for Employees at Single Company

**For finding employees at a specific company, use `services.company.getEmployeesFromLinkedin`** — it handles deduplication, pagination, and edge cases automatically.

```ts
// Step 1: Resolve company (if only have name/domain)
const company = await services.company.linkedin.enrich({ 
   linkedinUrl: "https://linkedin.com/company/stripe" 
});
// Confirm with user this is the correct company

// Step 2: Get employees
const employees = await services.company.getEmployeesFromLinkedin({
   linkedinUrl: "https://linkedin.com/company/stripe",
   titlePattern: "engineer",
   limit: 100
});
```

**When to use raw SQL instead:**
- Cross-company queries (employees at multiple companies)
- Complex joins with funding or other tables
- Custom filtering not supported by the service

---

## Why Normalized Wins for Lookups

For indexed lookups (ID, slug, updated_at), normalized tables are 3-8x faster.

| Lookup Type       | Normalized | Denormalized | Winner            |
| ----------------- | ---------- | ------------ | ----------------- |
| ID lookup         | **4-6ms**  | 12-31ms      | Normalized (3-8x) |
| Slug (key64)      | **21ms**   | ~60ms        | Normalized (~3x)  |
| updated_at filter | **4ms**    | 14ms         | Normalized (3.5x) |
| NULL check        | **5ms**    | 18ms         | Normalized (3.6x) |

**Why?** Normalized tables have smaller row sizes for indexed access. The index is on the normalized table, so PostgreSQL can use it directly.

**Rule:** Always use normalized tables (`linkedin_profile`, `linkedin_profile_slug`) for direct lookups.

---

## Find by LinkedIn Slug (~21ms)

**Why it's fast:** `slug_key64` is indexed. Using `key64()` hashes the slug to match the index.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.title AS lp_title,
         lp.org AS lp_company,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile_slug slug
  JOIN linkedin_profile lp ON lp.id = slug.linkedin_profile_id
  WHERE slug.slug_key64 = key64('satyanadella')
`
});
```

**⚠️ Never use direct slug comparison** - it's NOT indexed:

```sql
-- ❌ SLOW: Direct comparison not indexed
WHERE slug.slug = 'satyanadella'

-- ✅ FAST: Use key64() hash function
WHERE slug.slug_key64 = key64('satyanadella')
```

---

## Find People at Company by ID (~23ms)

**Why it's fast:** `linkedin_company_id` is indexed on the position table.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date IS NULL
  LIMIT 100
`
});
```

---

## Find People by Title at Company (~21-84ms)

**Why it works:** Company ID filter narrows to indexed rows first, then ILIKE scans small result set.

### Engineers at Stripe (~21ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         lp.location_name AS lp_location,
         pos.title AS pos_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371
    AND pos.end_date IS NULL
    AND pos.title ILIKE '%engineer%'
  LIMIT 100
`
});
```

### Sales/BD using regex (~84ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 11130470  -- OpenAI
    AND pos.end_date IS NULL
    AND pos.title ~* '(sales|business development|account executive)'
  LIMIT 20
`
});
```

### C-level executives

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 11130470
    AND pos.end_date IS NULL
    AND pos.title ~* '(\\mCEO\\M|\\mCTO\\M|\\mCFO\\M|Chief|Founder)'
  LIMIT 20
`
});
```

---

## Company Lookup Helper

Often you need the company ID first. See `company/linkedin/sql/lookups.md` for full patterns.

```typescript
// By slug using key64 (~4-7ms) - PREFERRED for LinkedIn URLs
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lcs.linkedin_company_id AS lc_id,
         lc.company_name AS lc_name,
         lc.website AS lc_website,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company_slug lcs
  JOIN linkedin_company lc ON lc.id = lcs.linkedin_company_id
  WHERE lcs.slug_key64 = key64('stripe')
  LIMIT 1
`
});
// Returns: lc_id = 2135371

// By domain (~638ms, may return multiple)
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.id AS lc_id,
         lc.company_name AS lc_name,
         lc.website AS lc_website,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.domain = 'openai.com'
  ORDER BY lc.employee_count DESC NULLS LAST
  LIMIT 1
`
});
// Pick highest employee_count (main company page)
```
