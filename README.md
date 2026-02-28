# Stashboard

Personal read-later tool with semantic search. Save URLs from your phone's share sheet or the CLI, and Stashboard extracts the content, summarizes it with Claude, generates embeddings, and makes everything searchable through a fast web UI.

Built with Bun, Hono, SQLite, and fastembed. No frontend framework, no build step.

## How it works

```
URL → Extract → Summarize (Haiku) → Embed (AllMiniLM) → Search
```

1. **Save** a URL via API, CLI, or phone share sheet
2. **Extract** content — specialized extractors for articles, tweets, YouTube transcripts, PDFs, GitHub repos
3. **Summarize** — Claude Haiku generates a 2-3 sentence summary + topic tags
4. **Embed** — AllMiniLM-L6-v2 generates a 384-dim vector from title + summary + note
5. **Search** — cosine similarity over all embeddings, filtered by tag/type

Processing is fire-and-forget: the API returns immediately, pipeline runs in background.

## What it extracts

| Source | How | Auth needed |
|--------|-----|-------------|
| Articles | [Readability](https://github.com/mozilla/readability) + meta/JSON-LD fallback | No |
| Tweets/X posts | [@steipete/bird](https://github.com/nicklama/bird) (X internal API) | `AUTH_TOKEN` + `CT0` cookies |
| YouTube | Transcript via web scraping (no API key) | No |
| PDFs | [@steipete/summarize](https://github.com/nicklama/summarize) CLI → markitdown | No |
| GitHub | Readability extraction | No |

Tweet extraction degrades gracefully — if tokens aren't set, you get the URL and user note only.

## Setup

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- An [Anthropic API key](https://console.anthropic.com/) for summarization

### Install and run

```bash
git clone https://github.com/yourusername/stashboard.git
cd stashboard
bun install
```

Create a `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-...       # Required — Claude Haiku for summaries

# Optional — tweet extraction
AUTH_TOKEN=...                      # x.com auth_token cookie
CT0=...                             # x.com ct0 cookie

# Optional — access control
STASHBOARD_TOKEN=your-secret        # Protects API + web UI (open if unset)
```

Start the server:

```bash
bun run dev     # Development (auto-reload)
bun run start   # Production
```

Stashboard runs on `http://localhost:3000`.

### Getting X/Twitter tokens

To extract tweet content (not just URLs), you need two cookies from x.com:

1. Open x.com in your browser, sign in
2. DevTools → Application → Cookies → `https://x.com`
3. Copy `auth_token` → set as `AUTH_TOKEN`
4. Copy `ct0` → set as `CT0`

These rotate periodically. If tweet extraction stops working, grab fresh values.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude Haiku API calls for summaries |
| `STASHBOARD_TOKEN` | No | — | Single shared token for API + web auth. If unset, everything is open. |
| `AUTH_TOKEN` | No | — | X/Twitter `auth_token` cookie for tweet extraction |
| `CT0` | No | — | X/Twitter `ct0` cookie (paired with `AUTH_TOKEN`) |
| `PORT` | No | `3000` | Server listen port |
| `STASHBOARD_DB` | No | `data/stashboard.db` | SQLite database path |
| `STASHBOARD_ARCHIVE_DIR` | No | `data/archive` | Raw HTML archive directory |
| `FASTEMBED_CACHE_DIR` | No | `local_cache` | Embedding model cache (~120MB on first run) |

## CLI

```bash
bun run stash save <url> [--note "why this matters"]
bun run stash search <query>
bun run stash list [--tag <tag>] [--type <sourceType>] [--status <status>]
bun run stash open <id>           # Opens original URL in browser
bun run stash read <id>           # Print extracted content
bun run stash retry [id]          # Reprocess failed/pending items
```

## API

All endpoints require `Authorization: Bearer <STASHBOARD_TOKEN>` when the token is set. The web UI uses a cookie (`stashboard_auth`) which the API also accepts.

### `POST /api/save`

```json
{ "url": "https://example.com/article", "note": "optional context" }
```

Returns `201` with `{ id, status: "pending" }`. Processing happens async.

### `GET /api/search?q=<query>&tag=<tag>&limit=20`

Returns `{ results: [{ id, url, title, summary, tags, similarity, ... }] }`.

### `GET /api/library?tag=&source_type=&status=&cursor=&limit=50`

Browse all items. Cursor-based pagination using ULIDs.

### `GET /api/items/:id`

Full item detail with tags.

### `DELETE /api/items/:id`

Deletes item + archived HTML.

### `PATCH /api/items/:id`

```json
{ "note": "updated note", "add_tags": ["new-tag"], "remove_tags": ["old-tag"] }
```

### `POST /api/process?id=<optional>`

Reprocess pending/failed items (or a specific item by ID).

## Web UI

Server-rendered pages via Hono JSX. No client-side framework.

- **/** — Search with semantic results
- **/library** — Browse all items with tag/type/status filters
- **/items/:id** — Item detail with summary, extracted content, and original link
- **/login** — Password entry (only shown when `STASHBOARD_TOKEN` is set)

Authentication uses a cookie set at login. The cookie is HttpOnly, Secure, SameSite=Strict, with a 30-day expiry.

## Phone setup (Android share sheet)

Use [HTTP Shortcuts](https://play.google.com/store/apps/details?id=ch.rmy.android.http_shortcuts) (free, open source) to add "Save to Stashboard" to your Android share menu.

### Setup steps

1. Install HTTP Shortcuts from Play Store
2. Create a new **Regular Shortcut**:
   - **Name:** `Save to Stashboard`
   - **Method:** `POST`
   - **URL:** `https://your-stashboard-url.com/api/save`
3. **Headers:**
   - `Content-Type` → `application/json`
   - `Authorization` → `Bearer <your STASHBOARD_TOKEN>`
4. **Request body** (Custom Text / JSON):
   ```json
   {"url": "{url}"}
   ```
5. **Create the `url` variable** (this is the key step):
   - Go to **Variables** from the main HTTP Shortcuts screen
   - Create variable named `url`, type: **"Text (shared from other apps)"**
   - Enable **"Allow Receiving Value from Share Dialogue"**
6. **Important:** In the request body editor, don't hand-type `{url}`. Delete it, position cursor between the quotes, then tap the **`{ }`** button and select the `url` variable. The app needs the proper variable reference.
7. Enable "Share into this shortcut" in the shortcut settings

### Optional: add a note prompt

Create a second variable named `input` (type: Text Input, dialog: "Why are you saving this?", not required) and change the body to:

```json
{"url": "{url}", "note": "{input}"}
```

### Troubleshooting

- Shortcut not in share sheet? Force-close HTTP Shortcuts and reopen. Android caches share targets.
- Still missing? Restart your phone. The share sheet is slow to update.

## Deploy to Railway

Stashboard is configured for [Railway](https://railway.app) with Railpack (auto-detects Bun).

### 1. Create project and link

```bash
railway login
railway init        # or railway link (if project exists)
```

### 2. Add a persistent volume

Without a volume, the SQLite database, HTML archives, and embedding model cache are wiped on every deploy.

```bash
railway volume add --mount-path /data
```

### 3. Set environment variables

```bash
railway variables --set \
  "ANTHROPIC_API_KEY=sk-ant-..." \
  "STASHBOARD_TOKEN=your-secret" \
  "STASHBOARD_DB=/data/stashboard.db" \
  "STASHBOARD_ARCHIVE_DIR=/data/archive" \
  "FASTEMBED_CACHE_DIR=/data/model-cache" \
  "RAILWAY_RUN_UID=0" \
  --skip-deploys
```

Optionally add `AUTH_TOKEN` and `CT0` for tweet extraction.

`RAILWAY_RUN_UID=0` avoids permission issues writing to the volume.

### 4. Deploy

```bash
railway up
```

The config files handle the rest:

- `railway.toml` — build with Railpack, start with `bun run start`, healthcheck on `/`
- `railpack.json` — installs system packages: `python3`, `python3-pip` (for `uv`/PDF extraction), `poppler-utils` (`pdftotext`), `ca-certificates`, `curl`
- `preDeployCommand` installs `uv` via pip3 so the `summarize` CLI can use `markitdown` for PDFs

### What works without extra system deps

- Article extraction (pure JS: Readability + linkedom)
- YouTube transcripts (web-based captions API)
- Embeddings (ONNX runtime, works on Railway's Ubuntu base)
- Summarization (Anthropic API)

### What needs the system packages

- PDF extraction (`python3` + `uv` → `markitdown`, `poppler-utils` → `pdftotext` fallback)

## Project structure

```
src/
├── server/
│   ├── index.ts          # Hono app, auth middleware
│   ├── routes.ts         # API endpoints
│   ├── web.tsx           # Web page routes + login
│   └── pages/            # JSX page components
│       ├── layout.tsx
│       ├── search.tsx
│       ├── library.tsx
│       ├── item.tsx
│       └── login.tsx
├── pipeline/
│   ├── save.ts           # Orchestrates extract → summarize → embed
│   ├── extract.ts        # Content extraction (articles, tweets, videos, PDFs)
│   ├── summarize.ts      # Claude Haiku summaries + content formatting
│   ├── embed.ts          # AllMiniLM-L6-v2 embeddings via fastembed
│   ├── search.ts         # Cosine similarity search + listing
│   └── ssrf.ts           # DNS validation for safe fetching
├── db/
│   ├── schema.ts         # Drizzle schema (items, tags, item_tags)
│   └── index.ts          # SQLite connection + migrations
└── cli/
    └── index.ts          # CLI commands
```

## Security notes

- SSRF protection: DNS validation blocks fetches to private/internal IPs
- Content sanitized with `sanitize-html` before rendering
- Auth cookie is HttpOnly + Secure + SameSite=Strict
- HTML archives stored on disk, not served directly
- Response size capped at 5MB, content capped at 500KB

## License

MIT
