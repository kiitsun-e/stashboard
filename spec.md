# Stashboard — Personal Read-Later with Semantic Search

## Problem

Saving interesting content (blog posts, X posts, articles) while browsing on mobile or desktop currently means sending links to yourself on WhatsApp. This works for capture but fails at retrieval:

- No context about *why* something was saved
- No way to search by topic or concept
- Content is buried in a chat timeline with no organization
- Links rot — the content behind the URL may disappear

## Solution

A personal API-first tool that:

1. **Captures URLs** from mobile (Android share sheet) or desktop (web app / CLI) with minimal friction
2. **Automatically extracts and archives** the full content behind each URL
3. **Generates context** — summary, tags, key concepts — via Claude Haiku API calls (~$0.001/article)
4. **Enables semantic search** — find saved items by concept, not just keyword
5. **Provides a web interface** for browsing, searching, and reading saved content

Your data lives in your own database. Summarization uses Anthropic's Haiku API. No third-party analytics, no accounts, no tracking.

## Architecture

```
Mobile (HTTP Shortcuts app)  ─┐
Desktop (Web app / CLI)       ─┤──▶  Hono API  ──▶  SQLite (bun:sqlite / Turso)
                               │        │
                               │        ▼
                               │   Save Pipeline:
                               │   1. Validate URL (SSRF protection)
                               │   2. Fetch & extract content (readability)
                               │   3. Summarize & tag (Claude Haiku)
                               │   4. Generate embeddings (local model)
                               │   5. Store everything
```

### Components

**API Server** — Hono running on Bun. Handles all business logic. Runs locally for development, deployed to Railway for production.

**Database** — SQLite via Bun's built-in `bun:sqlite` + Drizzle ORM for local development. Embeddings stored as JSON text, cosine similarity computed in JS. For deployment, can upgrade to Turso (hosted libSQL) with native `vector_top_k` for indexed vector search — but brute-force cosine in JS is instant at personal scale (hundreds/low thousands of items).

**Content Extraction** — Mozilla Readability (via `@mozilla/readability` + `linkedom`) for articles and blogs. X/Twitter posts are best-effort — X aggressively blocks scraping, so tweet saves degrade gracefully to storing the URL + user-provided note without full content extraction. This is acceptable because the user's note ("why I saved this") carries most of the retrieval value anyway.

**Summarization & Tagging** — Claude Haiku via Anthropic API. Generates a 2-3 sentence summary and 3-5 topic tags per saved item. Cost is negligible (~$0.001/article). Runs as a fire-and-forget async function after the API responds, so the user isn't waiting.

**Embeddings** — Local embedding model (all-MiniLM-L6-v2, 384 dimensions). Embeds a concatenation of: user note + generated summary + title. Full article content is *not* embedded — it's too long and dilutes signal. Full content is stored for reading/display, not for vector search.

**Web Frontend** — Server-rendered HTML from Hono. Search bar, tag filters, list of saved items with summaries. Each result links out to the original URL as the primary action — the goal is to get you back to the original content, not to recreate it. An "archived copy" link provides the extracted markdown as a fallback when the original is dead. No frontend framework needed for a personal tool with a search box and a list.

**CLI** — Direct database access for local development and testing. Also works as a quick save/search tool from the terminal.

## Data Model

### `items` table

| Column         | Type     | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| id             | text     | ULID primary key                                 |
| url            | text     | Original URL (unique)                            |
| title          | text     | Extracted page title                             |
| content        | text     | Full extracted content (markdown, max 500KB)     |
| user_note      | text     | Optional note provided at save time              |
| summary        | text     | LLM-generated summary                            |
| source_type    | text     | "article" / "tweet" / "video" / "pdf" / "other"  |
| saved_at       | integer  | Unix timestamp of when the item was saved        |
| processed_at   | integer  | Unix timestamp of when extraction/summary ran    |
| status         | text     | "pending" / "processed" / "failed"               |
| error          | text     | Error message when status is "failed" (nullable) |

Raw HTML is stored as files on disk at `data/archive/{id}.html`, not in the database, to avoid bloating SQLite. Only the extracted markdown content lives in the DB.

**Duplicate handling:** Saving an existing URL is idempotent — returns the existing item with its current status. No error, no duplicate row.

**Content size limit:** Extracted content is capped at 500KB. Anything larger is truncated with a note appended. Raw HTML archives are capped at 2MB; pages exceeding this are archived without raw HTML.

### `tags` table

| Column   | Type | Description          |
| -------- | ---- | -------------------- |
| id       | text | ULID primary key     |
| name     | text | Tag name (unique)    |

### `item_tags` table

| Column  | Type | Description                        |
| ------- | ---- | ---------------------------------- |
| item_id | text | FK → items (ON DELETE CASCADE)     |
| tag_id  | text | FK → tags (ON DELETE CASCADE)      |

### Embeddings

Embeddings are stored as a `text` column on the `items` table containing a JSON array of 384 floats (MiniLM dimensions).

| Column    | Type | Description                                         |
| --------- | ---- | --------------------------------------------------- |
| embedding | text | JSON array of 384 floats from all-MiniLM-L6-v2      |

Semantic search loads all processed embeddings into memory and computes cosine similarity in JS. This is O(n) but fast enough for personal scale — a few thousand items process in single-digit milliseconds.

**Turso upgrade path:** When deploying to Turso, the embedding column can be migrated to `F32_BLOB(384)` with a `libsql_vector_idx` index, and search can use `vector_top_k()` for indexed ANN search. This is a deployment optimization, not a functional change.

## API Endpoints

### `POST /save`

Save a new URL. Returns immediately; processing happens async.

If the URL already exists, returns the existing item (idempotent).

**Request:**
```json
{
  "url": "https://example.com/interesting-post",
  "note": "Great explanation of CRDTs"
}
```

**Response:**
```json
{
  "id": "01HXZ...",
  "status": "pending",
  "existing": false
}
```

### `GET /search?q=<query>`

Semantic search across all saved items.

**Query params:**
- `q` — natural language query (required)
- `limit` — max results (default 20)
- `tag` — filter by tag name (optional)

**Response:**
```json
{
  "results": [
    {
      "id": "01HXZ...",
      "url": "https://...",
      "title": "Understanding CRDTs",
      "summary": "Explains why CRDTs are preferable to OT for...",
      "tags": ["distributed-systems", "crdt"],
      "user_note": "Great explanation of CRDTs",
      "similarity": 0.87,
      "saved_at": 1709000000
    }
  ]
}
```

### `GET /library`

Browse all saved items with filtering.

**Query params:**
- `tag` — filter by tag (optional)
- `source_type` — filter by type (optional)
- `status` — filter by processing status (optional)
- `cursor` — ULID of the last item from the previous page. Since ULIDs are time-ordered, this provides stable pagination ordered by `saved_at` descending.
- `limit` — max results (default 50)

**Response:** Same shape as search results, ordered by `saved_at` descending.

### `GET /items/:id`

Full item detail including extracted content and original URL.

The primary action on any item is **"Open Original"** — a direct link to the original URL in the user's browser. The extracted markdown content is a secondary view, serving as an archive for when the original link dies. The web UI and CLI both treat "open original" as the default read action.

### `DELETE /items/:id`

Remove a saved item, its tag associations (via CASCADE), its embedding, and its archived HTML file.

### `PATCH /items/:id`

Update user note or manually add/remove tags.

**Request:**
```json
{
  "note": "Updated note",
  "add_tags": ["new-tag"],
  "remove_tags": ["old-tag"]
}
```

### `POST /process`

Manually trigger processing of pending/failed items. Useful for retries.

**Query params:**
- `id` — process a specific item (optional; if omitted, processes all pending/failed items)

## Save Flow (detailed)

1. User shares a URL (via Android share sheet / web app / CLI)
2. `POST /save` accepts the URL + optional note
3. URL is validated (see Security section). If invalid, return 400.
4. Check for existing item with same URL. If found, return existing item.
5. Write a row with `status: "pending"`, return the ID immediately
6. Fire-and-forget async function processes the item:
   a. Fetch the URL HTML (with timeout, size limit, redirect limit)
   b. Detect source type (tweet, article, etc.)
   c. Extract content via Readability (articles) or degrade gracefully (tweets, other)
   d. Write raw HTML to `data/archive/{id}.html` (if under 2MB)
   e. Send extracted text to Claude Haiku for summary + tags
   f. Generate embedding from: user note + summary + title
   g. Store summary, tags, embedding; set `status: "processed"`
7. If any step fails, set `status: "failed"` and store the error message in the `error` column
8. Failed items can be retried via `POST /process?id=<id>` or `POST /process` (retries all failed)

## Security

### SSRF Protection

The save pipeline fetches arbitrary user-provided URLs server-side. To prevent SSRF:

- **Block private IP ranges** — reject URLs that resolve to `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `127.x.x.x`, `169.254.x.x`, `::1`, `fc00::/7`
- **Protocol restriction** — only allow `http://` and `https://` schemes
- **Redirect limit** — follow max 3 redirects; re-validate each redirect target against the private IP blocklist
- **Response size limit** — abort fetch if response body exceeds 5MB
- **Timeout** — 15 second timeout on all fetches

### Auth

Simple bearer token auth. Single-user tool — no user accounts. A shared secret set via `STASHBOARD_TOKEN` environment variable, sent as `Authorization: Bearer <token>` from all clients. Railway provides HTTPS by default.

## Mobile Setup (Android — HTTP Shortcuts)

HTTP Shortcuts is a free, open-source Android app that registers as a share target.

Configuration:
- **Name:** "Save to Stashboard"
- **Method:** POST
- **URL:** `https://<your-api>.railway.app/save`
- **Headers:** `Authorization: Bearer <token>`
- **Body:** `{"url": "{url}", "note": "{input}"}`
- **Input prompt:** "Why are you saving this?" (dismissable)

Once configured, "Save to Stashboard" appears in the Android share menu alongside WhatsApp, Messages, etc.

## CLI Usage

The CLI operates directly against the local database for development, or against the API for production use.

```bash
# Save a URL
stash save https://example.com/post
stash save https://example.com/post --note "Good intro to embeddings"

# Search
stash search "that article about database indexing"

# Browse
stash list
stash list --tag distributed-systems

# Open original URL in browser
stash open <id>

# View extracted content (archive/fallback)
stash read <id>

# Retry failed items
stash retry
stash retry <id>
```

## Deployment

- **Server:** Railway (Hono API)
- **Database:** SQLite on Railway persistent volume (or Turso for managed hosting + native vector search)
- **HTML Archive:** Files on Railway persistent volume at `data/archive/`
- **Domain:** Custom domain or Railway-provided URL

## Non-Goals (v1)

- Native mobile app — the share sheet + web app covers it
- Multi-user / sharing — this is a personal tool
- Offline mobile reading — v1 assumes connectivity
- Browser extension — web app paste-a-URL is sufficient for desktop
- Read/unread tracking — not a reading queue, it's a knowledge archive
- Full-text content search — semantic search on summaries is the primary interface; full-text can come later
- Export — useful for portability but not v1
- Content refresh / dead link detection — nice to have, not essential

## Build Phases

### Phase 1: CLI + Core Pipeline (local) ✓

Completed. Fully working local CLI tool:
- Data model + Drizzle schema + bun:sqlite setup
- Save pipeline: SSRF-safe fetch → Readability extraction → Haiku summarization/tagging → MiniLM embedding → SQLite storage
- Semantic search via cosine similarity in JS
- CLI commands: `save`, `search`, `list`, `open`, `read`, `retry`
- Idempotent saves, graceful tweet degradation, content size limits
- Raw HTML archived to disk, extracted markdown in DB

### Phase 2: API Server

Wrap the core in Hono endpoints:
- All API endpoints listed above
- Bearer token auth middleware
- Fire-and-forget async processing
- Deploy to Railway

### Phase 3: Web Frontend + Mobile

- Server-rendered HTML pages from Hono (search, library, item detail)
- Paste-a-URL save form for desktop
- Configure HTTP Shortcuts on Android for mobile share sheet

## Open Questions

1. **Embedding model choice** — MiniLM is the safe default (384d, fast, well-understood). Nomic Embed or BGE-small may perform better for retrieval. Worth benchmarking after Phase 1 with real saved content.
2. **Content refresh** — should the tool periodically re-fetch URLs to detect dead links? Deferred past v1.
3. **Export** — JSON or markdown export for portability. Deferred past v1.
