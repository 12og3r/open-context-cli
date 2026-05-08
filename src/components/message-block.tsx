// src/components/message-block.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Message, Role } from "../providers/types.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { markdownToAnsi } from "../lib/markdown-ansi.ts";

const ROLE_EMOJI: Record<Role, string> = {
  user: "👨",
  assistant: "🤖",
  tool_use: "🔧",
  tool_result: "📥",
  system: "ℹ️ ",
};

const ROLE_COLOR: Record<Role, string> = {
  user: "cyan",
  assistant: "magenta",
  tool_use: "yellow",
  tool_result: "gray",
  system: "gray",
};

export function MessageBlock({
  message,
  expanded,
  emoji = true,
  now = new Date(),
}: {
  message: Message;
  expanded: boolean;
  emoji?: boolean;
  now?: Date;
}) {
  const headerLabel = headerFor(message);
  const time = relativeTime(message.timestamp, now);
  const headerText = `${emoji ? ROLE_EMOJI[message.role] + " " : ""}${headerLabel}`;
  const color = ROLE_COLOR[message.role];
  const isPrimary = message.role === "user" || message.role === "assistant";
  const isMuted = message.role === "system" || message.role === "tool_result";
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Text>
        <Text color={color} bold={isPrimary}>▍ </Text>
        <Text
          color={color}
          bold={isPrimary}
          italic={message.role === "system"}
          dimColor={isMuted}
        >
          {headerText}
        </Text>
        <Text dimColor>  ·  {time}</Text>
      </Text>
      <Box paddingLeft={2}>
        <Body message={message} expanded={expanded} />
      </Box>
    </Box>
  );
}

function headerFor(m: Message): string {
  switch (m.role) {
    case "tool_use": return `${m.toolName ?? "tool"}`;
    case "tool_result": return `result`;
    default: return m.role;
  }
}

function Body({ message, expanded }: { message: Message; expanded: boolean }) {
  if (message.role === "tool_use" || message.role === "tool_result") {
    if (!expanded) {
      const oneLine = (message.content || "").split("\n")[0] ?? "";
      const lineCount = (message.content || "").split("\n").length;
      const tail = lineCount > 1 ? `  (${lineCount} lines)` : "";
      return <Text dimColor wrap="truncate">{`▸ ${oneLine}${tail}`}</Text>;
    }
    return <Text dimColor>{message.content}</Text>;
  }
  if (message.role === "system") {
    return <Text dimColor italic>{message.content}</Text>;
  }
  return <Text>{markdownToAnsi(message.content)}</Text>;
}
