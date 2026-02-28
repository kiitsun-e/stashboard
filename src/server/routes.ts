import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../db";
import { items, tags, itemTags } from "../db/schema";
import { saveUrl, processItem, processAll, reclassifyTweets } from "../pipeline/save";
import { search, list } from "../pipeline/search";

const ARCHIVE_DIR = process.env.STASHBOARD_ARCHIVE_DIR ?? "data/archive";

export const routes = new Hono();

// POST /save
routes.post("/save", async (c) => {
  const body = await c.req.json<{ url?: string; note?: string }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const result = await saveUrl(body.url, body.note);

  // Fire-and-forget async processing for new items
  if (!result.existing) {
    processItem(result.id).catch((e) => {
      console.error(`Processing failed for ${result.id}:`, e.message);
    });
  }

  return c.json(result, result.existing ? 200 : 201);
});

// GET /search
routes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) {
    return c.json({ error: "q query parameter is required" }, 400);
  }

  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined;
  const tag = c.req.query("tag") || undefined;

  const results = await search(q, { limit, tag });
  return c.json({ results });
});

// GET /library
routes.get("/library", async (c) => {
  const tag = c.req.query("tag") || undefined;
  const sourceType = c.req.query("source_type") || undefined;
  const status = c.req.query("status") || undefined;
  const cursor = c.req.query("cursor") || undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined;

  const results = await list({ tag, sourceType, status, cursor, limit });
  return c.json({ results });
});

// GET /items/:id
routes.get("/items/:id", async (c) => {
  const id = c.req.param("id");

  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Enrich with tags
  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, id));

  return c.json({
    ...item,
    embedding: undefined, // Don't send raw embedding to client
    tags: tagRows.map((t) => t.name),
  });
});

// DELETE /items/:id
routes.delete("/items/:id", async (c) => {
  const id = c.req.param("id");

  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  await db.delete(items).where(eq(items.id, id));

  // Clean up orphaned tags (no remaining item_tags references)
  await db.delete(tags).where(
    sql`${tags.id} NOT IN (SELECT DISTINCT ${itemTags.tagId} FROM ${itemTags})`
  );

  // Clean up archived HTML
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(`${ARCHIVE_DIR}/${id}.html`);
  } catch {
    // File may not exist, that's fine
  }

  return c.json({ deleted: true });
});

// PATCH /items/:id
routes.patch("/items/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    note?: string;
    add_tags?: string[];
    remove_tags?: string[];
  }>();

  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Update note if provided
  if (body.note !== undefined) {
    await db
      .update(items)
      .set({ userNote: body.note })
      .where(eq(items.id, id));
  }

  // Add tags
  if (body.add_tags?.length) {
    for (const tagName of body.add_tags) {
      const tagId = ulid();
      await db
        .insert(tags)
        .values({ id: tagId, name: tagName })
        .onConflictDoNothing();

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
  }

  // Remove tags
  if (body.remove_tags?.length) {
    for (const tagName of body.remove_tags) {
      const [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, tagName))
        .limit(1);

      if (tag) {
        await db
          .delete(itemTags)
          .where(
            sql`${itemTags.itemId} = ${id} AND ${itemTags.tagId} = ${tag.id}`
          );
      }
    }
  }

  // Return updated item
  const [updated] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, id));

  return c.json({
    ...updated,
    embedding: undefined,
    tags: tagRows.map((t) => t.name),
  });
});

// POST /reclassify — reclassify existing tweets into subtypes
routes.post("/reclassify", async (c) => {
  const count = await reclassifyTweets();
  return c.json({ reclassified: count });
});

// POST /process
routes.post("/process", async (c) => {
  const id = c.req.query("id");

  if (id) {
    await processItem(id);
    return c.json({ processed: 1, ids: [id] });
  }

  const count = await processAll();
  return c.json({ processed: count });
});
