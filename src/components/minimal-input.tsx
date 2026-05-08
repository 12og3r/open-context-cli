// src/components/minimal-input.tsx
import React, { useLayoutEffect, useRef } from "react";
import { Text, useStdin } from "ink";

// Minimal keypress parser sufficient for our needs.
function parseKey(raw: string): {
  name: string;
  ctrl: boolean;
  meta: boolean;
  sequence: string;
} {
  let name = "";
  let ctrl = false;
  let meta = false;

  if (raw === "\r") name = "return";
  else if (raw === "\n") name = "return";
  else if (raw === "\x1b") name = "escape";
  else if (raw === "\x7f") name = "backspace";
  else if (raw === "\x08") name = "backspace";
  else if (raw === "\x1b[A") name = "up";
  else if (raw === "\x1b[B") name = "down";
  else if (raw === "\x1b[C") name = "right";
  else if (raw === "\x1b[D") name = "left";
  else if (raw === "\x1b[3~") name = "delete";
  else if (raw.length === 1 && raw.charCodeAt(0) < 32) {
    ctrl = true;
    name = String.fromCharCode(raw.charCodeAt(0) + 64).toLowerCase();
  } else {
    name = raw;
  }

  return { name, ctrl, meta, sequence: raw };
}

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
  // Keep callbacks in refs so the stable handler always sees the latest values.
  const cbRef = useRef({ value, onChange, onSubmit, onCancel, onPrev, onNext });
  cbRef.current = { value, onChange, onSubmit, onCancel, onPrev, onNext };

  const { stdin, setRawMode, internal_eventEmitter } = useStdin() as {
    stdin: NodeJS.ReadableStream;
    setRawMode: (v: boolean) => void;
    internal_eventEmitter?: NodeJS.EventEmitter;
  };

  useLayoutEffect(() => {
    setRawMode(true);
    return () => setRawMode(false);
  }, [setRawMode]);

  useLayoutEffect(() => {
    const handler = (data: unknown) => {
      const raw = String(data);
      const kp = parseKey(raw);
      const cb = cbRef.current;

      if (kp.name === "return") {
        cb.onSubmit();
      } else if (kp.name === "escape") {
        cb.onCancel();
      } else if (kp.name === "up" || kp.name === "left") {
        cb.onPrev();
      } else if (kp.name === "down" || kp.name === "right") {
        cb.onNext();
      } else if (kp.name === "backspace" || kp.name === "delete") {
        cb.onChange(cb.value.slice(0, -1));
      } else if (!kp.ctrl && !kp.meta && raw.length >= 1 && !raw.startsWith("\x1b")) {
        cb.onChange(cb.value + raw);
      }
    };

    if (internal_eventEmitter) {
      internal_eventEmitter.on("input", handler);
      return () => { internal_eventEmitter!.off("input", handler); };
    } else {
      stdin.on("data", handler);
      return () => { stdin.off("data", handler); };
    }
  }, [stdin, internal_eventEmitter]);

  return (
    <Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}
