import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface SummaryResult {
  summary: string;
  tags: string[];
}

const FORMAT_PROMPTS = {
  video:
    "Format this video transcript into clean, readable markdown. Add ## section headers where the topic shifts. Organize into paragraphs. Clean up filler words and false starts, but preserve all substantive content and meaning. Return ONLY the formatted markdown.",
  pdf:
    "Format this raw PDF text extraction into clean, readable markdown. Add ## section headers matching the document's structure. Fix broken line wraps, remove page artifacts (page numbers, headers/footers, column layout remnants like scattered single characters). Preserve all substantive content — tables, equations, references. Return ONLY the formatted markdown.",
} as const;

/**
 * Format raw extracted text into structured markdown with section headers and paragraphs.
 * Used for YouTube transcripts and PDF extractions that are otherwise walls of unformatted text.
 */
export async function formatContent(
  rawText: string,
  kind: keyof typeof FORMAT_PROMPTS
): Promise<string> {
  const capped = rawText.slice(0, 30_000);

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${FORMAT_PROMPTS[kind]}\n\n${capped}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  return text || rawText;
}

/**
 * Generate a summary and tags for content using Claude Haiku
 */
export async function summarize(
  title: string,
  content: string,
  userNote?: string
): Promise<SummaryResult> {
  // If there's no content (e.g., failed tweet extraction), work with what we have
  const input = [
    title && `Title: ${title}`,
    userNote && `User's note: ${userNote}`,
    content && `Content:\n${content.slice(0, 8000)}`, // cap context sent to Haiku
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!input.trim()) {
    return { summary: "", tags: [] };
  }

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Analyze this saved article/post and return a JSON object with:
- "summary": a 2-3 sentence summary of what this is about and why it's interesting
- "tags": an array of 3-5 lowercase kebab-case topic tags

Summarize based on whatever information is available — title, metadata, user notes, or content. Never say you lack information; always produce a useful summary from what's provided.

Respond ONLY with valid JSON, no markdown fences.

${input}`,
      },
    ],
  });

  let text =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Strip markdown fences if Haiku wraps the JSON
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  try {
    const parsed = JSON.parse(text);
    return {
      summary: parsed.summary ?? "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t: any) => String(t).toLowerCase().trim())
        : [],
    };
  } catch {
    // If Haiku returns malformed JSON, extract what we can
    return { summary: text.slice(0, 500), tags: [] };
  }
}
