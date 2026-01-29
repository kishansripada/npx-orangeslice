# lkd_profile
Use: Headline ILIKE + company constraint (13-93x faster), rare terms, 3+ filters. Denormalized world.
Alias: `lkd`

## 🛑 BEFORE WRITING YOUR QUERY — VERIFY THESE COLUMNS:

- **Location filtering?** Use `country_iso` or `locality` (NOT location_country_code, location_name)
- **LinkedIn URL?** Use `url` (NOT public_profile_url)
- **Primary key?** Use `profile_id` (NOT id)
- **US filter?** Use `WHERE lkd.country_iso = 'US'`
- **JOIN to company?** Use `lkd_company` (NOT linkedin_company)

## When to Use
✅ headline ILIKE + company filter | ✅ rare terms (solidity,kubernetes) | ✅ skill + company | ✅ 3+ filters
❌ ID/slug lookups→use linkedin_profile | ❌ numeric only→use linkedin_profile

## ⚠️ COLUMNS DIFFER from linkedin_profile

| linkedin_profile (lp)      | lkd_profile (lkd)      |
| -------------------------- | ---------------------- |
| `lp.id`                    | `lkd.profile_id`       |
| `lp.location_country_code` | `lkd.country_iso`      |
| `lp.public_profile_url`    | `lkd.url`              |
| `lp.connections`           | `lkd.connection_count` |
| `lp.num_followers`         | `lkd.follower_count`   |

## Columns
profile_id int=linkedin_profile_id | person_id int | slug text | url text=LinkedIn URL | name text | first_name text | last_name text | company_name text | title text | headline text | country_iso text | country_name text | locality text | industry_id int | industry_name text | connection_count int | follower_count int | skills text[] | linkedin_company_id int

## JSON Columns
position json | experience json | education json | certifications json | courses json | projects json | volunteering json | patents json | awards json | publications json | recommendations json | languages json | articles json

## ⚠️ Critical
- NEVER mix with normalized: `lkd_profile JOIN linkedin_company`→BROKEN
- US filter: `country_iso = 'US'` (NOT location_country_code)
- Has `url` column for LinkedIn URL (not public_profile_url)
- JSON cols contain all nested data→no need to JOIN detail tables
