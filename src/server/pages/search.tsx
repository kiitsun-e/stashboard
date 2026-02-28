import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { SearchResult } from "../../pipeline/search";

function timeAgo(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  article: "article",
  tweet: "tweet",
  "tweet-article": "tweet article",
  github: "github",
  video: "video",
  pdf: "pdf",
  other: "other",
};

const ResultItem: FC<{ item: SearchResult }> = ({ item }) => {
  const displayTitle = item.title || hostname(item.url);
  const typeLabel = SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType;
  return (
    <article class="card">
      <div class="card-body">
        <h2 class="card-title">
          <a href={item.url} target="_blank" rel="noopener">
            {displayTitle}
          </a>
        </h2>
        <div class="card-origin">
          <span class="card-host">{hostname(item.url)}</span>
          <span class="card-sep">&middot;</span>
          <span class="card-time">{timeAgo(item.savedAt)}</span>
          <span class="card-sep">&middot;</span>
          <span class="card-type">{typeLabel}</span>
          {item.similarity !== undefined && (
            <>
              <span class="card-sep">&middot;</span>
              <span class="card-similarity">
                {(item.similarity * 100).toFixed(0)}%
              </span>
            </>
          )}
          {item.status !== "processed" && (
            <span class="card-status" data-status={item.status}>
              {item.status}
            </span>
          )}
        </div>
        {item.userNote && <div class="card-note">"{item.userNote}"</div>}
        {item.summary && <p class="card-summary">{item.summary}</p>}
      </div>
      {item.tags.length > 0 && (
        <div class="card-footer">
          <div class="card-tags">
            {item.tags.map((tag) => (
              <span class="tag">{tag}</span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
};

export const SearchPage: FC<{
  query?: string;
  results?: SearchResult[];
}> = ({ query, results }) => {
  const hasQuery = query && query.trim().length > 0;
  return (
    <Layout title={hasQuery ? `"${query}"` : "Search"} activePage="search">
      <section class="search-section">
        <form class="search-form" method="get" action="/">
          <input
            class="search-input"
            type="text"
            name="q"
            placeholder="What are you looking for?"
            value={query || ""}
            autofocus
          />
        </form>
        {!hasQuery && (
          <p class="search-hint">
            Semantic search — describe what you're looking for in natural
            language
          </p>
        )}
      </section>

      <section class="save-section" id="save-section">
        <button class="save-toggle" onclick="document.getElementById('save-form').toggleAttribute('hidden')" type="button">
          + Save a URL
        </button>
        <form class="save-form" id="save-form" hidden onsubmit="handleSave(event)">
          <input type="url" name="url" placeholder="https://..." required />
          <textarea name="note" placeholder="Why are you saving this? (optional)" rows={2} />
          <button class="save-btn" type="submit">Save</button>
          <div class="save-feedback" id="save-feedback" />
        </form>
      </section>

      {hasQuery && results && (
        <div>
          <div class="results-header">
            <span class="results-count">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          </div>
          {results.length > 0 ? (
            <div class="results-list">
              {results.map((item) => (
                <ResultItem item={item} />
              ))}
            </div>
          ) : (
            <div class="empty-state">
              Nothing matched <strong>"{query}"</strong>. Try rephrasing — semantic
              search works best with natural language descriptions.
            </div>
          )}
        </div>
      )}

      {!hasQuery && (
        <div class="empty-state">
          Your personal knowledge archive. Save URLs, search by concept.
        </div>
      )}

      <script dangerouslySetInnerHTML={{ __html: `
        async function handleSave(e) {
          e.preventDefault();
          const form = e.target;
          const btn = form.querySelector('.save-btn');
          const fb = document.getElementById('save-feedback');
          const url = form.url.value.trim();
          if (!url) return;

          btn.disabled = true;
          btn.textContent = 'Saving...';
          fb.textContent = '';
          fb.className = 'save-feedback';

          try {
            const res = await fetch('/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, note: form.note.value.trim() || undefined })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');

            fb.textContent = data.existing ? 'Already saved.' : 'Saved — processing in background.';
            fb.className = 'save-feedback success';
            if (!data.existing) {
              form.url.value = '';
              form.note.value = '';
            }
          } catch (err) {
            fb.textContent = err.message;
            fb.className = 'save-feedback error';
          } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
          }
        }
      `}} />
    </Layout>
  );
};
