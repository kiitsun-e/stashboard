import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface ItemDetail {
  id: string;
  url: string;
  title: string | null;
  content: string | null;
  userNote: string | null;
  summary: string | null;
  sourceType: string;
  savedAt: number;
  processedAt: number | null;
  status: string;
  error: string | null;
  tags: string[];
}

function formatDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const ItemPage: FC<{ item: ItemDetail }> = ({ item }) => {
  const displayTitle = item.title || hostname(item.url);

  return (
    <Layout title={displayTitle} activePage="">
      <div class="item-detail">
        {/* Back link */}
        <a href="/library" class="item-back">&larr; Library</a>

        {/* Header */}
        <header class="item-header">
          <h1 class="item-title">{displayTitle}</h1>
          <div class="item-origin">
            <span class="item-hostname">{hostname(item.url)}</span>
            <span class="item-date">{formatDate(item.savedAt)}</span>
            <span class="item-status" data-status={item.status}>{item.status}</span>
          </div>
        </header>

        {/* Primary action */}
        <a href={item.url} target="_blank" rel="noopener" class="item-open">
          Open Original &rarr;
        </a>

        {/* Note */}
        {item.userNote && (
          <blockquote class="item-note">
            {item.userNote}
          </blockquote>
        )}

        {/* Summary */}
        {item.summary && (
          <section class="item-summary">
            <p>{item.summary}</p>
          </section>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div class="item-tags">
            {item.tags.map((tag) => (
              <a class="tag" href={`/library?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </a>
            ))}
          </div>
        )}

        {/* Error */}
        {item.error && (
          <div class="item-error">
            <span class="item-error-label">Error</span>
            <code>{item.error}</code>
          </div>
        )}

        {/* Metadata */}
        <dl class="item-meta-grid">
          <dt>Source</dt>
          <dd>{item.sourceType}</dd>
          <dt>Saved</dt>
          <dd>{formatDate(item.savedAt)} at {formatTime(item.savedAt)}</dd>
          {item.processedAt && (
            <>
              <dt>Processed</dt>
              <dd>{formatDate(item.processedAt)} at {formatTime(item.processedAt)}</dd>
            </>
          )}
          <dt>ID</dt>
          <dd><code class="item-id">{item.id}</code></dd>
        </dl>

        {/* Archived content */}
        {item.content && (
          <section class="item-content">
            <div class="item-content-header">
              <h2>Archived Content</h2>
              <span class="item-content-hint">Extracted from the original page</span>
            </div>
            <div class="item-content-body" dangerouslySetInnerHTML={{ __html: escapeForDisplay(item.content) }} />
          </section>
        )}
      </div>
    </Layout>
  );
};

/**
 * Render stored markdown-ish content as simple HTML.
 * Content is extracted markdown — we do minimal conversion:
 * paragraphs from double newlines, preserve single newlines as <br>,
 * and escape HTML to prevent XSS.
 */
function escapeForDisplay(content: string): string {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Double newlines → paragraph breaks, single newlines → <br>
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
