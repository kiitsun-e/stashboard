import { migrate } from "../db";
import { saveUrl, processItem, processAll, reclassifyTweets, rerenderTweetArticles } from "../pipeline/save";
import { search, list } from "../pipeline/search";

const HELP = `
stash — save and search your reading

Usage:
  stash save <url> [--note "..."]     Save a URL
  stash search <query>                Semantic search
  stash list [--tag <tag>]            Browse saved items
  stash open <id>                     Open original URL in browser
  stash read <id>                     View extracted content
  stash retry [id]                    Reprocess failed/pending items
  stash reclassify                    Reclassify existing tweets
  stash help                          Show this help
`.trim();

function parseArgs(args: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string>;
} {
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] ?? "";
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function main() {
  await migrate();

  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "save": {
      const url = positional[0];
      if (!url) {
        console.error("Usage: stash save <url> [--note '...']");
        process.exit(1);
      }

      try {
        new URL(url);
      } catch {
        console.error(`Invalid URL: ${url}`);
        process.exit(1);
      }

      const result = await saveUrl(url, flags.note);
      if (result.existing) {
        console.log(`Already saved (${result.status}): ${result.id}`);
      } else {
        console.log(`Saved: ${result.id}`);
        console.log("Processing...");
        try {
          await processItem(result.id);
        } catch (e: any) {
          console.error(`Processing failed: ${e.message}`);
          console.log("You can retry later with: stash retry " + result.id);
        }
      }
      break;
    }

    case "search": {
      const query = positional.join(" ");
      if (!query) {
        console.error("Usage: stash search <query>");
        process.exit(1);
      }

      console.log(`Searching for: "${query}"\n`);
      const results = await search(query, { tag: flags.tag });

      if (results.length === 0) {
        console.log("No results found.");
        break;
      }

      for (const r of results) {
        const sim = r.similarity != null ? ` (${(r.similarity * 100).toFixed(0)}%)` : "";
        console.log(`${r.id}${sim}`);
        console.log(`  ${r.title ?? "(no title)"}`);
        if (r.summary) console.log(`  ${r.summary}`);
        if (r.tags.length) console.log(`  [${r.tags.join(", ")}]`);
        if (r.userNote) console.log(`  Note: ${r.userNote}`);
        console.log(`  ${r.url}`);
        console.log(`  Saved ${formatDate(r.savedAt)}`);
        console.log();
      }
      break;
    }

    case "list": {
      const results = await list({
        tag: flags.tag,
        sourceType: flags.type,
        status: flags.status,
      });

      if (results.length === 0) {
        console.log("No items saved yet.");
        break;
      }

      for (const r of results) {
        const status = r.status === "processed" ? "" : ` [${r.status}]`;
        console.log(`${r.id}${status}`);
        console.log(`  ${r.title ?? "(no title)"}`);
        if (r.tags.length) console.log(`  [${r.tags.join(", ")}]`);
        if (r.userNote) console.log(`  Note: ${r.userNote}`);
        console.log(`  ${r.url}`);
        console.log(`  Saved ${formatDate(r.savedAt)}`);
        console.log();
      }
      break;
    }

    case "open": {
      const id = positional[0];
      if (!id) {
        console.error("Usage: stash open <id>");
        process.exit(1);
      }

      const results = await list();
      const item = results.find((r) => r.id === id || r.id.startsWith(id));
      if (!item) {
        console.error(`Item not found: ${id}`);
        process.exit(1);
      }

      // Open in default browser
      const proc = Bun.spawn(["open", item.url]);
      await proc.exited;
      console.log(`Opened: ${item.url}`);
      break;
    }

    case "read": {
      const id = positional[0];
      if (!id) {
        console.error("Usage: stash read <id>");
        process.exit(1);
      }

      const { db: database } = await import("../db");
      const { items: itemsTable } = await import("../db/schema");
      const { eq } = await import("drizzle-orm");

      const [item] = await database
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, id))
        .limit(1);

      if (!item) {
        console.error(`Item not found: ${id}`);
        process.exit(1);
      }

      console.log(`# ${item.title ?? "(no title)"}\n`);
      console.log(`URL: ${item.url}`);
      if (item.userNote) console.log(`Note: ${item.userNote}`);
      if (item.summary) console.log(`\nSummary: ${item.summary}`);
      console.log(`\n---\n`);
      console.log(item.content ?? "(no content extracted)");
      break;
    }

    case "retry": {
      const id = positional[0];
      if (id) {
        console.log(`Retrying ${id}...`);
        try {
          await processItem(id);
          console.log("Done.");
        } catch (e: any) {
          console.error(`Failed: ${e.message}`);
        }
      } else {
        console.log("Retrying all pending/failed items...");
        const count = await processAll();
        console.log(`Processed ${count} items.`);
      }
      break;
    }

    case "reclassify": {
      console.log("Reclassifying existing tweets...");
      const count = await reclassifyTweets();
      console.log(`Reclassified ${count} item${count !== 1 ? "s" : ""}.`);
      break;
    }

    case "rerender-articles": {
      console.log("Re-rendering tweet-article HTML from markdown...");
      const count = await rerenderTweetArticles();
      console.log(`Re-rendered ${count} item${count !== 1 ? "s" : ""}.`);
      break;
    }

    case "help":
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
