// tests/components/search-bar.test.tsx
import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { SearchBar } from "../../src/components/search-bar.tsx";

const tick = () => new Promise(r => setTimeout(r, 30));

function Harness(props: {
  matchIndex?: number;
  matchCount?: number;
}) {
  const [value, setValue] = useState("useState");
  return (
    <SearchBar
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      onCancel={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
      matchIndex={props.matchIndex ?? 0}
      matchCount={props.matchCount ?? 0}
    />
  );
}

describe("SearchBar", () => {
  test("renders the SEARCH pill and the typed query", () => {
    const { lastFrame } = render(<Harness matchCount={5} matchIndex={2} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("SEARCH");
    expect(out).toContain("useState");
  });

  test("shows the counter when there are matches", () => {
    const { lastFrame } = render(<Harness matchIndex={2} matchCount={5} />);
    expect(lastFrame() ?? "").toContain("3 / 5");
  });

  test("shows 'no matches' instead of a counter when there are zero matches", () => {
    const { lastFrame } = render(<Harness matchIndex={-1} matchCount={0} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("no matches");
    expect(out).not.toContain("0 / 0");
  });

  test("uses a FILTER pill when matchCount is negative", () => {
    const { lastFrame } = render(<Harness matchIndex={-1} matchCount={-1} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("FILTER");
    expect(out).not.toContain("SEARCH");
  });
});
