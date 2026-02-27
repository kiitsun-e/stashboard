import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title"),
  content: text("content"),
  userNote: text("user_note"),
  summary: text("summary"),
  sourceType: text("source_type", {
    enum: ["article", "tweet", "video", "pdf", "other"],
  })
    .notNull()
    .default("other"),
  savedAt: integer("saved_at", { mode: "number" }).notNull(),
  processedAt: integer("processed_at", { mode: "number" }),
  status: text("status", {
    enum: ["pending", "processed", "failed"],
  })
    .notNull()
    .default("pending"),
  error: text("error"),
  embedding: text("embedding"), // JSON array of floats, cosine similarity in JS
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const itemTags = sqliteTable("item_tags", {
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  tagId: text("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});
