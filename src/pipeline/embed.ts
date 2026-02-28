import { EmbeddingModel, FlagEmbedding } from "fastembed";

let model: FlagEmbedding | null = null;

async function getModel(): Promise<FlagEmbedding> {
  if (!model) {
    model = await FlagEmbedding.init({
      model: EmbeddingModel.AllMiniLML6V2,
      cacheDir: process.env.FASTEMBED_CACHE_DIR ?? "local_cache",
    });
  }
  return model;
}

/**
 * Generate a 384-dimension embedding from text.
 * Embeds: title + summary + user note (high-signal, not full content).
 */
export async function embed(
  title: string,
  summary: string,
  userNote?: string
): Promise<number[]> {
  const input = [title, summary, userNote].filter(Boolean).join(" ");

  if (!input.trim()) {
    return new Array(384).fill(0);
  }

  const m = await getModel();
  const embeddings = m.embed([input]);

  for await (const batch of embeddings) {
    // batch is an array of Float32Arrays (one per input doc)
    const vec = batch[0] ?? batch;
    return Array.from(vec as Float32Array);
  }

  return new Array(384).fill(0);
}
