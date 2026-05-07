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
    <Box flexDirection="column" paddingX={1}>
      {reason === "no-default-path" && (
        <Text>No sessions found in the default location.</Text>
      )}
      <Text>Enter a path to a directory or .jsonl file:</Text>
      <Box>
        <Text>› </Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
}
