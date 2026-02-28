import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../db";
import { items, tags, itemTags } from "../db/schema";
import { extractContent } from "./extract";
import { summarize } from "./summarize";
import { embed } from "./embed";

const ARCHIVE_DIR = "data/archive";

interface SaveResult {
  id: string;
  status: string;
  existing: boolean;
}

/**
 * Save a URL. If it already exists, return the existing item.
 */
export async function saveUrl(
  url: string,
  note?: string
): Promise<SaveResult> {
  // Check for existing
  const existing = await db
    .select({ id: items.id, status: items.status })
    .from(items)
    .where(eq(items.url, url))
    .limit(1);

  if (existing.length > 0) {
    return { id: existing[0].id, status: existing[0].status, existing: true };
  }

  const id = ulid();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(items).values({
    id,
    url,
    userNote: note ?? null,
    savedAt: now,
    status: "pending",
  });

  return { id, status: "pending", existing: false };
}

/**
 * Process a pending/failed item: extract, summarize, embed, store.
 */
export async function processItem(id: string): Promise<void> {
  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  if (!item) throw new Error(`Item not found: ${id}`);

  try {
    // 1. Extract content
    console.log(`  Extracting content from ${item.url}...`);
    const extracted = await extractContent(item.url);

    // 2. Archive raw HTML to disk
    if (extracted.html) {
      await Bun.write(`${ARCHIVE_DIR}/${id}.html`, extracted.html);
    }

    // 3. Summarize with Haiku
    console.log(`  Generating summary...`);
    const { summary, tags: tagNames } = await summarize(
      extracted.title,
      extracted.content,
      item.userNote ?? undefined
    );

    // 4. Generate embedding
    console.log(`  Generating embedding...`);
    const embedding = await embed(
      extracted.title,
      summary,
      item.userNote ?? undefined
    );

    // 5. Store everything
    const now = Math.floor(Date.now() / 1000);

    // Store embedding as JSON text (cosine similarity computed in JS)
    const embeddingJson = JSON.stringify(embedding);
    await db
      .update(items)
      .set({
        title: extracted.title,
        content: extracted.content,
        contentHtml: extracted.contentHtml,
        summary,
        sourceType: extracted.sourceType,
        processedAt: now,
        status: "processed",
        error: null,
        embedding: embeddingJson,
      })
      .where(eq(items.id, id));

    // 6. Create tags and link them
    for (const tagName of tagNames) {
      const tagId = ulid();
      // Upsert tag
      await db
        .insert(tags)
        .values({ id: tagId, name: tagName })
        .onConflictDoNothing();

      // Get the tag id (may be existing)
      const [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, tagName))
        .limit(1);

      if (tag) {
        await db
          .insert(itemTags)
          .values({ itemId: id, tagId: tag.id })
          .onConflictDoNothing();
      }
    }

    console.log(`  Done — "${extracted.title}"`);
  } catch (e: any) {
    // Mark as failed
    await db
      .update(items)
      .set({ status: "failed", error: e.message ?? String(e) })
      .where(eq(items.id, id));

    throw e;
  }
}

/**
 * Process all pending/failed items.
 */
export async function processAll(): Promise<number> {
  const pending = await db
    .select({ id: items.id })
    .from(items)
    .where(
      sql`${items.status} IN ('pending', 'failed')`
    );

  let processed = 0;
  for (const item of pending) {
    try {
      await processItem(item.id);
      processed++;
    } catch (e: any) {
      console.error(`  Failed to process ${item.id}: ${e.message}`);
    }
  }
  return processed;
}
