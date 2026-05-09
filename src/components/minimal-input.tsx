// src/components/minimal-input.tsx
import React from "react";
import { Box, Text, useInput } from "ink";

export function MinimalInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPrev,
  onNext,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useInput((input, key) => {
    if (key.return) onSubmit();
    else if (key.escape) onCancel();
    else if (key.upArrow || key.leftArrow) onPrev();
    else if (key.downArrow || key.rightArrow) onNext();
    else if (key.backspace || key.delete) onChange(sliceLastChar(value));
    else if (input && !key.ctrl && !key.meta) onChange(value + input);
  });

  // The value and the cursor live in sibling <Text> elements inside a <Box>
  // rather than as nested <Text> children. Ink's layout breaks when a nested
  // styled <Text> sits next to CJK content, blanking the whole element.
  return (
    <Box>
      <Text>{value}</Text>
      <Text inverse> </Text>
    </Box>
  );
}

// Drop the last user-visible character. `value.slice(0, -1)` works on UTF-16
// code units, which orphans half of any non-BMP char (most emoji). Iterating
// with the spread/`for…of` operator yields code points, so a single backspace
// always erases one rendered grapheme for BMP and SMP characters alike.
function sliceLastChar(s: string): string {
  if (!s) return s;
  const chars = [...s];
  chars.pop();
  return chars.join("");
}
