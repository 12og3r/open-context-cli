import React from "react";
import { Box, Text } from "ink";

const ACCENT = "cyan";
const MUTED = "gray";

export interface FeatureItem {
  id: string;
  label: string;
  icon?: string;
}

export function FeatureBar({
  items,
  selectedId,
  focused,
  width,
}: {
  items: FeatureItem[];
  selectedId: string | null;
  focused: boolean;
  width: number;
}) {
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box flexShrink={0}>
        <Text color={focused ? ACCENT : MUTED} dimColor={!focused}>
          {"─".repeat(Math.max(0, width))}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" flexShrink={0}>
        {items.map((it, idx) => {
          const isSel = it.id === selectedId;
          const active = focused && isSel;
          return (
            <Box key={it.id} marginRight={idx < items.length - 1 ? 2 : 0}>
              {active ? (
                <Text backgroundColor={ACCENT} color="black" bold>
                  {" "}{it.icon ? it.icon + " " : ""}{it.label}{" "}
                </Text>
              ) : (
                <Text color={isSel ? ACCENT : undefined} dimColor={!focused}>
                  {it.icon ? it.icon + " " : ""}{it.label}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
