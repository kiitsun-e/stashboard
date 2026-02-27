import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface SummaryResult {
  summary: string;
  tags: string[];
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
