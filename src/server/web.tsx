import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { items, tags, itemTags } from "../db/schema";
import { SearchPage } from "./pages/search";
import { LibraryPage } from "./pages/library";
import { ItemPage } from "./pages/item";
import { search, list } from "../pipeline/search";

export const web = new Hono();

// Static files
web.use("/public/*", serveStatic({ root: "src/server/" }));

// Search page (home)
web.get("/", async (c) => {
  const q = c.req.query("q")?.trim();

  if (q) {
    const tag = c.req.query("tag") || undefined;
    const results = await search(q, { tag });
    return c.html(<SearchPage query={q} results={results} />);
  }

  return c.html(<SearchPage />);
});

// Library page
web.get("/library", async (c) => {
  const tag = c.req.query("tag") || undefined;
  const sourceType = c.req.query("source_type") || undefined;
  const status = c.req.query("status") || undefined;
  const cursor = c.req.query("cursor") || undefined;
  const limit = 50;

  const results = await list({ tag, sourceType, status, cursor, limit: limit + 1 });

  // Check if there's a next page
  let nextCursor: string | undefined;
  if (results.length > limit) {
    results.pop();
    nextCursor = results[results.length - 1]?.id;
  }

  // Fetch all tags for the filter bar
  const allTagRows = await db.select({ name: tags.name }).from(tags);
  const allTags = allTagRows.map((t) => t.name).sort();

  return c.html(
    <LibraryPage
      results={results}
      activeTag={tag}
      activeStatus={status}
      activeSourceType={sourceType}
      allTags={allTags}
      nextCursor={nextCursor}
    />
  );
});

// Item detail page
web.get("/items/:id", async (c) => {
  const id = c.req.param("id");

  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);

  if (!item) {
    return c.html(
      <ItemPage
        item={{
          id,
          url: "",
          title: "Not Found",
          content: null,
          contentHtml: null,
          userNote: null,
          summary: null,
          sourceType: "other",
          savedAt: 0,
          processedAt: null,
          status: "failed",
          error: `Item ${id} not found.`,
          tags: [],
        }}
      />,
      404
    );
  }

  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, id));

  return c.html(
    <ItemPage
      item={{
        ...item,
        tags: tagRows.map((t) => t.name),
      }}
    />
  );
});
