# Person Skills & Certifications

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Query people by skills and certifications.

**⚠️ Skills Query Warning:** Skills queries only work reliably for **common skills** (Python, JavaScript, SQL, Machine Learning). Less common skills like React, Kubernetes, TypeScript will **timeout**. See "Skills Limitations" section below.

---

## ⚠️ For Prospecting: Decompose Skill + Company Queries

**Skills array queries are slow** (requires `ANY()` scan). Combining with company filters makes it worse.

**For PROSPECTING (building broad lists), decompose:**

1. **Get people by company**: Query employees at target companies via `linkedin_company_id` (indexed)
2. **Enrichment column**: Add "Has [Skill]" column - check skills on small result set
3. **Alternative**: Search headline for skill mention instead (often faster)
4. **User filtering**: Let users filter the spreadsheet

**Example - "Python developers at tech companies":**

```
❌ SLOW: 'Python' = ANY(skills) AND employee_count > 1000 → 500ms-7s depending on table choice

✅ BETTER for prospecting:
1. Get employees at tech companies by industry_code (indexed) → 500 people
2. Add "Has Python Skill" enrichment column
3. OR Add "Headline Mentions Python" column (headline ILIKE '%python%' on small set)
4. User filters
```

---

## Skills: Normalized vs Denormalized

Array filters (skills) have specific performance characteristics.

### Single Skill: Slight Denormalized Advantage

| Query                | Normalized | Denormalized | Winner              |
| -------------------- | ---------- | ------------ | ------------------- |
| Single skill         | 209ms      | **152ms**    | Denormalized (1.4x) |
| Multi-skill          | 2,968ms    | **1,037ms**  | Denormalized (2.9x) |
| Skill + company size | 7,168ms    | **536ms**    | Denormalized (13x)  |

### Skill + Company Constraint: Use Denormalized

When combining skills with company filters, denormalized is dramatically faster.

```typescript
// ✅ BEST: 536ms (vs 7,168ms normalized - 13x faster)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkdc.name AS lc_name
  FROM lkd_profile lkd
  JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
  WHERE 'Python' = ANY(lkd.skills)
    AND lkdc.employee_count BETWEEN 100 AND 5000
  LIMIT 50
`
});
```

### Multi-Skill + Company: Denormalized Only

```typescript
// ✅ ONLY OPTION: 1,281ms (normalized: 28,173ms or TIMEOUT)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkdc.name AS lc_name
  FROM lkd_profile lkd
  JOIN lkd_company lkdc ON lkdc.linkedin_company_id = lkd.linkedin_company_id
  WHERE 'Python' = ANY(lkd.skills)
    AND 'SQL' = ANY(lkd.skills)
    AND lkdc.employee_count > 1000
  LIMIT 50
`
});
```

---

## Skills Limitations

**⚠️ CRITICAL: Skills queries are highly dependent on skill popularity.**

| Skill | Duration | Status |
|-------|----------|--------|
| Python | ~230ms | ✅ Works |
| JavaScript | ~200ms | ✅ Works |
| SQL | ~70ms | ✅ Works |
| Data Analysis | ~70ms | ✅ Works |
| Machine Learning | ~1.3s | ✅ Works |
| React | ~30s+ | ❌ TIMEOUT |
| Kubernetes | ~30s+ | ❌ TIMEOUT |
| TypeScript | ~30s+ | ❌ TIMEOUT |

**Why?** Skills stored as arrays require `ANY()` scan. Less common skills require scanning millions of rows before finding matches.

**Workaround for uncommon skills:** Use headline search instead:
```sql
WHERE lp.headline ILIKE '%kubernetes%'  -- Faster than skill array scan
```

---

## Skills Search - Common Skills Only (~200ms - 1.8s)

**Only use for common skills:** Python, JavaScript, SQL, Data Analysis, Machine Learning, etc.

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.title AS lp_title,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  WHERE lp.location_country_code = 'US'
    AND 'Python' = ANY(lp.skills) AND 'Machine Learning' = ANY(lp.skills)
  LIMIT 20
`
});
```

### Multiple Skills (AND) - Common Skills Only

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.org AS lp_company,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  WHERE lp.location_country_code = 'US'
    AND 'Python' = ANY(lp.skills)
    AND 'SQL' = ANY(lp.skills)
    AND 'Data Analysis' = ANY(lp.skills)
  LIMIT 20
`
});
```

---

## AWS Certified (~47ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         cert.title AS cert_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND (cert.title ILIKE '%AWS%' OR cert.company_name ILIKE '%Amazon Web Services%')
  LIMIT 20
`
});
```

---

## GCP Certified (~92ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         cert.title AS cert_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND (cert.title ILIKE '%Google Cloud%'
     OR cert.title ILIKE '%GCP%'
     OR cert.company_name ILIKE '%Google%')
  LIMIT 20
`
});
```

---

## Azure Certified

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         cert.title AS cert_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND (cert.title ILIKE '%Azure%'
     OR cert.title ILIKE '%Microsoft Certified%')
  LIMIT 20
`
});
```

---

## Security Certifications

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.public_profile_url AS lp_linkedin_url,
         cert.title AS cert_title
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND cert.title ~* '(CISSP|CISM|CEH|Security\\+|CompTIA Security)'
  LIMIT 20
`
});
```

---

## Certification Table Columns

| Column            | Example                   | Notes                 |
| ----------------- | ------------------------- | --------------------- |
| `title`           | "AWS Solutions Architect" | Main search field     |
| `company_name`    | "Amazon Web Services"     | Issuing org           |
| `issue_date`      | 2023-01-15                | When issued           |
| `expiration_date` | 2026-01-15                | NULL if no expiration |

---

## Combining Skills + Certifications

Find AWS-certified Python developers. **Note:** This combination is slow—use two-step approach for best results.

### ❌ Single Query - TIMEOUT

```typescript
// ❌ TIMEOUT: Skills array + certification join is too expensive
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT DISTINCT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND 'Python' = ANY(lp.skills)
    AND (cert.title ILIKE '%AWS%' OR cert.company_name ILIKE '%Amazon Web Services%')
  LIMIT 20
`
});
```

### ✅ Two-Step Workaround

```typescript
// Step 1: Get AWS-certified people in US
const { rows: awsCertified } = await services.person.linkedin.search({
   sql: `
  SELECT lp.id AS lp_id,
         lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.skills AS lp_skills
  FROM linkedin_profile lp
  JOIN linkedin_profile_certification cert ON cert.linkedin_profile_id = lp.id
  WHERE lp.location_country_code = 'US'
    AND (cert.title ILIKE '%AWS%' OR cert.company_name ILIKE '%Amazon Web Services%')
  LIMIT 200
`
});

// Step 2: Filter by skill in code
const awsPythonDevs = awsCertified.filter((r) => r.lp_skills?.includes("Python"));
```
