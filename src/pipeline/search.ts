import { eq } from "drizzle-orm";
import { db } from "../db";
import { items, tags, itemTags } from "../db/schema";
import { embed } from "./embed";

export interface SearchResult {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  userNote: string | null;
  similarity?: number;
  savedAt: number;
  status: string;
  sourceType: string;
  read: boolean;
  favorited: boolean;
  pinned: boolean;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function enrichWithTags(itemId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, itemId));
  return rows.map((t) => t.name);
}

/**
 * Semantic search — embed query, compute cosine similarity against all items
 */
export async function search(
  query: string,
  options: { limit?: number; tag?: string } = {}
): Promise<SearchResult[]> {
  const { limit = 20, tag } = options;

  const queryEmbedding = await embed(query, "", undefined);

  // Get all processed items with embeddings
  const allItems = await db
    .select()
    .from(items)
    .where(eq(items.status, "processed"));

  // Score each item
  const scored: { item: (typeof allItems)[0]; similarity: number }[] = [];
  for (const item of allItems) {
    if (!item.embedding) continue;
    const itemEmbedding: number[] = JSON.parse(item.embedding);
    const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);
    scored.push({ item, similarity });
  }

  // Sort by similarity descending, then float pinned to top
  scored.sort((a, b) => b.similarity - a.similarity);
  scored.sort((a, b) => {
    if (a.item.pinned && !b.item.pinned) return -1;
    if (!a.item.pinned && b.item.pinned) return 1;
    return 0;
  });

  // Build results with tag enrichment and filtering
  const results: SearchResult[] = [];
  for (const { item, similarity } of scored) {
    const tagNames = await enrichWithTags(item.id);

    if (tag && !tagNames.includes(tag)) continue;

    results.push({
      id: item.id,
      url: item.url,
      title: item.title,
      summary: item.summary,
      tags: tagNames,
      userNote: item.userNote,
      similarity,
      savedAt: item.savedAt,
      status: item.status,
      sourceType: item.sourceType,
      read: item.read,
      favorited: item.favorited,
      pinned: item.pinned,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * List items with optional filtering, paginated by ULID cursor
 */
export async function list(
  options: {
    tag?: string;
    sourceType?: string;
    status?: string;
    read?: string;
    favorited?: string;
    pinned?: string;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<SearchResult[]> {
  const { tag, sourceType, cursor, limit = 50 } = options;

  let allItems = await db
    .select()
    .from(items)
    .orderBy(items.savedAt);

  // Reverse to get descending order
  allItems = allItems.reverse();

  // Apply filters
  if (sourceType) allItems = allItems.filter((i) => i.sourceType === sourceType);
  if (options.status) allItems = allItems.filter((i) => i.status === options.status);
  if (options.read === "true") allItems = allItems.filter((i) => i.read);
  if (options.read === "false") allItems = allItems.filter((i) => !i.read);
  if (options.favorited === "true") allItems = allItems.filter((i) => i.favorited);
  if (options.pinned === "true") allItems = allItems.filter((i) => i.pinned);
  if (cursor) allItems = allItems.filter((i) => i.id < cursor);

  const results: SearchResult[] = [];
  for (const item of allItems) {
    const tagNames = await enrichWithTags(item.id);
    if (tag && !tagNames.includes(tag)) continue;

    results.push({
      id: item.id,
      url: item.url,
      title: item.title,
      summary: item.summary,
      tags: tagNames,
      userNote: item.userNote,
      savedAt: item.savedAt,
      status: item.status,
      sourceType: item.sourceType,
      read: item.read,
      favorited: item.favorited,
      pinned: item.pinned,
    });

    if (results.length >= limit) break;
  }

  // Float pinned items to top, preserving order within groups
  results.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  return results;
}
