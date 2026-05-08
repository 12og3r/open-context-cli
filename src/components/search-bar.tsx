// src/components/search-bar.tsx
import React from "react";
import { Box, Text } from "ink";
import { MinimalInput } from "./minimal-input.tsx";

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPrev,
  onNext,
  matchIndex,
  matchCount,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
  matchIndex: number;
  matchCount: number;
}) {
  const showCounter = matchCount >= 0;
  const hasQuery = value.length > 0;
  const zero = showCounter && hasQuery && matchCount === 0;
  const counterText = !showCounter
    ? ""
    : !hasQuery
      ? ""
      : matchCount === 0
        ? "0 / 0"
        : `${matchIndex + 1} / ${matchCount}`;

  return (
    <Box>
      <Text color={zero ? "red" : "cyan"}>🔎 </Text>
      <Box flexGrow={1}>
        <MinimalInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          onPrev={onPrev}
          onNext={onNext}
        />
      </Box>
      <Box marginLeft={1}>
        <Text color={zero ? "red" : "gray"}>{counterText}</Text>
      </Box>
    </Box>
  );
}
