import { eq, and, desc, lt, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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

/** Columns needed for list/search display — excludes content, contentHtml, embedding, error */
const listColumns = {
  id: items.id,
  url: items.url,
  title: items.title,
  summary: items.summary,
  userNote: items.userNote,
  savedAt: items.savedAt,
  status: items.status,
  sourceType: items.sourceType,
  read: items.read,
  favorited: items.favorited,
  pinned: items.pinned,
};

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

/** Fetch tags for a single item (used by detail page / API routes) */
export async function enrichWithTags(itemId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, itemId));
  return rows.map((t) => t.name);
}

/** Batch-fetch tags for multiple items in a single query */
async function batchEnrichTags(
  itemIds: string[]
): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map();

  const rows = await db
    .select({
      itemId: itemTags.itemId,
      tagName: tags.name,
    })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(inArray(itemTags.itemId, itemIds));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.itemId);
    if (existing) {
      existing.push(row.tagName);
    } else {
      map.set(row.itemId, [row.tagName]);
    }
  }
  return map;
}

/**
 * Semantic search — embed query, compute cosine similarity against all items.
 * Two-phase: score with minimal columns, then fetch display data for top results.
 */
export async function search(
  query: string,
  options: { limit?: number; tag?: string } = {}
): Promise<SearchResult[]> {
  const { limit = 20, tag } = options;

  const queryEmbedding = await embed(query, "", undefined);

  // Phase 1: Fetch only id + embedding + pinned for scoring
  const allEmbeddings = await db
    .select({
      id: items.id,
      embedding: items.embedding,
      pinned: items.pinned,
    })
    .from(items)
    .where(eq(items.status, "processed"));

  // Score each item
  const scored: { id: string; similarity: number; pinned: boolean }[] = [];
  for (const row of allEmbeddings) {
    if (!row.embedding) continue;
    const itemEmbedding: number[] = JSON.parse(row.embedding);
    const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);
    scored.push({ id: row.id, similarity, pinned: row.pinned });
  }

  // Sort: pinned first, then by similarity descending
  scored.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.similarity - a.similarity;
  });

  // Over-fetch when filtering by tag to account for non-matching items
  const fetchLimit = tag ? limit * 3 : limit;
  const topIds = scored.slice(0, fetchLimit).map((s) => s.id);

  if (topIds.length === 0) return [];

  // Phase 2: Fetch display columns for top results only
  const topItems = await db
    .select(listColumns)
    .from(items)
    .where(inArray(items.id, topIds));

  const itemMap = new Map(topItems.map((item) => [item.id, item]));

  // Phase 3: Batch tag enrichment
  const tagMap = await batchEnrichTags(topIds);

  // Build results in scored order, applying tag filter
  const results: SearchResult[] = [];
  for (const { id, similarity } of scored) {
    const item = itemMap.get(id);
    if (!item) continue;

    const itemTagNames = tagMap.get(id) ?? [];
    if (tag && !itemTagNames.includes(tag)) continue;

    results.push({
      ...item,
      tags: itemTagNames,
      similarity,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * List items with optional filtering, paginated by ULID cursor.
 * All filtering and sorting pushed to SQL.
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

  // Build WHERE conditions
  const conditions: SQL[] = [];
  if (sourceType)
    conditions.push(
      eq(items.sourceType, sourceType as typeof items.sourceType._.data)
    );
  if (options.status)
    conditions.push(
      eq(items.status, options.status as typeof items.status._.data)
    );
  if (options.read === "true") conditions.push(eq(items.read, true));
  if (options.read === "false") conditions.push(eq(items.read, false));
  if (options.favorited === "true") conditions.push(eq(items.favorited, true));
  if (options.pinned === "true") conditions.push(eq(items.pinned, true));
  if (cursor) conditions.push(lt(items.id, cursor));

  let rows;
  if (tag) {
    // Tag filter via JOIN — filter at SQL level instead of iterating all items
    rows = await db
      .select(listColumns)
      .from(items)
      .innerJoin(itemTags, eq(itemTags.itemId, items.id))
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(and(eq(tags.name, tag), ...conditions))
      .orderBy(desc(items.pinned), desc(items.id))
      .limit(limit);
  } else {
    rows = await db
      .select(listColumns)
      .from(items)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(items.pinned), desc(items.id))
      .limit(limit);
  }

  // Batch tag enrichment — single query for all item IDs
  const itemIds = rows.map((r) => r.id);
  const tagMap = await batchEnrichTags(itemIds);

  return rows.map((row) => ({
    ...row,
    tags: tagMap.get(row.id) ?? [],
  }));
}
