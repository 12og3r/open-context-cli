// src/components/footer.tsx
import React from "react";
import { Box, Text } from "ink";

export type FooterContext =
  | "list"
  | "preview"
  | "list-search"
  | "preview-search"
  | "path-input";

const HINTS: Record<FooterContext, string> = {
  "list":           " ↑/↓ select   Enter focus preview   / search   p path   q quit ",
  "preview":        " ↑/↓ scroll   Esc back   ⌃F search-in-preview   Tab expand tool   q quit ",
  "list-search":    " type to filter   Enter apply   Esc cancel ",
  "preview-search": " type to search   Enter commit   Esc cancel ",
  "path-input":     " type a path   Enter submit   Esc quit ",
};

export function Footer({ context }: { context: FooterContext }) {
  return (
    <Box>
      <Text inverse>{HINTS[context]}</Text>
    </Box>
  );
}
