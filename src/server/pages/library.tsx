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

const LibraryItem: FC<{ item: SearchResult }> = ({ item }) => {
  const displayTitle = item.title || hostname(item.url);
  const typeLabel = SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType;
  return (
    <article class={`card${item.read ? " is-read" : ""}${item.pinned ? " is-pinned" : ""}`} data-item-id={item.id}>
      <div class="card-body">
        <h2 class="card-title">
          {!item.read && <span class="unread-dot" />}
          <a href={item.url} target="_blank" rel="noopener" data-item-id={item.id} onclick="markReadFromCard(this)">
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
        {item.tags.length > 0 && (() => {
          const limit = 4;
          const visible = item.tags.slice(0, limit);
          const overflow = item.tags.slice(limit);
          return (
            <div class="card-tags">
              {visible.map((tag) => (
                <a class="tag" href={`/library?tag=${encodeURIComponent(tag)}`}>
                  {tag}
                </a>
              ))}
              {overflow.length > 0 && (
                <span class="card-tags-overflow">
                  <span class="card-tags-fade">
                    {overflow.slice(0, 2).map((tag) => (
                      <a class="tag" href={`/library?tag=${encodeURIComponent(tag)}`}>
                        {tag}
                      </a>
                    ))}
                  </span>
                  <span class="card-tags-more">+{overflow.length}</span>
                </span>
              )}
            </div>
          );
        })()}
        <div class="card-actions">
          <button
            class={`card-pin-btn${item.pinned ? " is-active" : ""}`}
            type="button"
            data-item-id={item.id}
            data-pinned={item.pinned ? "true" : "false"}
            onclick="toggleCardPin(this)"
            title={item.pinned ? "Unpin" : "Pin to top"}
          >
            {item.pinned ? "pinned" : "pin"}
          </button>
          <button
            class={`card-fav-btn${item.favorited ? " is-active" : ""}`}
            type="button"
            data-item-id={item.id}
            data-favorited={item.favorited ? "true" : "false"}
            onclick="toggleCardFav(this)"
            title={item.favorited ? "Remove from favorites" : "Add to favorites"}
          >
            {item.favorited ? "\u2605" : "\u2606"}
          </button>
          <button
            class="card-read-btn"
            type="button"
            data-item-id={item.id}
            data-read={item.read ? "true" : "false"}
            onclick="toggleCardRead(this)"
          >
            {item.read ? "unread" : "read"}
          </button>
          <button
            class="card-delete-btn"
            type="button"
            data-item-id={item.id}
            onclick="handleDelete(this)"
          >
            delete
          </button>
          <a class="card-detail-link" href={`/items/${item.id}`} data-item-id={item.id} onclick="markReadFromCard(this)">details &rarr;</a>
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
  activeRead?: string;
  activeFavorited?: string;
  activePinned?: string;
  allTags: string[];
  nextCursor?: string;
}> = ({ results, activeTag, activeStatus, activeSourceType, activeRead, activeFavorited, activePinned, allTags, nextCursor }) => {
  function filterUrl(overrides: Record<string, string | undefined>) {
    const params: Record<string, string> = {};
    if (activeTag) params.tag = activeTag;
    if (activeStatus) params.status = activeStatus;
    if (activeSourceType) params.source_type = activeSourceType;
    if (activeRead) params.read = activeRead;
    if (activeFavorited) params.favorited = activeFavorited;
    if (activePinned) params.pinned = activePinned;
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params[k] = v;
      else delete params[k];
    }
    const qs = new URLSearchParams(params).toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  return (
    <Layout title="Library" activePage="library">
      {/* Filters */}
      <section class="library-filters">
        <div class="filter-row filter-row--tags">
          <div class="filter-group filter-group--tags">
            <span class="filter-label">Tags</span>
            <div class="filter-options-scroll">
              <div class="filter-options filter-options--tags">
                <a
                  class={`filter-option ${!activeTag ? "active" : ""}`}
                  href={filterUrl({ tag: undefined })}
                >
                  All
                </a>
                {allTags.map((tag) => (
                  <a
                    class={`filter-option ${activeTag === tag ? "active" : ""}`}
                    href={filterUrl({ tag })}
                  >
                    {tag}
                  </a>
                ))}
              </div>
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
                { value: "tweet-article", label: "Tweet article" },
                { value: "github", label: "GitHub" },
                { value: "video", label: "Video" },
                { value: "pdf", label: "PDF" },
              ].map(({ value, label }) => (
                <a
                  class={`filter-option ${(activeSourceType || "") === value ? "active" : ""}`}
                  href={filterUrl({ source_type: value || undefined })}
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
                  href={filterUrl({ status: s || undefined })}
                >
                  {s || "All"}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Read</span>
            <div class="filter-options">
              {[
                { value: "", label: "All" },
                { value: "false", label: "Unread" },
                { value: "true", label: "Read" },
              ].map(({ value, label }) => (
                <a
                  class={`filter-option ${(activeRead || "") === value ? "active" : ""}`}
                  href={filterUrl({ read: value || undefined })}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <span class="filter-label">Saved</span>
            <div class="filter-options">
              {[
                { param: "favorited" as const, value: "", label: "All" },
                { param: "favorited" as const, value: "true", label: "Favorites" },
                { param: "pinned" as const, value: "true", label: "Pinned" },
              ].map(({ param, value, label }) => {
                const isActive = param === "favorited"
                  ? (value === "" ? !activeFavorited && !activePinned : activeFavorited === value)
                  : activePinned === value;
                return (
                  <a
                    class={`filter-option ${isActive ? "active" : ""}`}
                    href={filterUrl(
                      value === ""
                        ? { favorited: undefined, pinned: undefined }
                        : param === "favorited"
                          ? { favorited: value, pinned: undefined }
                          : { pinned: value, favorited: undefined }
                    )}
                  >
                    {label}
                  </a>
                );
              })}
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
            href={filterUrl({ cursor: nextCursor })}
          >
            Load more
          </a>
        </div>
      )}
    </Layout>
  );
};
