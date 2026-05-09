import React from "react";
import { Box, Text } from "ink";
import type { SessionMeta } from "../providers/types.ts";
import { truncate } from "../lib/truncate.ts";
import { t } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

const ACCENT = "cyan";
const DANGER = "red";

export type DeleteChoice = "cancel" | "delete";

export function DeleteConfirm({
  session,
  cursor,
  width,
  height,
  busy,
  error,
}: {
  session: SessionMeta;
  cursor: DeleteChoice;
  width: number;
  height: number;
  busy?: boolean;
  error?: string | null;
}) {
  const lang = useLang();
  const summaryLabel = t(lang, "delete.summary_label");
  const pathLabel = t(lang, "delete.path_label");
  // Reserve enough room so the value stays on a single line; pick the longer
  // label so both rows align even when one is wider than the other.
  const labelWidth = Math.max(summaryLabel.length, pathLabel.length);
  const valueWidth = Math.max(8, width - labelWidth);
  const cancel = t(lang, "delete.cancel");
  const del = t(lang, "delete.delete");

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box marginBottom={1} flexShrink={0}>
        <Text color={DANGER} bold>{t(lang, "delete.prompt")}</Text>
      </Box>

      <Box flexShrink={0}>
        <Text dimColor>{summaryLabel}</Text>
        <Text>{truncate(session.summary || session.id, valueWidth)}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{pathLabel}</Text>
        <Text dimColor>{truncate(session.filePath, valueWidth)}</Text>
      </Box>

      <Box marginTop={1} flexShrink={0}>
        <Text color={DANGER}>{t(lang, "delete.warning")}</Text>
      </Box>

      <Box marginTop={1} flexDirection="row" flexShrink={0}>
        <Box marginRight={2}>
          {cursor === "cancel" ? (
            <Text backgroundColor={ACCENT} color="black" bold>{` ${cancel} `}</Text>
          ) : (
            <Text>{`  ${cancel}  `}</Text>
          )}
        </Box>
        {cursor === "delete" ? (
          <Text backgroundColor={DANGER} color="black" bold>{` ${del} `}</Text>
        ) : (
          <Text color={DANGER}>{`  ${del}  `}</Text>
        )}
      </Box>

      <Box marginTop={1} flexShrink={0}>
        {busy ? (
          <Text dimColor>{t(lang, "loading.deleting")}</Text>
        ) : error ? (
          <Text color={DANGER}>! {error}</Text>
        ) : (
          <Text dimColor>{t(lang, "delete.help")}</Text>
        )}
      </Box>
    </Box>
  );
}
