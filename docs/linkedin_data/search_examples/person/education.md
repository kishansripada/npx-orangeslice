# Person Education Queries

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Query people by their educational background. Performance: ✅ 41-165ms.

---

## ⚠️ Education + Company Queries TIMEOUT - Use Decomposition

**Education queries alone are fast** (indexed by `linkedin_profile_id`). But **combining education + company filters WILL timeout** - neither normalized nor denormalized works.

**For PROSPECTING (building lists), ALWAYS decompose:**

1. **Option A - Start with company:**
   - Get employees at target companies via `linkedin_company_id` (indexed)
   - Add "Education" enrichment column - query education by `linkedin_profile_id` (indexed)
   - User filters by school/degree

2. **Option B - Start with school:**
   - Get people from target school/degree → 500 people
   - Add "Current Company" enrichment column
   - Add "Company Size" enrichment column
   - User filters by company criteria

**Example - "Stanford alumni at Google":**

```
❌ TIMEOUT: edu.school_name ILIKE '%stanford%' AND pos.linkedin_company_id = 1441

✅ DECOMPOSE:
1. Get Stanford alumni (education query) → 500 people
2. Add "Current Company" enrichment column (query positions by profile_id)
3. User filters by company = Google
```

---

## Cross-Table Education Queries

Education queries have specific patterns for cross-table performance.

### Education-Only: Normalized

Simple education filters work well with normalized tables.

```typescript
// ✅ Fast (41-165ms): Normalized education query
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name, edu.school_name AS edu_school
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.field_of_study ILIKE '%computer science%'
  LIMIT 20
`
});
```

### Education + Company: TIMEOUT (Neither Works)

Combining education with company filters creates massive intermediate results. Neither normalized nor denormalized handles this well.

```sql
-- ❌ TIMEOUT: Both normalized and denormalized
WHERE edu.school_name ILIKE '%stanford%'
  AND pos.linkedin_company_id = 1441  -- Google
```

**Workaround:** Filter by one dimension only, then filter in code (see below).

---

## Recent MBA Graduates (~165ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         edu.school_name AS edu_school_name,
         edu.degree AS edu_degree
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.degree ILIKE '%MBA%' AND edu.end_date_year >= 2022
  LIMIT 20
`
});
```

---

## CS Degree Holders (~41ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         edu.school_name AS edu_school_name,
         edu.field_of_study AS edu_field_of_study
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.field_of_study ILIKE '%computer science%'
  LIMIT 20
`
});
```

---

## School-Specific Search

### Stanford Alumni

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         edu.school_name AS edu_school_name,
         edu.degree AS edu_degree,
         edu.field_of_study AS edu_field_of_study
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.school_name ILIKE '%stanford%'
  LIMIT 100
`
});
```

---

## Education Table Columns

| Column            | Example                      | Notes                    |
| ----------------- | ---------------------------- | ------------------------ |
| `school_name`     | "Stanford University"        | Use ILIKE                |
| `degree`          | "Bachelor of Science", "MBA" | Use ILIKE                |
| `field_of_study`  | "Computer Science"           | Use ILIKE                |
| `start_date_year` | 2018                         | Integer                  |
| `end_date_year`   | 2022                         | Integer, NULL if current |

---

## ❌ Education + Large Company = TIMEOUT

**Why it fails:** Education join + company position join creates massive intermediate result set.

```typescript
// ❌ TIMEOUT: Stanford alumni at Google
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name, lp.last_name AS lp_last_name
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  JOIN linkedin_profile_position3 pos ON pos.linkedin_profile_id = lp.id
  WHERE pos.linkedin_company_id = 1441  -- Google
    AND edu.school_name ILIKE '%stanford%'
  LIMIT 100
`
});
```

### ✅ Workaround: Filter by School Only

```typescript
// Step 1: Get people from specific school
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.school_name ILIKE '%stanford%'
  LIMIT 100
`
});

// Step 2: Check company in code or separate query
```

---

## Combining Education Filters

### PhD in Tech Fields

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         edu.school_name AS edu_school_name,
         edu.field_of_study AS edu_field_of_study
  FROM linkedin_profile lp
  JOIN linkedin_profile_education2 edu ON edu.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND edu.degree ILIKE '%PhD%'
    AND edu.field_of_study ~* '(computer science|electrical engineering|machine learning|artificial intelligence)'
  LIMIT 20
`
});
```
