// src/components/minimal-input.tsx
import React from "react";
import { Text, useInput } from "ink";

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
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) onChange(value + input);
  });

  return (
    <Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}
