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
  "long-tweet": "long tweet",
  "tweet-article": "tweet article",
  github: "github",
  video: "video",
  pdf: "pdf",
  other: "other",
};

const LibraryItem: FC<{ item: SearchResult }> = ({ item }) => {
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
          {item.status !== "processed" && (
            <span class="card-status" data-status={item.status}>
              {item.status}
            </span>
          )}
        </div>
        {item.userNote && <div class="card-note">"{item.userNote}"</div>}
        {item.summary && <p class="card-summary">{item.summary}</p>}
      </div>
      <div class="card-footer">
        {item.tags.length > 0 && (
          <div class="card-tags">
            {item.tags.map((tag) => (
              <a class="tag" href={`/library?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </a>
            ))}
          </div>
        )}
        <div class="card-actions">
          <button
            class="card-delete-btn"
            type="button"
            data-item-id={item.id}
            onclick="handleDelete(this)"
          >
            delete
          </button>
          <a class="card-detail-link" href={`/items/${item.id}`}>details &rarr;</a>
        </div>
      </div>
    </article>
  );
};

export const LibraryPage: FC<{
  results: SearchResult[];
  activeTag?: string;
  activeStatus?: string;
  activeSourceType?: string;
  allTags: string[];
  nextCursor?: string;
}> = ({ results, activeTag, activeStatus, activeSourceType, allTags, nextCursor }) => {
  return (
    <Layout title="Library" activePage="library">
      {/* Filters */}
      <section class="library-filters">
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Tags</span>
            <div class="filter-options">
              <a
                class={`filter-option ${!activeTag ? "active" : ""}`}
                href="/library"
              >
                All
              </a>
              {allTags.map((tag) => (
                <a
                  class={`filter-option ${activeTag === tag ? "active" : ""}`}
                  href={`/library?tag=${encodeURIComponent(tag)}${activeStatus ? `&status=${activeStatus}` : ""}${activeSourceType ? `&source_type=${activeSourceType}` : ""}`}
                >
                  {tag}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Type</span>
            <div class="filter-options">
              {[
                { value: "", label: "All" },
                { value: "article", label: "Article" },
                { value: "tweet", label: "Tweet" },
                { value: "long-tweet", label: "Long tweet" },
                { value: "tweet-article", label: "Tweet article" },
                { value: "github", label: "GitHub" },
                { value: "video", label: "Video" },
                { value: "pdf", label: "PDF" },
              ].map(({ value, label }) => (
                <a
                  class={`filter-option ${(activeSourceType || "") === value ? "active" : ""}`}
                  href={`/library?${activeTag ? `tag=${encodeURIComponent(activeTag)}&` : ""}${activeStatus ? `status=${activeStatus}&` : ""}${value ? `source_type=${value}` : ""}`}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Status</span>
            <div class="filter-options">
              {["", "pending", "processed", "failed"].map((s) => (
                <a
                  class={`filter-option ${(activeStatus || "") === s ? "active" : ""}`}
                  href={`/library?${activeTag ? `tag=${encodeURIComponent(activeTag)}&` : ""}${s ? `status=${s}&` : ""}${activeSourceType ? `source_type=${activeSourceType}` : ""}`}
                >
                  {s || "All"}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <div class="results-header">
        <span class="results-count">
          {results.length} item{results.length !== 1 ? "s" : ""}
          {activeTag && <> tagged <strong>{activeTag}</strong></>}
        </span>
      </div>

      {results.length > 0 ? (
        <div class="results-list">
          {results.map((item) => (
            <LibraryItem item={item} />
          ))}
        </div>
      ) : (
        <div class="empty-state">
          No items{activeTag ? <> tagged <strong>{activeTag}</strong></> : ""}.
          {" "}Save some URLs from the <a href="/">search page</a>.
        </div>
      )}

      {nextCursor && (
        <div class="pagination">
          <a
            class="load-more"
            href={`/library?cursor=${nextCursor}${activeTag ? `&tag=${encodeURIComponent(activeTag)}` : ""}${activeStatus ? `&status=${activeStatus}` : ""}${activeSourceType ? `&source_type=${activeSourceType}` : ""}`}
          >
            Load more
          </a>
        </div>
      )}
    </Layout>
  );
};
