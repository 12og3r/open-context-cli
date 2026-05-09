// src/components/message-block.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Message, Role } from "../providers/types.ts";
import { localTimeOfDay, relativeTime } from "../lib/relative-time.ts";
import { markdownToAnsi } from "../lib/markdown-ansi.ts";
import { useLang } from "../hooks/use-lang.ts";
import { t, type Lang } from "../lib/i18n.ts";

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
  current = false,
  now = new Date(),
}: {
  message: Message;
  expanded: boolean;
  emoji?: boolean;
  current?: boolean;
  now?: Date;
}) {
  const lang = useLang();
  const headerLabel = headerFor(message, lang);
  const time = relativeTime(message.timestamp, now, lang);
  const clock = localTimeOfDay(message.timestamp);
  const headerText = `${emoji ? ROLE_EMOJI[message.role] + " " : ""}${headerLabel}`;
  const color = ROLE_COLOR[message.role];
  const isPrimary = message.role === "user" || message.role === "assistant";
  const isMuted = message.role === "system" || message.role === "tool_result";
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Text>
        <Text color="cyan" bold>{current ? "› " : "  "}</Text>
        <Text color={color} bold={isPrimary}>▍ </Text>
        <Text
          color={color}
          bold={isPrimary || current}
          italic={message.role === "system"}
          dimColor={isMuted && !current}
        >
          {headerText}
        </Text>
        <Text dimColor>  ·  {time}  ·  {clock}</Text>
      </Text>
      <Box paddingLeft={4}>
        <Body message={message} expanded={expanded} />
      </Box>
    </Box>
  );
}

function headerFor(m: Message, lang: Lang): string {
  switch (m.role) {
    case "tool_use": return m.toolName ?? t(lang, "role.tool");
    case "tool_result": return t(lang, "role.tool_result");
    default: return t(lang, `role.${m.role}`);
  }
}

function Body({ message, expanded }: { message: Message; expanded: boolean }) {
  if (message.role === "tool_use" || message.role === "tool_result") {
    const content = message.content || "";
    const lines = content.split("\n");
    const lineCount = lines.length;
    if (lineCount <= 1) {
      return <Text dimColor wrap="truncate">{content}</Text>;
    }
    if (!expanded) {
      return <Text dimColor wrap="truncate">{`▸ ${lines[0] ?? ""}  (${lineCount} lines)`}</Text>;
    }
    return <Text dimColor>{`▾ ${content}`}</Text>;
  }
  if (message.role === "system") {
    return <Text dimColor italic>{message.content}</Text>;
  }
  return <Text>{markdownToAnsi(message.content)}</Text>;
}
