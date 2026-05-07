// src/components/session-browser.tsx
import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";
import { SessionList } from "./session-list.tsx";
import { SessionPreview } from "./session-preview.tsx";
import { SearchBar } from "./search-bar.tsx";
import { Footer, type FooterContext } from "./footer.tsx";
import { useSessionDetail } from "../hooks/use-session-detail.ts";

export function SessionBrowser({
  provider,
  sessions,
  emoji,
  onRequestPathInput,
  onQuit,
}: {
  provider: SessionProvider;
  sessions: SessionMeta[];
  emoji: boolean;
  onRequestPathInput: () => void;
  onQuit: () => void;
}) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 100;
  const termHeight = stdout?.rows ?? 30;
  const leftWidth = Math.min(36, Math.floor(termWidth * 0.35));
  const rightWidth = termWidth - leftWidth - 1;
  const contentHeight = termHeight - 1; // footer

  const [focus, setFocus] = useState<"list" | "preview">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [committedFilter, setCommittedFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!committedFilter) return sessions;
    const q = committedFilter.toLowerCase();
    return sessions.filter(s =>
      s.summary.toLowerCase().includes(q) ||
      s.projectPath.toLowerCase().includes(q),
    );
  }, [sessions, committedFilter]);

  const selected = filtered[Math.min(selectedIdx, filtered.length - 1)] ?? null;
  const detail = useSessionDetail(provider, selected);

  useInput((input, key) => {
    if (searchOpen) return;
    if (input === "q" || (key.ctrl && input === "c")) { onQuit(); return; }
    if (input === "p") { onRequestPathInput(); return; }
    if (focus === "list") {
      if (input === "j" || key.downArrow) setSelectedIdx(i => Math.min(filtered.length - 1, i + 1));
      else if (input === "k" || key.upArrow) setSelectedIdx(i => Math.max(0, i - 1));
      else if (key.return || input === "l" || key.rightArrow) setFocus("preview");
      else if (input === "/") setSearchOpen(true);
    } else {
      if (key.escape || input === "h" || key.leftArrow) setFocus("list");
    }
  });

  const footerContext: FooterContext =
    searchOpen ? "list-search" : focus;

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <Box flexDirection="row" flexGrow={1}>
        <Box
          flexDirection="column"
          width={leftWidth}
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
        >
          {searchOpen ? (
            <SearchBar
              label="/"
              value={filter}
              onChange={setFilter}
              onSubmit={(v) => { setCommittedFilter(v); setSearchOpen(false); setSelectedIdx(0); }}
            />
          ) : (
            <Text bold>Sessions ({filtered.length})</Text>
          )}
          <SessionList
            sessions={filtered}
            selectedId={selected?.id ?? null}
            width={leftWidth}
          />
        </Box>
        <Box flexDirection="column" width={rightWidth}>
          <Text bold>Preview</Text>
          {detail.status === "loading" && <Text dimColor>Loading…</Text>}
          {detail.status === "error" && <Text color="red">{detail.error.message}</Text>}
          {(detail.status === "ready" || detail.status === "loading") && (
            <SessionPreview
              messages={"messages" in detail ? detail.messages : detail.partial}
              focused={focus === "preview"}
              height={contentHeight - 2}
              width={rightWidth}
              emoji={emoji}
            />
          )}
        </Box>
      </Box>
      <Footer context={footerContext} />
    </Box>
  );
}
