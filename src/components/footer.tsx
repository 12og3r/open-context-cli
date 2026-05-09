import React from "react";
import { Box, Text } from "ink";

export type FooterContext =
  | "list"
  | "preview"
  | "list-search"
  | "preview-search"
  | "path-input"
  | "feature-bar"
  | "settings";

const HINTS: Record<FooterContext, string[]> = {
  "list":           ["↑↓ select", "⏎ focus preview", "/ search", "esc menu", "p path", "q quit"],
  "preview":        ["↑↓ scroll", "esc back", "⌃F find", "⇥ expand tool", "q quit"],
  "list-search":    ["type to filter", "⏎ apply", "esc cancel"],
  "preview-search": ["type to search", "⏎ commit", "esc cancel"],
  "path-input":     ["type a path", "⏎ submit", "esc quit"],
  "feature-bar":    ["←→ pick", "⏎ open", "esc back"],
  "settings":       ["↑↓ field", "←→ cursor", "space apply", "⏎ confirm", "esc back"],
};

export function Footer({ context }: { context: FooterContext }) {
  const parts = HINTS[context];
  return (
    <Box paddingX={2}>
      <Text dimColor>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && "  ·  "}
            {p}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
