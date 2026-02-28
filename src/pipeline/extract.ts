import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import {
  TwitterClient,
  resolveCredentials,
  type TweetData,
} from "@steipete/bird";
import { extractTweetId } from "@steipete/bird/dist/lib/extract-tweet-id.js";
import { validateUrl } from "./ssrf";

const FETCH_TIMEOUT = 15_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONTENT_SIZE = 500 * 1024; // 500KB extracted content
const MAX_REDIRECTS = 3;

export type SourceType = "article" | "tweet" | "long-tweet" | "tweet-article" | "github" | "video" | "pdf" | "other";

export interface ExtractedContent {
  title: string;
  content: string; // plain text for search/embedding
  contentHtml: string; // sanitized HTML for display
  html: string; // raw HTML for archiving
  sourceType: SourceType;
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Text
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "code", "em", "strong", "b", "i", "u",
    "s", "del", "ins", "mark", "small", "sub", "sup", "br", "hr",
    // Lists
    "ul", "ol", "li", "dl", "dt", "dd",
    // Images
    "img",
    // Tables
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    // Links
    "a",
    // Semantic
    "figure", "figcaption", "aside", "section", "details", "summary",
    // Code
    "span",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "width", "height", "loading"],
    code: ["class"],
    span: ["class"],
    pre: ["class"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  allowedSchemes: ["http", "https"],
  // Open links in new tabs (added via transformTags)
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer",
    }),
    img: sanitizeHtml.simpleTransform("img", {
      loading: "lazy",
    }),
  },
};

function detectSourceType(url: string): SourceType {
  const host = new URL(url).hostname.replace("www.", "");

  // X/Twitter — refined to long-tweet or tweet-article after fetching content
  if (host === "x.com" || host === "twitter.com") return "tweet";
  if (host === "github.com" || host === "gist.github.com") return "github";
  if (host === "youtube.com" || host === "youtu.be") return "video";
  if (url.endsWith(".pdf")) return "pdf";
  return "article";
}

/**
 * Fetch a URL with SSRF protection, redirect limits, and size limits
 */
async function safeFetch(url: string, redirectCount = 0): Promise<Response> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
  }

  await validateUrl(url);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Stashboard/1.0; +https://github.com/stashboard)",
    },
  });

  // Handle redirects manually so we can validate each target
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect with no Location header");

    const redirectUrl = new URL(location, url).toString();
    return safeFetch(redirectUrl, redirectCount + 1);
  }

  return response;
}

/**
 * Fetch and extract content from a URL
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
  const sourceType = detectSourceType(url);

  // Tweets & X content: fetch via bird (X's internal API) with graceful fallback
  if (sourceType === "tweet") {
    try {
      const tweet = await fetchTweet(url);
      if (tweet) {
        const content = formatTweetText(tweet);
        const contentHtml = formatTweetHtml(tweet);
        const author = tweet.author?.username ?? "unknown";
        const name = tweet.author?.name ?? author;

        // Classify: article field present → tweet-article,
        // text > 280 chars → long-tweet, otherwise → tweet
        let resolvedType: SourceType = "tweet";
        if (tweet.article) {
          resolvedType = "tweet-article";
        } else if ((tweet.text?.length ?? 0) > 280) {
          resolvedType = "long-tweet";
        }

        return {
          title: `${name} (@${author}) on X`,
          content,
          contentHtml,
          html: "",
          sourceType: resolvedType,
        };
      }
    } catch (err) {
      console.warn(`[bird] Failed to fetch tweet: ${err}`);
    }
    // Fallback: no content, pipeline still works with title + user note
    return {
      title: `Tweet: ${url}`,
      content: "",
      contentHtml: "",
      html: "",
      sourceType: "tweet",
    };
  }

  const response = await safeFetch(url);

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  // Check content size
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large: ${contentLength} bytes`);
  }

  const html = await response.text();

  if (html.length > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large: ${html.length} bytes`);
  }

  // Parse with Readability
  const { document } = parseHTML(html);
  const reader = new Readability(document as any);
  const article = reader.parse();

  let content = article?.textContent?.trim() ?? "";

  // Cap content size
  if (content.length > MAX_CONTENT_SIZE) {
    content =
      content.slice(0, MAX_CONTENT_SIZE) +
      "\n\n[Content truncated — original exceeds 500KB]";
  }

  // Sanitize the rich HTML from Readability for safe display
  const contentHtml = article?.content
    ? sanitizeHtml(article.content, SANITIZE_OPTIONS)
    : "";

  return {
    title: article?.title ?? new URL(url).hostname,
    content,
    contentHtml,
    html: html.length <= 2 * 1024 * 1024 ? html : "", // skip archive if >2MB
    sourceType,
  };
}

// --- Bird (X/Twitter) helpers ---

async function fetchTweet(url: string): Promise<TweetData | null> {
  const authToken = process.env.AUTH_TOKEN;
  const ct0 = process.env.CT0;
  if (!authToken || !ct0) {
    console.warn("[bird] AUTH_TOKEN and CT0 env vars not set, skipping tweet extraction");
    return null;
  }

  const tweetId = extractTweetId(url);
  const { cookies } = await resolveCredentials({ authToken, ct0 });
  const client = new TwitterClient({ cookies, timeoutMs: FETCH_TIMEOUT });
  const result = await client.getTweet(tweetId);

  if (!result.success || !result.tweet) {
    console.warn(`[bird] Could not fetch tweet ${tweetId}: ${result.error ?? "unknown error"}`);
    return null;
  }

  return result.tweet;
}

function formatTweetText(tweet: TweetData): string {
  const parts: string[] = [];
  const author = tweet.author?.username ?? "unknown";
  parts.push(`@${author}: ${tweet.text}`);

  if (tweet.quotedTweet) {
    const qAuthor = tweet.quotedTweet.author?.username ?? "unknown";
    parts.push(`\nQuoting @${qAuthor}: ${tweet.quotedTweet.text}`);
  }

  return parts.join("\n");
}

function formatTweetHtml(tweet: TweetData): string {
  const author = tweet.author?.username ?? "unknown";
  const name = tweet.author?.name ?? author;
  const text = escapeHtml(tweet.text).replace(/\n/g, "<br>");

  let html = `<p><strong>${escapeHtml(name)}</strong> <span class="text-secondary">@${escapeHtml(author)}</span></p><p>${text}</p>`;

  if (tweet.media?.length) {
    for (const m of tweet.media) {
      if (m.type === "photo") {
        html += `<figure><img src="${escapeHtml(m.url)}" alt="" loading="lazy"></figure>`;
      }
    }
  }

  if (tweet.quotedTweet) {
    const qAuthor = tweet.quotedTweet.author?.username ?? "unknown";
    const qName = tweet.quotedTweet.author?.name ?? qAuthor;
    const qText = escapeHtml(tweet.quotedTweet.text).replace(/\n/g, "<br>");
    html += `<blockquote><p><strong>${escapeHtml(qName)}</strong> <span class="text-secondary">@${escapeHtml(qAuthor)}</span></p><p>${qText}</p></blockquote>`;
  }

  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
