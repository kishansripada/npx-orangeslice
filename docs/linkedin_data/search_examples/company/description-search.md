# Company Description Search

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Search for companies by their description. Performance varies significantly based on **term frequency**:

- **Common terms** (AI, cloud, API): ~100-400ms ✅
- **Medium terms** (SaaS, cybersecurity): ~400ms-1.5s 🟡
- **Uncommon terms** (fintech, personalization): ~4-10s 🔴
- **OR patterns** are fastest: ~20-65ms ✅

---

## ⚠️ Description is NOT Indexed - Use Decomposition for Prospecting

**`description ILIKE` is NOT indexed.** These patterns only work because `industry_code` narrows to ~5% of data first.

**For PROSPECTING (building broad lists), decompose instead:**

1. **Top-of-funnel**: Get companies by `industry_code` (indexed) → 500+ companies
2. **Enrichment column**: Add "Description Matches [X]" column using AI classification
3. **User filtering**: Let users filter the spreadsheet

**Example - "AI video companies":**

```
❌ RISKY: description ILIKE '%AI%video%' → Works for small results, but timing varies (3-15s)

✅ BETTER for prospecting:
1. Get tech companies by industry_code IN (4,6,96) → 500 companies
2. Add "Mentions AI" enrichment column (AI classification on description)
3. Add "Mentions Video" enrichment column (AI classification on description)
4. User filters by both columns
```

**When to use these patterns directly:**
- Small, specific searches (not building large prospect lists)
- When you MUST have `industry_code` filter
- When timing variability (100ms - 10s+) is acceptable

---

## Why Company Text Search Uses Normalized

Text filters on the **company side** strongly favor normalized tables.

| Query                      | Normalized | Denormalized   | Speedup |
| -------------------------- | ---------- | -------------- | ------- |
| Company description ILIKE  | **125ms**  | 4,166-15,435ms | 33-123x |
| Company + profile headline | **702ms**  | 3,440ms        | 4.9x    |

**Why?** The company table is 100-1000x smaller than the profile table (~millions vs ~1.15 billion rows). Text scans complete much faster on the smaller table.

### The Cross-Table Rule

```
Text filter on company side only?
  └─ YES → Use normalized (33-123x faster)

Text filter on profile side only?
  └─ YES → Use denormalized (profile table is huge)

Text filter on both sides?
  └─ Normalized wins IF company filter is selective
```

---

## ⚠️ CRITICAL: Always Include industry_code

**Why:** Without `industry_code`, PostgreSQL scans billions of rows. Industry index narrows to ~5% first.

```sql
-- ❌ TIMEOUT: No industry filter
WHERE lc.description ILIKE '%AI%'

-- ✅ WORKS (~128ms): With industry filter
WHERE lc.description ILIKE '%AI%'
  AND lc.industry_code IN (4, 6, 96)
```

---

## Common Tech Industry Codes

| Code | Name                              |
| ---- | --------------------------------- |
| 4    | Computer Software                 |
| 6    | Information Technology & Services |
| 96   | IT Services and IT Consulting     |

---

## AI Video Companies (~3s)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.universal_name AS lc_linkedin_slug,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.description AS lc_description,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%AI%video%'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});
```

---

## Personalization Infrastructure (~10-15s)

**Note:** Longer words like "personalization" require more scanning. Consider shorter alternatives.

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.description AS lc_description,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%personalization%'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});
```

---

## AI Platforms for Sales/RevOps (~128ms)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.description AS lc_description,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%AI%'
    AND (lc.description ILIKE '%sales%' OR lc.description ILIKE '%RevOps%')
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});
```

---

## Developer API Companies (~2-3s)

**Note:** Both phrase and AND patterns are slow for uncommon term combinations. Use OR when possible.

```typescript
// Option 1: Phrase pattern (~3s) - requires terms to be consecutive
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.description AS lc_description,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%developer%API%'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});

// Option 2: AND pattern (~2s) - terms can appear anywhere
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.description AS lc_description,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%developer%'
    AND lc.description ILIKE '%API%'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 20
`
});
```

---

## Top-of-Funnel: ILIKE OR (~300ms for 5000)

**Best for volume.** OR patterns are optimized by PostgreSQL.

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.industry_code IN (4, 6, 96)
    AND (lc.description ILIKE '%saas%'
      OR lc.description ILIKE '%platform%'
      OR lc.description ILIKE '%software%')
  LIMIT 5000
`
});
```

---

## Top-of-Funnel: Indexed Filters Only (~770ms for 5000)

```typescript
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 5000
`
});
```

---

## Regex for Complex Patterns (~TIMEOUT)

**⚠️ WARNING:** Regex (`~*`) queries on large text fields often timeout. Prefer ILIKE patterns or OR clauses instead.

```typescript
// ⚠️ MAY TIMEOUT - regex patterns require full table scan
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ~* 'SaaS.*(usage|consumption|metered)'
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 1000
`
});

// ✅ BETTER: Use OR pattern instead
const { rows } = await services.company.linkedin.search({
   sql: `
  SELECT lc.company_name AS lc_name,
         lc.website AS lc_website,
         'https://www.linkedin.com/company/' || lc.universal_name AS lc_linkedin_url,
         lc.employee_count AS lc_employee_count
  FROM linkedin_company lc
  WHERE lc.country_code = 'US'
    AND lc.description ILIKE '%SaaS%'
    AND (lc.description ILIKE '%usage%' OR lc.description ILIKE '%consumption%' OR lc.description ILIKE '%metered%')
    AND lc.industry_code IN (4, 6, 96)
  LIMIT 1000
`
});
```

---

## Pattern Frequency Impact

**Key insight:** Performance depends on **term frequency**, not word length.

| Description Pattern       | Time        | Notes                                     |
| ------------------------- | ----------- | ----------------------------------------- |
| `%AI%`                    | ~100ms ✅   | Very common term                          |
| `%cloud%`                 | ~200ms ✅   | Common term                               |
| `%API%`                   | ~350ms ✅   | Common term                               |
| `%infrastructure%`        | ~220ms ✅   | Common despite length                     |
| `%cybersecurity%`         | ~400ms ✅   | Medium frequency                          |
| OR patterns               | ~20-65ms ✅ | **Fastest** - PostgreSQL optimizes these  |
| `%SaaS%`                  | ~1.1s 🟡    | Less common                               |
| `%AI%video%` (phrase)     | ~1.2s 🟡    | Phrase requires consecutive match         |
| `%developer%API%` (phrase)| ~3.2s 🟡    | Phrase scan                               |
| `%fintech%`               | ~4.2s 🔴    | **Uncommon term = slow**                  |
| `%personalization%`       | ~7s 🔴      | Very uncommon term                        |
| LIMIT 1000+ with ILIKE    | ~10s 🔴     | Large result sets are slow                |
| Regex `~*`                | TIMEOUT ❌  | Avoid regex on description field          |

**Rule of thumb:** Common terms (AI, cloud, API) are fast. Uncommon/niche terms (fintech, personalization) require scanning more rows to find matches.

---

## ❌ What NOT to Do

See `anti-patterns.md` for:

- ILIKE AND (double scan)
- ORDER BY with text search (26s)
- Missing industry_code filter
