import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function PathInput({
  reason,
  error,
  onSubmit,
}: {
  reason: "no-default-path" | "user-requested";
  error?: string;
  onSubmit: (path: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width={72}>
      <Box marginBottom={1}>
        <Text bold color="cyan">claude-history</Text>
        <Text dimColor>  ·  session browser</Text>
      </Box>
      {reason === "no-default-path" && (
        <Box marginBottom={1}>
          <Text dimColor>No sessions found in the default location.</Text>
        </Box>
      )}
      <Text>Enter a path to a directory or .jsonl file</Text>
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
