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
  readOnly = false,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
  matchIndex: number;
  // matchCount < 0 suppresses the counter — used by the session-list filter
  // where the bar is a filter, not a navigable search. The pill label flips
  // to "FILTER" in that case.
  matchCount: number;
  // readOnly drops the input + cursor and shows a dimmed echo of `value`.
  // Used during afterglow so the user can still see what they searched for
  // and which match is current.
  readOnly?: boolean;
}) {
  const showCounter = matchCount >= 0;
  const hasQuery = value.length > 0;
  const zero = showCounter && hasQuery && matchCount === 0;
  const label = matchCount < 0 ? " FILTER " : " SEARCH ";
  const pillBg = zero ? "red" : "cyan";

  return (
    <Box>
      <Box marginRight={1}>
        <Text backgroundColor={pillBg} color="black" bold>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        {readOnly ? (
          <Text dimColor>{value}</Text>
        ) : (
          <MinimalInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            onCancel={onCancel}
            onPrev={onPrev}
            onNext={onNext}
          />
        )}
      </Box>
      {showCounter && hasQuery && (
        <Box marginLeft={2}>
          {zero ? (
            <Text color="red" bold>no matches</Text>
          ) : (
            <Text dimColor>{matchIndex + 1} / {matchCount}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
