// src/components/search-bar.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function SearchBar({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
}) {
  return (
    <Box>
      {typeof label === "string" ? <Text>{label} </Text> : <>{label}<Text> </Text></>}
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
