import { mediaSemanticRanking, type MediaVectorRow } from "./localSemantic.js";
import { rankMediaRows as rankMediaRowsRuntime } from "./mediaSearch.mjs";

export type MediaSearchRow = MediaVectorRow;

export function rankMediaRows(query: string, rows: MediaSearchRow[]): MediaSearchRow[] {
  return rankMediaRowsRuntime(query, rows) as MediaSearchRow[];
}

export async function rankMediaRowsWithVectors(
  query: string,
  rows: MediaSearchRow[],
): Promise<{ rows: MediaSearchRow[]; tier: "words" | "on-device" }> {
  const words = rankMediaRows(query, rows);
  if (words.length > 0) return { rows: words, tier: "words" };
  const semantic = await mediaSemanticRanking(query);
  return semantic
    ? { rows: semantic.map(({ row }) => row), tier: "on-device" }
    : { rows: [], tier: "words" };
}
