export type JsonlEntry =
  | { line: number; value: unknown }
  | { line: number; error: Error; raw: string };

export async function* parseJsonlStream(
  chunks: AsyncIterable<string>,
): AsyncIterable<JsonlEntry> {
  let buf = "";
  let line = 0;
  for await (const chunk of chunks) {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      line += 1;
      if (raw.length === 0) continue;
      yield parseLine(raw, line);
    }
  }
  if (buf.length > 0) {
    line += 1;
    yield parseLine(buf, line);
  }
}

function parseLine(raw: string, line: number): JsonlEntry {
  try {
    return { line, value: JSON.parse(raw) };
  } catch (e) {
    return { line, error: e as Error, raw };
  }
}
