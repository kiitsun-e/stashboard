import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const DB_PATH = process.env.STASHBOARD_DB ?? "data/stashboard.db";

const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * Run migrations — creates tables if they don't exist.
 * Embeddings stored as JSON text (array of floats).
 * Cosine similarity computed in JS for local dev.
 * Switch to libSQL vector_top_k when deploying to Turso.
 */
export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      content TEXT,
      content_html TEXT,
      user_note TEXT,
      summary TEXT,
      source_type TEXT NOT NULL DEFAULT 'other',
      saved_at INTEGER NOT NULL,
      processed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      embedding TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, tag_id)
    );
  `);

  // Add content_html column for existing databases
  try {
    sqlite.exec("ALTER TABLE items ADD COLUMN content_html TEXT");
  } catch {
    // Column already exists
  }

  // Add read column for existing databases
  try {
    sqlite.exec("ALTER TABLE items ADD COLUMN read INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Add favorited column for existing databases
  try {
    sqlite.exec("ALTER TABLE items ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Add pinned column for existing databases
  try {
    sqlite.exec("ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Indexes for query performance
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_saved_at ON items(saved_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_source_type ON items(source_type);
    CREATE INDEX IF NOT EXISTS idx_item_tags_tag_id ON item_tags(tag_id);
  `);

  // One-off: clean up orphaned tags from past deletes
  sqlite.exec(
    "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)"
  );
}
