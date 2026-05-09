import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { t } from "../lib/i18n.ts";
import { useLang } from "../hooks/use-lang.ts";

export function PathInput({
  reason,
  error,
  onSubmit,
}: {
  reason: "no-default-path" | "user-requested";
  error?: string;
  onSubmit: (path: string) => void;
}) {
  const lang = useLang();
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width={72}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{t(lang, "path.brand")}</Text>
        <Text dimColor>  ·  {t(lang, "path.subtitle")}</Text>
      </Box>
      {reason === "no-default-path" && (
        <Box marginBottom={1}>
          <Text dimColor>{t(lang, "path.no_default")}</Text>
        </Box>
      )}
      <Text>{t(lang, "path.prompt")}</Text>
      <Box marginTop={1}>
        <Text color="cyan">▍ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">! {error}</Text>
        </Box>
      )}
    </Box>
  );
}
