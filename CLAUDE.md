# CLAUDE.md — Project Memory
<!-- Always update this file after any changes! Write new entries at the TOP of each section. -->

## Git Rules
- **Never add `Co-Authored-By: Claude` or any Claude co-author trailer** to commit messages.
- Commit and push to `origin main` after completing features.

---

## What This Project Is
"Where Do I Send This Thing" — a Next.js fullstack app for automated contact enrichment and physical postcard generation targeting recruitment outreach. It scrapes LinkedIn profiles, finds home/office addresses, enriches company data, then generates printed postcards.

**Stack:** Next.js 16.1.6 (React 19, TypeScript), Prisma 5 → Supabase (PostgreSQL), AWS Bedrock (Claude), OpenAI, Vercel hosting.

---

## Critical Gotchas (Never Forget)

### Windows: never use `2>/dev/null` in bash commands
- This is a Windows machine. `2>/dev/null` in bash **creates a literal file named `null`** in the working directory instead of discarding stderr.
- Use `2>&1` to merge stderr into stdout, or just omit the redirect entirely.
- `/null` and `/NUL` are gitignored to contain the damage, but the fix is to never use `2>/dev/null`.

### Windows: use `powershell -Command` for file/process operations, not unix tools
- `ls`, `find`, `grep` etc. may not behave as expected — prefer PowerShell or the dedicated Claude tools (Glob, Grep, Read).
- Path separators: use forward slashes in bash commands (`d:/wildcard/...`), backslashes in PowerShell.

### JSX in API Routes must use `.tsx` not `.ts`
- Turbopack (used by Next.js dev) **rejects JSX syntax in `.ts` files**
- The postcard image route `/src/app/api/postcards/[id]/image/route.tsx` uses `ImageResponse` with JSX — it MUST be `.tsx`
- Discovered Feb 21, 2026: route was `.ts`, caused 500 on every request with "Expected '>', got 'ident'" parse error

### Vercel filesystem is read-only
- Do NOT write files to `public/` or anywhere else at runtime on Vercel
- Previously: generate routes wrote PNGs to `public/postcards/` — this silently fails on Vercel
- Fix: store images as `data:image/png;base64,...` strings directly in `Postcard.backgroundUrl` and `Postcard.imageUrl` DB fields

### No Playwright/Chromium on Vercel
- `@sparticuz/chromium` (~170MB) exceeds Vercel's 50MB function size limit
- Replaced with `next/og` (`ImageResponse`) — renders React components server-side to PNG, no browser needed
- New image route: `GET /api/postcards/[id]/image` → returns PNG bytes
- `screenshotPostcard()` now fetches that route and returns base64 string

### Do NOT check if dev server is running before running tests
- Using `curl` or `Invoke-WebRequest` against localhost **blocks the Claude process** indefinitely
- To run server-dependent tests: start `npm run dev` as a background task first, wait ~15s for "Ready", then run the test
- If stuck: user has to kill node manually

### Enrichment skips contacts with no `company` field — fixed
- Old behavior: both `enrich-bulk` and single `enrich` routes returned 400/skipped if `contact.company` was null
- Fix: allow all contacts through, use `contact.company ?? "Unknown"` as placeholder — enrichment agent discovers real company from LinkedIn URL

### `gpt-image-1` may not be available (tier-gated)
- `generateBackground()` tries `gpt-image-1` first, falls back to `dall-e-3` automatically
- Both return base64 PNG — no filesystem writes needed
- `gpt-image-1` produces ~3MB PNGs; `dall-e-3` produces smaller ones

### Real lead data: Frank Chang
- CSV ref: AMP-15 — but the "AMP" prefix is an internal code, NOT company name
- `linkedin.com/in/frankchang` is at **Uber** (not Amplitude) — the agent correctly identifies this
- Known address: 950 23RD ST, San Francisco, CA 94107
- Used as the standard test lead in `tests/`

---

## Architecture

### Campaign-Based Pipeline (New Structure)
Each **Campaign** = one `Batch` record that owns three linked sub-batches flowing sequentially:

```
Batch (Campaign)
  ├── Jobs[] → Contacts[]         (SCAN stage)
  ├── EnrichmentBatch             (ENRICH stage, linked via scanBatchId)
  │     └── CompanyEnrichments[]
  └── PostcardBatch               (POSTCARD stage, linked via scanBatchId)
        └── Postcards[]
```

- `GET /api/campaigns` aggregates all three stages into a single object for the dashboard
- `/dashboard/batches` is now the **"Campaigns" page** — shows all 3 stage pills (Scan | Enrich | Postcard) with live counts and lock/unlock state
- **Stage locking**: Enrich is locked until ≥1 contact is scanned; Postcard is locked until ≥1 contact is enriched

### AI Model Configuration (DB-driven)
- Models stored in `SystemPrompt` table with keys: `config_agent_model`, `config_chat_model`, `config_fallback_model`
- Format: `provider::modelId` (e.g. `openai::gpt-5.2`, `bedrock::global.anthropic.claude-sonnet-4-5-20250929-v1:0`)
- `src/lib/ai/config.ts` — `getAIClientForRole('agent' | 'chat' | 'fallback')` reads from DB, falls back to env vars / DEFAULT_MODEL
- Configured in Admin → Models tab — now has 3 rows: Agent, Chat, Fallback
- **Fallback model** is used when the agent model hits a rate limit (Bedrock ThrottlingException) — must be an OpenAI model
- `gpt-5.2` uses the Responses API format (`max_completion_tokens`, no `temperature`) — already handled in `openai-client.ts`

### Address Lookup Agent (Scan Stage)
- `src/agent/agent-streaming.ts` — accepts a LinkedIn URL, runs up to 25 iterations with 9 tools
- Tools: LinkedIn scraping (Bright Data), People Data Labs, WhitePages/Endato address search, property verification (PropMix), Exa AI web search, Google Maps distance calculation
- Emits `AgentEvent` records to DB on each iteration (streamed via `GET /api/batches/[id]/jobs/[jobId]/stream`)
- Output: `AgentDecision` → HOME / OFFICE / COURIER recommendation with confidence score

### Enrichment Flow (Enrich Stage)
1. `POST /api/contacts/enrich-bulk` — creates `EnrichmentBatch` (linked to `Batch.id` via `scanBatchId`), creates `CompanyEnrichment` records (status=`enriching`), runs agents at `CONCURRENCY=3`. Returns `enrichmentBatchId` → redirects to `/dashboard/enrichments/[id]`
2. `POST /api/contacts/[id]/enrich` — single contact path (no batch)
3. `runEnrichmentAgent()` in `src/agent/enrichment-agent.ts` — primary model from DB, falls back to fallback model on rate limit
4. On completion, `.finally()` marks `EnrichmentBatch.status` → `complete` or `failed`
5. `/dashboard/enrichments/[id]` polls `GET /api/enrichment-batches/[id]` every 3s while `status === "running"`

### Postcard Generation Flow (Postcard Stage)
1. `POST /api/postcards/generate-bulk` — creates `PostcardBatch` (linked to `Batch.id` via `scanBatchId`), fire-and-forgets generation. Returns `postcardBatchId` → redirects to `/dashboard/postcards/batches/[id]`
2. `POST /api/postcards/generate` — single postcard path
3. Fire-and-forget per postcard:
   - `generateBackground(prompt)` → base64 PNG → `Postcard.backgroundUrl`
   - Status → `generating`
   - `screenshotPostcard(postcardId)` → fetches `GET /api/postcards/[id]/image` → base64 PNG → `Postcard.imageUrl`
   - Status → `ready`

### Image Rendering (`next/og`)
- `src/app/api/postcards/[id]/image/route.tsx` — uses `ImageResponse` from `next/og`
- Renders `WarRoomPostcard` or `ZoomRoomPostcard` React component at 1536×1024
- **Must be `.tsx`** (not `.ts`) — contains JSX
- No auth required; zero binary dependencies; works on Vercel

### Templates
- **War Room** (default): vintage map + city pins + hiring panel + contact photo. Used when contact has an office address.
- **Zoom Room**: simulated Zoom meeting UI. Used when contact is fully remote (`fully_remote` flag or no office address).

### Retry Logic (Enrichments + Postcards)
- Both `CompanyEnrichment` and `Postcard` have `retryCount Int @default(0)`, max 5 attempts, exponential backoff (2^attempt seconds)
- Manual retry resets `retryCount` to 0: `POST /api/enrichment-batches/[id]/retry` or `POST /api/postcards/[id]/retry`

---

## Key Files

| File | Purpose |
|---|---|
| `src/app/api/campaigns/route.ts` | GET — aggregates Batch + EnrichmentBatch + PostcardBatch into unified campaign objects |
| `src/app/dashboard/batches/page.tsx` | "Campaigns" page — 3-stage pills (Scan/Enrich/Postcard) with lock/unlock state |
| `src/app/dashboard/batches/[id]/page.tsx` | Batch detail with per-job streaming events |
| `src/agent/enrichment-agent.ts` | Company enrichment agent (Bedrock/Claude) |
| `src/agent/agent-streaming.ts` | Address lookup agent with streaming |
| `src/agent/tools.ts` | Tool definitions and dispatch |
| `src/agent/services.ts` | External API calls (Endato, Bright Data, PropMix, etc.) |
| `src/lib/ai/config.ts` | `getAIClientForRole()` — DB-driven model routing with fallback |
| `src/lib/postcard/background-generator.ts` | AI background image gen (gpt-image-1 → dall-e-3 fallback) |
| `src/lib/postcard/screenshot.ts` | Fetches image route, returns base64 |
| `src/lib/postcard/prompt-generator.ts` | War room / zoom room prompts |
| `src/app/api/postcards/[id]/image/route.tsx` | **MUST BE .tsx** — next/og ImageResponse |
| `src/app/api/postcards/generate/route.ts` | Single postcard generation |
| `src/app/api/postcards/generate-bulk/route.ts` | Bulk postcard generation — creates PostcardBatch |
| `src/app/api/contacts/[id]/enrich/route.ts` | Single contact enrichment |
| `src/app/api/contacts/enrich-bulk/route.ts` | Bulk enrichment — creates EnrichmentBatch, CONCURRENCY=3 |
| `src/app/api/enrichment-batches/[id]/route.ts` | GET single enrichment batch with per-contact statuses |
| `src/app/api/enrichment-batches/[id]/retry/route.ts` | POST — resets failed enrichments, re-queues |
| `src/app/api/enrichment-batches/[id]/cancel/route.ts` | POST — cancels running enrichments |
| `src/app/api/postcard-batches/[id]/route.ts` | GET single postcard batch |
| `src/app/api/postcard-batches/[id]/retry/route.ts` | POST — retries failed postcards |
| `src/app/api/postcard-batches/[id]/cancel/route.ts` | POST — cancels postcard generation |
| `src/app/api/batches/[id]/start/route.ts` | POST — starts job processing |
| `src/app/api/batches/[id]/stop/route.ts` | POST — halts job processing |
| `src/app/api/batches/[id]/retry-failed/route.ts` | POST — retries failed jobs |
| `src/app/api/batches/[id]/jobs/[jobId]/stream/route.ts` | GET — streams AgentEvents for a job |
| `src/app/api/admin/reset/route.ts` | POST — wipes DB by scope; requires `x-debug-key` header |
| `src/app/api/debug/status/route.ts` | GET — platform status; requires `?key=` param |
| `src/app/dashboard/enrichments/[id]/page.tsx` | Enrichment detail (per-contact spinners, polls every 3s) |
| `src/app/dashboard/postcards/page.tsx` | Postcard gallery — filter, approve, download, export CSV |
| `src/app/dashboard/postcards/batches/[id]/page.tsx` | Postcard batch detail |
| `src/app/dashboard/pipeline/page.tsx` | Pipeline overview page |
| `src/app/dashboard/upload/page.tsx` | Upload page — paste LinkedIn URLs or CSV |
| `src/app/sammy/page.tsx` | Internal briefing page (Shane's requirements for Sammy) |
| `src/lib/auth.ts` | JWT + session cookie utilities |
| `src/lib/db.ts` | Prisma singleton |
| `prisma/schema.prisma` | DB schema |
| `prompts/agent_main.md` | Address lookup agent system prompt (editable via Admin UI) |

---

## Database Schema (Key Models)

- **User** → **Batch** (1:many, the "Campaign") → **Job** (1:many) → **AgentEvent** (1:many)
- **Job** → **Contact** (1:1)
- **Batch** → **EnrichmentBatch** (1:many, `scanBatchId` FK) → **CompanyEnrichment** (1:many)
- **Batch** → **PostcardBatch** (1:many, `scanBatchId` FK) → **Postcard** (1:many)
- **Contact** → **CompanyEnrichment** (1:many, `isLatest` flag + `revisionNumber`)
- **Contact** → **ContactRevision** (1:many, snapshots of contact data per scan)
- **Contact** → **Postcard** (1:many)
- **SystemPrompt** — admin-editable agent/chat/model prompts stored in DB

---

## Environment Variables Required

```
# AWS Bedrock (Claude — used for enrichment + address agent)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION

# OpenAI (used for image generation + fallback model)
OPENAI_API_KEY

# Database (Supabase/PostgreSQL)
SUPABASE_DB_URL
SUPABASE_DB_URL_DIRECT

# External data APIs
BRIGHT_DATA_API_KEY       # LinkedIn scraping
ENDATO_API_NAME
ENDATO_API_PASSWORD
EXA_AI_KEY                # Web search
PROPMIX_ACCESS_TOKEN      # Address verification
GOOGLE_SEARCH_API_KEY

# App URL (used by screenshotPostcard to call image route)
NEXT_PUBLIC_APP_URL       # e.g. https://your-app.vercel.app
# On Vercel, VERCEL_URL is set automatically as fallback

# Debug/admin endpoints (not user-facing)
DEBUG_API_KEY             # wdistt-debug-k9x2mq7p4r — used by /api/admin/reset and /api/debug/status
```

---

## Test Scripts (in `/tests/` — gitignored)

Run with `npm run <script>`:

| Script | What it tests | Needs dev server? |
|---|---|---|
| `test:enrichment` | Enrichment agent on Frank Chang with company="Unknown" | No |
| `test:background` | `generateBackground()` returns valid PNG | No |
| `test:image-route` | `/api/postcards/[id]/image` returns PNG for both templates | **Yes** |
| `test:pipeline` | Full end-to-end: background → DB record → image route → save | **Yes** |

**To run server-dependent tests:**
```bash
# Terminal 1
npm run dev
# Wait for "✓ Ready" message (~15s)

# Terminal 2
npm run test:image-route
npm run test:pipeline
```

**Never run `curl localhost:3000` or equivalent from within a Claude tool call** — it blocks indefinitely.

---

## Known Issues / TODO

- `Postcard.imageUrl` stores base64 data URLs — fine for small scale but will bloat the DB. Future: migrate to Supabase Storage or Vercel Blob.
- `gpt-image-1` images are ~3MB each as base64, which is ~4MB stored in DB. Keep an eye on DB size.
- The `@sparticuz/chromium` package is still in `dependencies` but is no longer used — can be removed once confident in the `next/og` approach.
- The postcard render page at `/postcard-render/[postcardId]` still exists but is now unused (was used by the old Playwright screenshot approach).
- Notes folder: `notes/shane-convo-2026-02-20.md` has product decisions from Shane (postcard template choices, enrichment data requirements).
