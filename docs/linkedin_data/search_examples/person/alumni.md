# Person Alumni Queries

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Find former employees of companies. Simple alumni queries are ✅ ~104ms. Complex alumni queries TIMEOUT.

---

## Company-First Queries: Use Normalized

Alumni queries start with a company ID—this is a company-first lookup pattern where normalized tables excel.

| Pattern                | Normalized | Denormalized | Winner            |
| ---------------------- | ---------- | ------------ | ----------------- |
| Company ID → employees | **48ms**   | 279ms        | Normalized (5.8x) |
| Company ID → alumni    | **104ms**  | ~500ms       | Normalized (~5x)  |

**Why?** The `linkedin_company_id` index on `linkedin_profile_position3` allows PostgreSQL to quickly find all positions at that company.

**Rule:** For alumni queries (finding former employees at a specific company), always use normalized tables.

---

## Simple Alumni: One Company (~104ms) ✅

**Why it works:** Single company ID filter is indexed.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         pos.end_date AS pos_end_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date IS NOT NULL
    AND pos.title ILIKE '%Engineer%'
  ORDER BY pos.end_date DESC
  LIMIT 20
`
});
```

---

## Former Executives at Company

**⚠️ Warning:** This query can timeout for very large companies like Google. Use mid-size companies or skip ORDER BY for better performance.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         pos.end_date AS pos_end_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date IS NOT NULL
    AND pos.title ~* '(VP|Vice President|Director|Chief|\\mCEO\\M|\\mCTO\\M)'
  ORDER BY pos.end_date DESC
  LIMIT 20
`
});
```

---

## Recent Departures

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         pos.end_date AS pos_end_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 11130470  -- OpenAI
    AND pos.end_date IS NOT NULL
    AND pos.end_date >= '2024-01-01'
  ORDER BY pos.end_date DESC
  LIMIT 50
`
});
```

---

## ❌ Complex Alumni Queries - TIMEOUT

### Ex-X Employees Now at Startups

**Why it fails:** Requires joining multiple positions per person (past + current), creating massive intermediate result set.

```typescript
// ❌ TIMEOUT: Ex-Google employees now at startups
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name, lp.last_name AS lp_last_name,
         curr_co.company_name AS current_company
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 prev ON prev.linkedin_profile_id = lp.id
  JOIN linkedin_profile_position3 curr ON curr.linkedin_profile_id = lp.id
  JOIN linkedin_company curr_co ON curr_co.id = curr.linkedin_company_id
  WHERE prev.linkedin_company_id = 1441  -- Google
    AND prev.end_date IS NOT NULL
    AND curr.end_date IS NULL
    AND curr_co.employee_count < 500
  LIMIT 100
`
});
```

### ✅ Workaround: Break into Two Queries

```typescript
// Step 1: Get former employees
const { rows: alumni } = await services.person.linkedin.search({ sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 1441  -- Google
    AND pos.end_date IS NOT NULL
  LIMIT 500
`);

// Step 2: For each person, check their current company in code
// OR run separate queries for their current positions
```

---

## Alumni by Time Period

### Left in Last 6 Months

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         pos.end_date AS pos_end_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date >= NOW() - INTERVAL '6 months'
  ORDER BY pos.end_date DESC
  LIMIT 50
`
});
```

### Long-Tenured Alumni (5+ years) (~256ms for mid-size companies)

**Note:** This query works well for mid-size companies but may timeout for very large companies like Google due to the high volume of position records.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         pos.title AS pos_title,
         pos.start_date AS pos_start_date,
         pos.end_date AS pos_end_date
  FROM linkedin_profile lp
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND pos.linkedin_company_id = 2135371  -- Stripe
    AND pos.end_date IS NOT NULL
    AND pos.start_date IS NOT NULL
    AND pos.end_date >= pos.start_date + INTERVAL '5 years'
  ORDER BY pos.end_date DESC
  LIMIT 20
`
});
```

---

## Position Table Columns

| Column                | Type | Notes                        |
| --------------------- | ---- | ---------------------------- |
| `linkedin_company_id` | int  | **Indexed** - filter by this |
| `title`               | text | Job title                    |
| `start_date`          | date | When started                 |
| `end_date`            | date | NULL if current job          |
