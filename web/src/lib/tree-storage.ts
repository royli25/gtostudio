/**
 * Upload/download full solved game trees to/from Supabase Storage.
 *
 * Flow:
 *   1. After solving, call `solver_extract_tree` to get all decision nodes.
 *   2. Call `uploadTree(spotId, nodes)` to compress and upload to Supabase Storage.
 *   3. The simulator calls `downloadTree(spotId)` to pull and decompress.
 */

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { SolveResults } from "@/lib/poker";

const BUCKET = "solutions";

/** Compress JSON string to gzip Uint8Array using the browser's CompressionStream API. */
async function compressGzip(data: string): Promise<Uint8Array> {
  const blob = new Blob([data]);
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Decompress gzip Uint8Array to string using the browser's DecompressionStream API. */
async function decompressGzip(data: Uint8Array): Promise<string> {
  const blob = new Blob([data as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/**
 * Upload an extracted tree to Supabase Storage.
 * Returns the storage path for later retrieval.
 */
export async function uploadTree(
  spotId: string,
  nodes: SolveResults[],
): Promise<{ path: string; sizeBytes: number; compressedBytes: number }> {
  const json = JSON.stringify(nodes);
  const compressed = await compressGzip(json);

  const path = `trees/${spotId}.json.gz`;
  const supabase = createBrowserSupabaseClient();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, {
      contentType: "application/gzip",
      upsert: true,
    });

  if (error) throw new Error(`Failed to upload tree: ${error.message}`);

  return {
    path,
    sizeBytes: json.length,
    compressedBytes: compressed.length,
  };
}

/**
 * Download and decompress a tree from Supabase Storage.
 * Returns the array of SolveResults nodes.
 */
export async function downloadTree(
  spotId: string,
): Promise<SolveResults[]> {
  const path = `trees/${spotId}.json.gz`;
  const supabase = createBrowserSupabaseClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (error) throw new Error(`Failed to download tree: ${error.message}`);
  if (!data) throw new Error("Downloaded tree is empty");

  const buffer = new Uint8Array(await data.arrayBuffer());
  const json = await decompressGzip(buffer);
  return JSON.parse(json) as SolveResults[];
}

/**
 * List all uploaded tree files.
 */
export async function listTrees(): Promise<string[]> {
  const supabase = createBrowserSupabaseClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("trees", { limit: 1000 });

  if (error) throw new Error(`Failed to list trees: ${error.message}`);

  return (data ?? [])
    .filter((f) => f.name.endsWith(".json.gz"))
    .map((f) => f.name.replace(".json.gz", ""));
}
