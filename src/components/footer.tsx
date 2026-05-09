import React from "react";
import { Box, Text } from "ink";
import { tList } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

export type FooterContext =
  | "list"
  | "preview"
  | "preview-search"
  | "feature-bar"
  | "settings"
  | "delete-confirm";

export function Footer({ context }: { context: FooterContext }) {
  const lang = useLang();
  const parts = tList(lang, `footer.${context}`);
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
