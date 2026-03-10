# CLAUDE.md — Project Memory
<!-- Keep this concise and accurate. Update after significant changes. -->

## Git Rules
- **Never add `Co-Authored-By: Claude` or any Claude co-author trailer** to commit messages.
- Commit and push to `origin main` after completing features.
- Always `git add` ALL relevant changed files including images/assets — `git push` only sends committed files.

---

## What This Project Is
"Where Do I Send This Thing" — a Next.js fullstack app for automated contact enrichment and physical postcard generation targeting recruitment outreach. It scrapes LinkedIn profiles, finds home/office addresses, enriches company data, then generates AI-illustrated postcards.

**Stack:** Next.js 16.1.6 (React 19, TypeScript), Prisma 5 → Supabase (PostgreSQL), AWS Bedrock (Claude), Google Gemini (postcard image gen), OpenAI (fallback), Vercel hosting.

---

## Critical Gotchas (Never Forget)

### Windows: never use `2>/dev/null` in bash commands
- Creates a literal file named `null` in the working directory instead of discarding stderr.
- Use `2>&1` to merge stderr into stdout, or just omit the redirect entirely.
- Prefer Claude tools (Glob, Grep, Read) over shell `ls`/`find`/`grep`.

### JSX in API Routes must use `.tsx` not `.ts`
- Turbopack **rejects JSX syntax in `.ts` files**
- The postcard image route `src/app/api/postcards/[id]/image/route.tsx` MUST be `.tsx`

### Vercel filesystem is read-only
- Do NOT write files to `public/` or anywhere else at runtime on Vercel
- Postcard images → Supabase Storage (bucket: `postcards`), URL stored in DB
- Upload helper: `src/lib/supabase-storage.ts`

### Reference templates must be committed to git
- Nano Banana reads templates from `public/templates/` at runtime on Vercel
- If template images are modified locally, they MUST be `git add`ed, committed, and pushed — otherwise Vercel uses the old version
- Templates: `reference-pose.png` (War Room), `zoom-room-reference.png` (Zoom Room), `screen.png` (dashboard screenshot)

### Do NOT check if dev server is running from a Claude tool call
- `curl`/`Invoke-WebRequest` to localhost **blocks indefinitely**
- Start `npm run dev` as a background task, wait ~15s for "Ready", then run tests

---

## Architecture

### Campaign-Based Pipeline
Each **Campaign** = one `Batch` record owning three linked sub-batches:

```
Batch (Campaign)
  ├── Jobs[] → Contacts[]         (SCAN stage)
  ├── EnrichmentBatch             (ENRICH stage, linked via scanBatchId)
  │     └── CompanyEnrichments[]
  └── PostcardBatch               (POSTCARD stage, linked via scanBatchId)
        └── Postcards[]
```

- `GET /api/campaigns` aggregates all three stages
- `/dashboard/batches` = "Campaigns" page — 3 stage pills with lock/unlock
- **Stage locking**: Enrich locked until ≥1 scanned; Postcard locked until ≥1 enriched

### AI Model Configuration (DB-driven)
- 5 model configs in `SystemPrompt` table:
  - `config_agent_model` — Bedrock Claude for address agent + enrichment
  - `config_chat_model` — contact chat
  - `config_fallback_model` — OpenAI, used on Bedrock ThrottlingException
  - `config_image_gen_model` — Gemini model for postcard generation (default: `gemini-3-pro-image-preview`)
  - `config_image_analysis_model` — Gemini model for postcard analysis (default: `gemini-3.1-pro-preview`)
- Format: `provider::modelId` (e.g. `bedrock::global.anthropic.claude-sonnet-4-5-20250929-v1:0`)
- `src/lib/ai/config.ts` — `getAIClientForRole()` for LLMs, `getGeminiModel()` for Gemini models
- Configured in Admin → Models tab

### Address Lookup Agent (Scan)
- `src/agent/agent-streaming.ts` — up to 25 iterations, 9 tools
- Tools: LinkedIn scraping (Bright Data), Endato address search, PropMix property verification, Exa AI web search, Google Maps distance
- Output: `AgentDecision` → HOME / OFFICE / COURIER with confidence score

### Enrichment Flow (Enrich)
- `POST /api/contacts/enrich-bulk` → creates `EnrichmentBatch`, CONCURRENCY=3, fire-and-forget
- `src/agent/enrichment-agent.ts` — Bedrock Claude (max 22 iterations), falls back to OpenAI on rate limit
- Contacts with no `company` use `"Unknown"` — agent discovers from LinkedIn
- **Revision-based**: Always creates a NEW `CompanyEnrichment` record (never overwrites). Old revisions get `isLatest: false` but are preserved.
- **6 tools**: `fetch_company_logo` (Hunter→Brandfetch→Logo.dev), `search_web` (Exa), `search_people` (Exa people), `fetch_url`, `scrape_linkedin_profile` (Bright Data + PDL fallback), `submit_enrichment`
- **Agent workflow**: Step 0 verify company via LinkedIn → Step 1-2 logo → Step 3-4 roles/values/mission → Step 5-7 team photos → Step 8 submit
- **Logo chain**: Hunter.io → Brandfetch → Logo.dev → manual HTML scraping (4 tiers)
- **Team photos**: `search_people` (Exa) → fallback `search_web` site:linkedin.com → `scrape_linkedin_profile` for headshots
- **Open roles**: `search_web` for LinkedIn jobs page → `fetch_url` to scrape → top 3 US-only highest-level unique titles

### Reviews Page (Postcard QA)
- `/dashboard/reviews` — review, approve, edit & regenerate postcards
- **No dedicated DB table** — uses `Postcard.status` (`ready` → `approved` / `reviewed`)
- **Edit & Regenerate**: inline editor for prospect photo, company logo, company name, team members, roles, template, custom prompt, back message
- **Sync-back to enrichment**: `POST /api/postcards/generate` syncs overrides (logo, roles, team photos, company name) back to the `isLatest` CompanyEnrichment record AND `Contact.company` — so enrichment stays source of truth
- **Postcard versioning**: each regeneration creates a new `Postcard` with `parentPostcardId` → forms linked-list revision chain. "Versions" modal shows all versions per contact with "Restore" button
- **No enrichment versioning UI**: CompanyEnrichment has revisions in DB but no user-facing timeline/revert in the reviews page

### Postcard Generation — Nano Banana (Gemini)
- `src/lib/postcard/nano-banana-generator.ts` — **agentic generate→analyze→correct loop**
- **Flow**: reference template + input images → Gemini generates scene → Gemini analyzes output → regenerate with corrections → repeat (max 4 attempts)
- Reference templates have **labeled placeholder slots**: gray silhouettes ("Person 1"–"Person 6"), "[COMPANY LOGO]", "[TOP ROLES]"
- Two templates: **War Room** (office contacts), **Zoom Room** (remote contacts)
- Gemini API key rotation on 429: cycles through `GEMINI_API_KEY` and `GOOGLE_AI_STUDIO`
- `parseIssues()` extracts PASS/FAIL + issues from analysis — falls back to raw FAIL lines when issues can't be parsed
- Images uploaded to Supabase Storage, URL stored in `Postcard.imageUrl`
- Regeneration via modal on contact page — creates new postcard with `parentPostcardId` (revision history)

### Centralized Logging (AppLog)
- `src/lib/app-log.ts` — `appLog(level, source, action, message, meta?)` writes to `AppLog` table
- Sources: `gemini`, `openai`, `bedrock`, `bright_data`, `endato`, `propmix`, `exa_ai`, `supabase`, `system`
- Fire-and-forget: `appLog(...).catch(() => {})` — never crashes caller
- Admin UI: Logs tab (search + filter), Analytics tab (daily breakdown), Status indicators (colored dots per service)
- Health check cron: `/api/cron/health-check` every 2 hours (vercel.json)

### Non-Blocking Dispatch (Campaign Page)
- `batches/[id]/page.tsx` uses `CONCURRENCY=5` with `withTimeout()` wrapper (5-min per job)
- `drainQueue()` fires recursively from `.finally()` to fill slots

### Per-Item Cancel + Stale Auto-Recovery
- Cancel endpoints: `POST /api/enrichments/[id]/cancel`, `POST /api/batches/[id]/jobs/[jobId]/cancel`, `PATCH /api/postcards/[id]`
- Stale items >10 minutes auto-reset to "failed" on polling
- "Process Stuck" button resets stale items to "pending" for re-dispatch

### Postcards Gallery
- `/dashboard/postcards` — shows only **latest** postcard per contact, hides failed/pending
- "Versions" button opens modal with older versions, "Restore" swaps which version is current
- API: `GET /api/postcards?latestOnly=true` (default excludes failed/pending)

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/postcard/nano-banana-generator.ts` | Gemini agentic postcard gen (generate→analyze→correct) |
| `src/lib/app-log.ts` | Structured logging to AppLog table |
| `src/lib/ai/config.ts` | `getAIClientForRole()` + `getGeminiModel()` — DB-driven model routing |
| `src/lib/supabase-storage.ts` | Upload/delete images in Supabase Storage |
| `src/agent/agent-streaming.ts` | Address lookup agent (Scan) |
| `src/agent/enrichment-agent.ts` | Company enrichment agent (Enrich) |
| `src/agent/services.ts` | External API calls (Endato, Bright Data, PropMix, Exa, Hunter, Brandfetch, Logo.dev, PDL) |
| `src/app/dashboard/reviews/page.tsx` | Reviews page — postcard QA, edit & regenerate, versions |
| `src/app/api/postcards/generate/route.ts` | Creates Postcard record + syncs overrides back to CompanyEnrichment |
| `src/app/api/contacts/enrich-bulk/route.ts` | Bulk enrichment — creates batch + revision records, CONCURRENCY=3 |
| `src/app/api/contacts/[id]/enrich/route.ts` | Single contact enrichment + GET revisions + DELETE revision |
| `src/app/api/campaigns/route.ts` | GET — aggregates all 3 stages |
| `src/app/api/campaigns/[id]/route.ts` | GET — per-contact view with all data |
| `src/app/dashboard/batches/[id]/page.tsx` | Unified campaign page — CONCURRENCY=5 dispatcher |
| `src/components/postcards/regenerate-modal.tsx` | Postcard regeneration — photos/logo/template/prompt |
| `src/app/api/postcards/[id]/image/route.tsx` | **MUST BE .tsx** — next/og ImageResponse |
| `src/app/api/postcards/route.ts` | GET — postcards list (latestOnly, excludes failed by default) |
| `src/app/dashboard/admin/page.tsx` | Admin — prompts, models, logs, analytics, status |
| `src/app/api/admin/logs/route.ts` | Paginated logs API (cursor-based) |
| `src/app/api/admin/status/route.ts` | Per-service status from logs |
| `src/app/api/admin/analytics/route.ts` | Token usage + daily breakdown |
| `src/app/api/cron/health-check/route.ts` | 2-hour health check (Gemini, OpenAI, Supabase, Bedrock) |
| `prisma/schema.prisma` | DB schema |
| `vercel.json` | Cron schedule |
| `public/templates/reference-pose.png` | War Room template (labeled placeholders) |
| `public/templates/zoom-room-reference.png` | Zoom Room template |

---

## Database Schema (Key Models)

- **User** → **Batch** (Campaign) → **Job** → **AgentEvent**
- **Job** → **Contact** (1:1)
- **Batch** → **EnrichmentBatch** (`scanBatchId`) → **CompanyEnrichment**
- **Batch** → **PostcardBatch** (`scanBatchId`) → **Postcard**
- **Contact** → **CompanyEnrichment** (`isLatest` + `revisionNumber`) — revision-based, old revisions preserved
- **Contact** → **ContactRevision** (`isLatest` + `revisionNumber`) — snapshots of contact data (name, company, address, etc.)
- **Contact** → **Postcard** (1:many, `parentPostcardId` for revision chain)
- **Postcard** → **PostcardReference** (input images used)
- **Team** → **TeamMember**, **PostcardTemplate**
- **AppLog** — structured logging (level, source, action, message, meta JSON)
- **SystemPrompt** — admin-editable prompts + 5 model configs

### Prisma relation field names (use in `include`/`select`)

| Model | Field | Points to |
|---|---|---|
| `Contact` | `companyEnrichments` | `CompanyEnrichment[]` ← **NOT `enrichments`** |
| `Contact` | `postcards` | `Postcard[]` |
| `EnrichmentBatch` | `enrichments` | `CompanyEnrichment[]` |
| `PostcardBatch` | `postcards` | `Postcard[]` |
| `Batch` | `jobs`, `enrichmentBatches`, `postcardBatches` | respective arrays |

---

## Environment Variables

```
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION   # Bedrock (Claude)
OPENAI_API_KEY                                            # Fallback model
GEMINI_API_KEY / GOOGLE_AI_STUDIO                         # Gemini postcard gen (key rotation on 429)
SUPABASE_DB_URL / SUPABASE_DB_URL_DIRECT                  # PostgreSQL
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY                   # Supabase Storage
BRIGHT_DATA_API_KEY                                       # LinkedIn scraping
ENDATO_API_NAME / ENDATO_API_PASSWORD                     # Address lookup
EXA_AI_KEY                                                # Web search
PROPMIX_ACCESS_TOKEN                                      # Property verification
GOOGLE_SEARCH_API_KEY                                     # Distance calculation
LI_API_KEY                                                # Vetric API (LinkedIn live data — profiles, posts, search)
NEXT_PUBLIC_APP_URL                                       # Used by screenshotPostcard
JWT_SECRET                                                # Session signing
DEBUG_API_KEY                                             # Admin/debug endpoints
CRON_SECRET                                               # Vercel cron auth (auto-provided)
```

---

## External APIs Used by Enrichment

| Service | Purpose | Env Var | Notes |
|---|---|---|---|
| Hunter.io | Logo (primary) | — | Free, uses `logos.hunter.io/{domain}` |
| Brandfetch | Logo + brand data (fallback) | `BRANDFETCH_API_KEY` | Also returns colors, description |
| Logo.dev | Logo (tertiary) | `LOGO_DEV_TOKEN` | Simple image URL |
| Exa AI | Web search + people search | `EXA_AI_KEY` | Used for roles, values, team members, LinkedIn fallback |
| Bright Data | LinkedIn scraping | `BRIGHT_DATA_API_KEY` | Profile data + headshots |
| PDL | People enrichment | — | Fallback for photos; **credits exhausted** (HTTP 402) |
| Vetric | LinkedIn live data (profiles, posts, search) | `LI_API_KEY` | `api.vetric.io` — **primary LinkedIn data source**, see Vetric section below |

---

## Vetric API — LinkedIn Live Data (Primary Source)

**Base URL:** `https://api.vetric.io/linkedin/v1`
**Auth:** Header `x-api-key: {LI_API_KEY}` (env var `LI_API_KEY`)

Vetric provides **live, real-time LinkedIn data** — profiles, experience, posts, search. It replaces Bright Data for profile lookups and PDL for people enrichment. Use it as the **first choice** for any LinkedIn data needs.

### Profile Endpoints (by public_identifier slug)

The `public_identifier` is the slug from a LinkedIn URL: `linkedin.com/in/jamesdurkin` → `jamesdurkin`.

| Endpoint | Returns |
|---|---|
| `GET /profile/{slug}` | Full profile: name, headline, location, connections, followers, **800×800 profile photo**, background image, top position (company name + logo), premium/verified status, about snippet |
| `GET /profile/{slug}/about` | Full about text, featured items, languages, licenses/certifications |
| `GET /profile/{slug}/experience` | Full work history: each company (name, logo, URL, URN) with positions (role, dates, description, employment type, is_current) |
| `GET /profile/{slug}/education` | Schools, degrees, dates, activities |
| `GET /profile/{slug}/skills` | Skills list with endorser counts |

**Key fields from `/profile/{slug}`:**
```json
{
  "first_name": "James",
  "last_name": "Durkin",
  "headline": "Head of Talent at Boston Dynamics",
  "profile_picture": "https://media.licdn.com/dms/image/...shrink_800_800/...",
  "location": { "name": "Greater Boston", "country": { "name": "United States" } },
  "connections": 3125,
  "followers": 3767,
  "top_position": {
    "start_date": { "year": 2021 },
    "company_info": {
      "name": "Boston Dynamics",
      "logo": "https://media.licdn.com/.../company-logo_400_400/...",
      "public_identifier": "boston-dynamics",
      "url": "https://www.linkedin.com/company/boston-dynamics/"
    }
  },
  "public_identifier": "jamesdurkin",
  "urn": "urn:li:fsd_profile:ACoAAACVnSMB...",
  "is_verified": true,
  "has_premium": true
}
```

### Search Endpoints

| Endpoint | Method | Key Params | Returns |
|---|---|---|---|
| `/search/posts` | GET | `keywords` (required), `sortBy` (`top`/`latest`), `datePosted` (`day`/`week`/`month`), `fromOrganization`, `fromMember`, `cursor` | Posts with full author data (name, title, **photo URL**, profile URL, URN), text, engagement, attachments. Max 10/page, 1000 total |
| `/search/mentions` | GET | `keywords` (required) | Company/Member entities matching keywords — returns URNs, URLs, names. Useful for resolving company org IDs |

**Search posts response author object:**
```json
{
  "author": {
    "type": "Member",
    "first_name": "Nicole",
    "last_name": "Neglia, SHRM-SCP",
    "occupation": "National Director, Talent Acquisition at Withum",
    "image_url": "https://media.licdn.com/dms/.../profile-displayphoto-shrink_200_200/...",
    "urn": "urn:li:fsd_profile:ACoAA...",
    "url": "https://www.linkedin.com/in/...",
    "public_identifier": "nicole-neglia-shrm-scp-12345"
  }
}
```

### How to Use Vetric for Common Tasks

**1. Verify a team member still works at company:**
```
GET /profile/{slug} → check top_position.company_info.name
```

**2. Get profile photo for a team member (by LinkedIn URL slug):**
```
GET /profile/{slug} → profile_picture (800×800)
```

**3. Get current title for a person:**
```
GET /profile/{slug} → headline (or top_position role from /experience)
```

**4. Find recruiters/TA people at a company:**
```
GET /search/posts?keywords={company}+recruiting+hiring&sortBy=latest&datePosted=month
→ Filter authors where occupation contains company name
→ Each author has image_url, public_identifier, occupation (current title)
```

**5. Get company logo:**
```
GET /profile/{any_employee_slug} → top_position.company_info.logo (400×400)
```

**6. Discover company org ID (for fromOrganization filter):**
```
GET /search/mentions?keywords={company_name} → find type:"Company" entry → urn split by ":" gives org ID
```

### Pagination
All search endpoints return `cursor` field. Pass it as `?cursor=...` for next page. Loop until no cursor returned.

### Rate Limits & Gotchas
- No explicit rate limit documented — but be respectful
- Profile endpoint returns `{"message":"Entity Not Found"}` for invalid slugs (not 404)
- `fromOrganization` filter with `datePosted=month` may return 0 if company doesn't post often
- Image URLs are CDN links with expiry (`?e=...`) — they expire after ~1 month, re-fetch if stale
- Profile photos come in `shrink_800_800` (high-res) or `shrink_200_200` (thumbnail) — prefer 800
- The `occupation` field in search results = current headline, may differ from `/profile/{slug}` headline

### Also Supports (Not Yet Used)
- **Facebook:** `POST /facebook/v1/search/posts`, `POST /facebook/v1/search/users`
- **Twitter/X:** `GET /twitter/v1/search/popular`, `GET /twitter/v1/search/recent`, `GET /twitter/v1/search/people`
- **Instagram:** `GET /instagram/v1/discover/user`, `GET /instagram/v1/discover/content` (requires header `x-version: 2026-1`)

---

## Known Issues / TODO

- `@sparticuz/chromium` and `playwright-core` still in `dependencies` but unused — safe to remove.
- `/postcard-render/[postcardId]` page still exists but unused (legacy Playwright approach).
- `src/agent/experimental/` contains a newer agent iteration — may be for testing.
- Notes: `notes/shane-convo-2026-02-20.md` has product decisions from Shane.
- PDL credits exhausted (HTTP 402) — avatar fallback still tries PDL but always fails.
- Katie Burner appears as a duplicate contact under Aledade — needs deduplication.
- `Postcard.status` schema comment is missing `"reviewed"` but code uses it actively.
