# Stashboard

Personal read-later tool with semantic search. Hono API + bun:sqlite + Drizzle ORM.

## Stack
- Runtime: Bun
- Server: Hono (API + server-rendered HTML via JSX)
- Database: SQLite via bun:sqlite + Drizzle ORM
- Frontend: Hono JSX templates + vanilla CSS + minimal vanilla JS
- No frontend framework. No build step. No bundler.

## Project Structure
- `src/server/` — Hono server, API routes, and web page routes
- `src/pipeline/` — save, extract, summarize, embed, search
- `src/db/` — Drizzle schema and database setup
- `src/cli/` — CLI commands
- `data/archive/` — raw HTML archives on disk

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs.
In frontend design, this creates what users call the "AI slop"
aesthetic. Avoid this: make creative, distinctive frontends
that surprise and delight.

Focus on:
- Typography: Use the specified font pairing below. Never substitute generic fonts.
- Color & Theme: Follow the design system variables exactly. Support both dark and light mode via CSS custom properties on `[data-theme]`.
- Motion: Subtle, purposeful transitions. Page loads should feel snappy, not animated. Hover states should respond in 120-150ms. No gratuitous animation.
- Backgrounds: Use the surface/background hierarchy defined below. No pure white, no gray-100.
- Layout: Dense, information-forward. Every pixel earns its place. Reference Are.na's quiet density and Pinboard's radical simplicity.

Interpret creatively within these constraints but never override the design system.
</frontend_aesthetics>

## Design System

### References
- **Are.na** — quiet density, muted palette, typographic hierarchy, unhurried feel
- **Pinboard** — radical information density, zero decoration, content-first
- **Notion** — clean structure, subtle borders, light/dark mode done well, comfortable reading

### Fonts
- Headings: **Instrument Serif** (distinctive, warm, editorial — Google Fonts)
- Body/UI: **Geist Sans** (clean, technical, excellent readability — Vercel's open font)
- Monospace (URLs, IDs): **Geist Mono**

### Palette
CSS custom properties on `[data-theme="dark"]` and `[data-theme="light"]`.

**Dark mode (default):**
- `--bg`: #0A0A0B (near-black, warm undertone)
- `--surface`: #141416 (cards, panels)
- `--surface-raised`: #1C1C1F (hover states, elevated elements)
- `--border`: #2A2A2E (subtle dividers)
- `--text-primary`: #EDEDEF (high contrast body text)
- `--text-secondary`: #8B8B8E (muted labels, metadata)
- `--text-tertiary`: #5A5A5D (timestamps, hints)
- `--accent`: #C9A87C (warm gold — for links, active states, focus rings)
- `--accent-muted`: #C9A87C26 (accent at 15% opacity — tag backgrounds, subtle highlights)
- `--status-pending`: #D4A843
- `--status-processed`: #5BA88C
- `--status-failed`: #C75D5D

**Light mode:**
- `--bg`: #FAFAF9 (warm off-white)
- `--surface`: #FFFFFF
- `--surface-raised`: #F2F2F0
- `--border`: #E2E2DF
- `--text-primary`: #1A1A1B
- `--text-secondary`: #6B6B6E
- `--text-tertiary`: #9B9B9E
- `--accent`: #8B6914 (darker gold for contrast on light)
- `--accent-muted`: #8B691414
- `--status-pending`: #9B7B1A
- `--status-processed`: #2D7A5A
- `--status-failed`: #B84444

### Spacing
4px base, multiples of 4. Use `--space-1` through `--space-8`:
- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 24px
- `--space-6`: 32px
- `--space-7`: 48px
- `--space-8`: 64px

### Border radius
- `--radius-sm`: 3px (tags, small elements)
- `--radius-md`: 6px (cards, inputs)
- `--radius-lg`: 10px (modals, larger containers)

Subtle. Not bubbly.

### Shadows
Use sparingly. Only for truly elevated elements (dropdowns, modals).
- `--shadow-sm`: 0 1px 3px rgba(0,0,0,0.08)
- `--shadow-md`: 0 4px 12px rgba(0,0,0,0.12)

## Design Anti-Patterns (NEVER use these)
- Inter, Roboto, Open Sans, system-ui as primary font
- Purple/indigo as accent colour
- Hero section with centred text -> 3 feature cards -> CTA
- Generic SVG icons from Lucide/Heroicons without customisation
- Uniform large border-radius on everything (no pill shapes)
- Gray-100 / #F9FAFB backgrounds
- "Get Started" or "Learn More" as CTA text
- Centered layouts for content that should be left-aligned
- Card grids with equal-height boxes for list content
- Loading spinners without context (use skeleton states or status text)
- SaaS marketing patterns — this is a utility tool, not a product landing page

## Web Frontend Guidelines
- All pages are server-rendered Hono JSX. No client-side framework.
- One CSS file (`src/server/public/styles.css`) with all design tokens and styles.
- Minimal vanilla JS only where needed (save form async submit, theme toggle, search debounce).
- Pages: search (primary), library (browse), item detail (read), save form (inline on search page).
- Mobile responsive via CSS. No separate mobile templates.
- "Open Original" is always the primary action on any item. Archived content is secondary.
