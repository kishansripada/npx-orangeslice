# Person Headline Search

> See `linkedin_data/QUICK_REF.md` for critical rules before writing any query.

Search for people by their LinkedIn headline. Performance: ✅ 11ms - 1.3s depending on pattern.

---

## ⚠️ Headline + Location: Decompose for Prospecting

**`headline` and `location` are both NOT indexed.** Combining them can timeout, especially for rare terms.

**For PROSPECTING (building broad lists), decompose:**

1. **Top-of-funnel**: Get people by headline (common terms only) OR by company (indexed)
2. **Enrichment column**: Add "Location" column from profile data
3. **User filtering**: Let users filter the spreadsheet by location

**Example - "[Role] in [Location]":**

```
❌ RISKY: headline ILIKE '%iOS developer%' AND location_country_code = 'US' → TIMEOUT

✅ BETTER for prospecting:
1. Get people with headline '%mobile%' (broader, faster) → 500 people
2. Add "Location" enrichment column
3. Add "Mentions iOS" enrichment column (AI classification on headline)
4. User filters by location + iOS
```

**When direct headline + location works:**
- Common headline terms (engineer, sales, CEO) + US filter: ~200ms-2s
- Rare headline terms + any location: TIMEOUT

---

## Text Selectivity: The Key Performance Factor

The frequency of your search term determines performance. **Very rare terms will TIMEOUT.**

### Tested Performance (normalized tables, LIMIT 100)

| Headline Term              | Duration  | Status          |
| -------------------------- | --------- | --------------- |
| **AI** (very common)       | ~60ms     | ✅ Fast         |
| **Software Engineer**      | ~280ms    | ✅ Fast         |
| **CEO\|CTO\|CFO** (regex)  | ~1,000ms  | ✅ Good         |
| **Machine Learning**       | ~2,300ms  | 🟡 Slow         |
| **DevOps** (uncommon)      | ~2,100ms  | 🟡 Slow         |
| **Kubernetes** (rare)      | ~7,200ms  | 🟡 Very slow    |
| **Solidity** (very rare)   | TIMEOUT   | ❌ Don't use    |

### The Crossover Rule

| Headline Term            | Normalized | Denormalized | Winner              |
| ------------------------ | ---------- | ------------ | ------------------- |
| **CEO** (very common)    | **55ms**   | 131ms        | Normalized (2.4x)   |
| **engineer** (common)    | **24ms**   | 136ms        | Normalized (5.7x)   |
| **devops** (uncommon)    | 409ms      | **256ms**    | Denormalized (1.6x) |
| **tensorflow** (rare)    | 28,000ms   | **9,873ms**  | Denormalized (2.8x) |
| **solidity** (very rare) | TIMEOUT    | TIMEOUT      | ❌ Neither works    |

**Why?** Common terms have high early-termination probability—PostgreSQL finds matches quickly. Rare terms require scanning more rows, where denormalized's smaller row size wins.

### Quick Decision

```
Is the term common? (CEO, engineer, manager, developer, sales)
  └─ YES → Use normalized (linkedin_profile)

Is the term uncommon/rare? (devops, kubernetes, blockchain, tensorflow)
  └─ YES → Use denormalized (lkd_profile)
```

### Rare Term Search: Denormalized

```typescript
// ✅ BEST for rare terms: ~7s (vs 28s normalized - 4x faster)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lkd.profile_id, lkd.first_name AS lp_first_name,
         lkd.headline AS lp_headline, lkd.company_name AS lp_company
  FROM lkd_profile lkd
  WHERE lkd.country_iso = 'US'
    AND lkd.headline ILIKE '%tensorflow%'
  LIMIT 100
`
});
```

---

## LIMIT Size Impact

Larger LIMITs amplify the normalized vs denormalized difference.

| Term Type             | LIMIT 10                 | LIMIT 100                   | LIMIT 500-1000                  |
| --------------------- | ------------------------ | --------------------------- | ------------------------------- |
| **Common** (engineer) | N: 24ms, D: 42ms         | N: 24ms, D: 136ms           | N: 80ms, D: 865ms (N 10.8x)     |
| **Rare** (blockchain) | N: 234ms, D: 241ms (tie) | N: 713ms, D: 384ms (D 1.9x) | N: 3,725ms, D: 2,806ms (D 1.3x) |

**Rule:** Common terms + large LIMITs → Normalized scales better. Rare terms → Denormalized maintains advantage.

---

## Simple Headline ILIKE (~11-69ms)

**Why it's fast:** Single ILIKE pattern with common keywords finds matches quickly.

### People working on AI (~11ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.title AS lp_title,
         lp.org AS lp_company,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  WHERE lp.location_country_code = 'US'
    AND lp.headline ILIKE '%AI%'
  LIMIT 100
`
});
```

### CTOs at AI startups (~69ms)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.title AS lp_title,
         lp.org AS lp_company,
         lp.public_profile_url AS lp_linkedin_url
  FROM linkedin_profile lp
  WHERE lp.location_country_code = 'US'
    AND lp.headline ILIKE '%CTO%' AND lp.headline ILIKE '%AI%'
  LIMIT 100
`
});
```

**⚠️ Warning:** While this `AND` works for common keywords like CTO+AI, it gets slow with rarer terms. See `anti-patterns.md`.

---

## Headline Regex for Large Volume (~800-1,300ms for 5000)

**Why regex is better:** Single scan with multiple patterns, vs multiple ILIKE scans.

### Executives & Founders

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
    AND lp.headline ~* '(\\mCEO\\M|\\mCTO\\M|\\mCFO\\M|founder|Chief Executive)'
  LIMIT 5000
`
});
```

### AI/ML Professionals

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
    AND lp.headline ~* '(\\mAI\\M|\\mML\\M|machine learning|data scientist)'
  LIMIT 5000
`
});
```

---

## Word Boundaries

**Why use `\m...\M`:** Prevents false positives with short keywords.

| Pattern   | Matches | Does NOT Match          |
| --------- | ------- | ----------------------- |
| `\mCEO\M` | "CEO"   | "Coordinator"           |
| `\mAI\M`  | "AI"    | "MAIL", "FAIR"          |
| `\mVP\M`  | "VP"    | "SVP" (might want both) |

---

## Headline + Location Filtering

Person location columns exist but are **NOT indexed**:

- `lp.location_country_code` (e.g., 'US', 'GB')
- `lp.location_name` (e.g., 'San Francisco, California')

### ⚠️ Country Filter Can Make Queries SLOWER

Counterintuitively, adding a country filter can slow down queries significantly:

| Query                               | Duration  |
| ----------------------------------- | --------- |
| Software Engineer (no filter)       | ~120ms    |
| Software Engineer (US)              | ~280ms    |
| Software Engineer (UK)              | ~1,700ms  |
| Software Engineer (Germany)         | ~4,600ms  |

**Why?** Without a filter, the database finds matches quickly from the global pool. With a filter, it must scan more rows to find matches that satisfy both conditions.

**Recommendation:** For common patterns, use US or skip the country filter entirely. For non-US queries, expect 2-5x slower performance.

### ✅ WORKS: Common patterns + location (~200ms-2s)

```typescript
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.location_name AS lp_location
  FROM linkedin_profile lp
  WHERE lp.headline ILIKE '%software engineer%'
    AND lp.location_country_code = 'US'
  LIMIT 100
`
});
// Duration: ~223ms ✅
```

### ❌ TIMEOUT: Rare patterns + location

```typescript
// ❌ This times out because 'iOS developer' is rare
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.location_name AS lp_location
  FROM linkedin_profile lp
  WHERE lp.headline ILIKE '%iOS developer%'
    AND lp.location_country_code = 'US'
  LIMIT 100
`
});
```

### ✅ FIX: Two-step approach for rare patterns

```typescript
// Step 1: Query with broader pattern (no location filter)
const { rows } = await services.person.linkedin.search({
   sql: `
  SELECT lp.first_name AS lp_first_name,
         lp.last_name AS lp_last_name,
         lp.headline AS lp_headline,
         lp.location_name AS lp_location
  FROM linkedin_profile lp
  WHERE lp.headline ILIKE '%mobile%'  -- Broader pattern
  LIMIT 200  -- Fetch extra to filter
`
});

// Step 2: Filter by location in code
const usIOSDevelopers = rows.filter(
   (r) => r.lp_location?.toLowerCase().includes("united states") && r.lp_headline.toLowerCase().includes("ios")
);
```
