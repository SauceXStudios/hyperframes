import { mediaSemanticRanking, type MediaVectorRow } from "./localSemantic.js";
// fallow-ignore-file unused-file
import { searchByWords } from "./localSearch.js";

export type MediaSearchRow = MediaVectorRow;

export function rankMediaRows(query: string, rows: MediaSearchRow[]): MediaSearchRow[] {
  return searchByWords(query, rows, (row) => ({
    strong: `${row.id} ${row.title}`,
    weak: `${row.description} ${row.tags.join(" ")} ${row.kind}`,
  }));
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
