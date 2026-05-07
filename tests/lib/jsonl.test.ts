import { describe, expect, test } from "bun:test";
import { parseJsonlStream } from "../../src/lib/jsonl.ts";

async function* lines(s: string): AsyncIterable<string> {
  // Simulate chunked reads by yielding the whole file then EOF.
  yield s;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("parseJsonlStream", () => {
  test("parses a normal file", async () => {
    const data = `{"a":1}\n{"a":2}\n{"a":3}\n`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result.map(r => "value" in r ? r.value : null)).toEqual([
      { a: 1 }, { a: 2 }, { a: 3 },
    ]);
  });

  test("reports malformed lines without aborting", async () => {
    const data = `{"a":1}\nNOT JSON\n{"a":3}\n`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result).toHaveLength(3);
    expect("value" in result[0]!).toBe(true);
    expect("error" in result[1]!).toBe(true);
    expect("value" in result[2]!).toBe(true);
  });

  test("handles missing trailing newline", async () => {
    const data = `{"a":1}\n{"a":2}`;
    const result = await collect(parseJsonlStream(lines(data)));
    expect(result).toHaveLength(2);
  });

  test("handles split chunks", async () => {
    async function* split(): AsyncIterable<string> {
      yield `{"a":1}\n{"a`;
      yield `":2}\n`;
    }
    const result = await collect(parseJsonlStream(split()));
    expect(result.map(r => "value" in r ? r.value : null)).toEqual([
      { a: 1 }, { a: 2 },
    ]);
  });
});
