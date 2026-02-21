# CLAUDE.md — Project Memory
<!-- Always update this file after any changes! Write new entries at the TOP of each section. -->

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

### Enrichment Flow
1. Contact created by address-lookup agent (may or may not have `company` field populated)
2. `POST /api/contacts/enrich-bulk` or `POST /api/contacts/[id]/enrich` — creates `CompanyEnrichment` record (status=`enriching`), fire-and-forgets `runEnrichmentAgent()`
3. `runEnrichmentAgent()` in `src/agent/enrichment-agent.ts` — uses AWS Bedrock (Claude) to discover: company name, website, logo, open roles, values, mission, office locations, team photos
4. Updates `CompanyEnrichment` record to status=`completed` or `failed` with `errorMessage`

### Postcard Generation Flow
1. `POST /api/postcards/generate` (single) or `POST /api/postcards/generate-bulk`
2. Creates `Postcard` record (status=`pending`), fire-and-forgets:
   - `generateBackground(prompt)` → base64 PNG → stored as `data:image/png;base64,...` in `Postcard.backgroundUrl`
   - Status → `generating`
   - `screenshotPostcard(postcardId)` → fetches `GET /api/postcards/[id]/image` → base64 PNG → stored in `Postcard.imageUrl`
   - Status → `ready`
3. On any error: status → `failed`, error written to `Postcard.errorMessage`

### Image Rendering (`next/og`)
- `src/app/api/postcards/[id]/image/route.tsx` — uses `ImageResponse` from `next/og`
- Renders `WarRoomPostcard` or `ZoomRoomPostcard` React component at 1536×1024
- Reads postcard data directly from DB (Prisma)
- **Must be `.tsx`** (not `.ts`) — contains JSX
- No auth required (used internally by screenshot function)
- Works on Vercel Edge/Serverless with zero binary dependencies

### Templates
- **War Room** (default): vintage map + city pins + hiring panel + contact photo. Used when contact has an office address.
- **Zoom Room**: simulated Zoom meeting UI. Used when contact is fully remote (no office address, or `fully_remote` flag).

---

## Key Files

| File | Purpose |
|---|---|
| `src/agent/enrichment-agent.ts` | Company enrichment agent (Bedrock/Claude) |
| `src/agent/agent-streaming.ts` | Address lookup agent with streaming |
| `src/lib/postcard/background-generator.ts` | Generates AI background image (gpt-image-1 → dall-e-3 fallback) |
| `src/lib/postcard/screenshot.ts` | Fetches image route, returns base64 |
| `src/lib/postcard/prompt-generator.ts` | War room / zoom room prompts |
| `src/app/api/postcards/[id]/image/route.tsx` | **MUST BE .tsx** — next/og ImageResponse |
| `src/app/api/postcards/generate/route.ts` | Single postcard generation |
| `src/app/api/postcards/generate-bulk/route.ts` | Bulk postcard generation |
| `src/app/api/contacts/[id]/enrich/route.ts` | Single contact enrichment |
| `src/app/api/contacts/enrich-bulk/route.ts` | Bulk contact enrichment |
| `prisma/schema.prisma` | DB schema (Contact, CompanyEnrichment, Postcard, Job, Batch) |

---

## Environment Variables Required

```
# AWS Bedrock (Claude — used for enrichment + address agent)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION

# OpenAI (used for image generation)
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
