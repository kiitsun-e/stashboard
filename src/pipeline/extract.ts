import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import {
  TwitterClient,
  resolveCredentials,
  type TweetData,
} from "@steipete/bird";
import { extractTweetId } from "@steipete/bird/dist/lib/extract-tweet-id.js";
import {
  createLinkPreviewClient,
  type LinkPreviewClient,
} from "@steipete/summarize-core/content";
import { validateUrl } from "./ssrf";
import { formatContent } from "./summarize";

const FETCH_TIMEOUT = 15_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONTENT_SIZE = 500 * 1024; // 500KB extracted content
const MAX_REDIRECTS = 3;

export type SourceType = "article" | "tweet" | "tweet-article" | "github" | "video" | "pdf" | "other";

export interface ExtractedContent {
  title: string;
  content: string; // plain text for search/embedding
  contentHtml: string; // sanitized HTML for display
  html: string; // raw HTML for archiving
  sourceType: SourceType;
}

export const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
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

// --- Summarize-core client for video/PDF extraction ---

let _linkClient: LinkPreviewClient | null = null;

function getLinkClient(): LinkPreviewClient {
  if (!_linkClient) {
    _linkClient = createLinkPreviewClient({
      ytDlpPath: null,
      scrapeWithFirecrawl: null,
    });
  }
  return _linkClient;
}

const SUMMARIZE_TIMEOUT = 60_000;

function markdownToSafeHtml(md: string): string {
  if (!md) return "";
  return sanitizeHtml(
    marked.parse(md, { async: false }) as string,
    SANITIZE_OPTIONS
  );
}

async function extractVideo(url: string): Promise<ExtractedContent> {
  const client = getLinkClient();
  const result = await client.fetchLinkContent(url, {
    youtubeTranscript: "web",
    format: "text",
    timeoutMs: SUMMARIZE_TIMEOUT,
    maxCharacters: MAX_CONTENT_SIZE,
  });

  const title = result.title || `YouTube: ${url}`;
  let content = result.content || "";

  // Format the raw transcript into structured markdown with headers
  if (content) {
    content = await formatContent(content, "video");
  }

  return {
    title,
    content,
    contentHtml: markdownToSafeHtml(content),
    html: "",
    sourceType: "video",
  };
}

async function extractPdf(url: string): Promise<ExtractedContent> {
  // summarize-core can't handle PDF content-type directly — shell out to the CLI
  // which has a preprocessing pipeline for binary formats
  const binPath = await findSummarizeBin();
  if (!binPath) {
    throw new Error("summarize binary not found");
  }

  const proc = Bun.spawn(
    [binPath, url, "--extract", "--format", "md", "--plain", "--no-color", "--timeout", "60s"],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error(`summarize exit ${exitCode}: ${stderr.slice(0, 200)}`);
  }

  // Remove trailing metrics line (e.g., "12.3s · text/plain · 45,231 chars")
  let content = stdout.trim().replace(/\n\n[\d.]+s\s+·\s+[^\n]+$/m, "").trim();

  if (content.length > MAX_CONTENT_SIZE) {
    content = content.slice(0, MAX_CONTENT_SIZE) + "\n\n[Content truncated]";
  }

  // Format raw PDF text into structured markdown with proper headers
  if (content) {
    content = await formatContent(content, "pdf");
  }

  // Extract title: first markdown heading, or first paragraph block, or filename
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m);
  // For PDFs without markdown headings, grab the first paragraph (may span lines)
  const firstParagraph = content.split(/\n\n/)[0]?.trim().replace(/\s+/g, " ");
  const filename = decodeURIComponent(
    url.split("/").pop()?.replace(".pdf", "") || "PDF"
  );
  const title =
    headingMatch?.[1] ||
    (firstParagraph && firstParagraph.length <= 200 ? firstParagraph : null) ||
    filename;

  return {
    title,
    content,
    contentHtml: markdownToSafeHtml(content),
    html: "",
    sourceType: "pdf",
  };
}

async function findSummarizeBin(): Promise<string | null> {
  // Check node_modules/.bin first (works in production/Railway)
  const localBin = "node_modules/.bin/summarize";
  if (await Bun.file(localBin).exists()) return localBin;

  // Fall back to global PATH
  const which = Bun.spawn(["which", "summarize"], { stdout: "pipe" });
  const path = (await new Response(which.stdout).text()).trim();
  if (await which.exited === 0 && path) return path;

  return null;
}

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
        const author = tweet.author?.username ?? "unknown";
        const name = tweet.author?.name ?? author;

        // Classify: article field present → tweet-article, otherwise → tweet
        const resolvedType: SourceType = tweet.article ? "tweet-article" : "tweet";

        const contentHtml = resolvedType === "tweet-article"
          ? formatTweetArticleHtml(tweet)
          : formatTweetHtml(tweet);

        return {
          title: resolvedType === "tweet-article" && tweet.article?.title
            ? tweet.article.title
            : `${name} (@${author}) on X`,
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

  // Video (YouTube): extract transcript via summarize-core
  if (sourceType === "video") {
    try {
      return await extractVideo(url);
    } catch (err) {
      console.warn(`[summarize] Video extraction failed: ${err}`);
      // Fall through to generic Readability extraction
    }
  }

  // PDF: extract text via summarize-core
  if (sourceType === "pdf") {
    try {
      return await extractPdf(url);
    } catch (err) {
      console.warn(`[summarize] PDF extraction failed: ${err}`);
      // Fall through to generic Readability extraction
    }
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
  let title = article?.title ?? "";

  // Fallback for JS-rendered SPAs: extract from meta tags and JSON-LD
  if (!content) {
    const meta = extractMeta(document as any);
    if (!title) title = meta.title;
    content = meta.description;
  }

  if (!title) title = new URL(url).hostname;

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
    title,
    content,
    contentHtml,
    html: html.length <= 2 * 1024 * 1024 ? html : "", // skip archive if >2MB
    sourceType,
  };
}

// --- Meta tag / JSON-LD fallback for JS-rendered pages ---

function extractMeta(document: any): { title: string; description: string } {
  const get = (selector: string, attr = "content"): string =>
    document.querySelector(selector)?.getAttribute(attr)?.trim() ?? "";

  const title =
    get('meta[property="og:title"]') ||
    get('meta[name="twitter:title"]') ||
    document.querySelector("title")?.textContent?.trim() ||
    "";

  // Collect descriptions from meta tags
  const descriptions = [
    get('meta[property="og:description"]'),
    get('meta[name="description"]'),
    get('meta[name="twitter:description"]'),
  ].filter(Boolean);

  // Also pull FAQ/article content from JSON-LD structured data
  const jsonLdParts: string[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      if (data.description) jsonLdParts.push(data.description);
      if (data.headline) jsonLdParts.push(data.headline);
      // FAQ pages often have rich Q&A content
      if (data.mainEntity && Array.isArray(data.mainEntity)) {
        for (const entity of data.mainEntity) {
          if (entity.name && entity.acceptedAnswer?.text) {
            jsonLdParts.push(`Q: ${entity.name}\nA: ${entity.acceptedAnswer.text}`);
          }
        }
      }
    } catch {
      // malformed JSON-LD, skip
    }
  }

  const description = [...descriptions, ...jsonLdParts].join("\n\n");
  return { title, description };
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

/**
 * For tweet-articles: render the article body as markdown → HTML,
 * with tweet author attribution as a header.
 */
function formatTweetArticleHtml(tweet: TweetData): string {
  const author = tweet.author?.username ?? "unknown";
  const name = tweet.author?.name ?? author;

  // The article body is embedded in tweet.text by bird's extractTweetText.
  // It contains markdown from Draft.js content_state rendering.
  const articleMarkdown = tweet.text;
  const articleHtml = marked.parse(articleMarkdown, { async: false }) as string;

  const attribution = `<p class="text-secondary"><strong>${escapeHtml(name)}</strong> @${escapeHtml(author)} on X</p><hr>`;

  return sanitizeHtml(attribution + articleHtml, SANITIZE_OPTIONS);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
