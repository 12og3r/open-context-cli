import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";
import { SessionList } from "./session-list.tsx";
import { SessionPreview } from "./session-preview.tsx";
import { SearchBar } from "./search-bar.tsx";
import { Footer, type FooterContext } from "./footer.tsx";
import { useSessionDetail } from "../hooks/use-session-detail.ts";

const ACCENT = "cyan";
const MUTED = "gray";

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
  const leftWidth = Math.min(40, Math.max(28, Math.floor(termWidth * 0.32)));
  const rightWidth = termWidth - leftWidth;
  const contentHeight = termHeight - 2; // footer + 1 spacing line

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

  const footerContext: FooterContext = searchOpen ? "list-search" : focus;
  const listFocused = focus === "list";
  const previewFocused = focus === "preview";

  // Inner widths (pane − 2 borders − 2 padding)
  const leftInnerWidth = leftWidth - 4;
  const rightInnerWidth = rightWidth - 4;
  // Inner heights (pane − 2 borders − 1 header − 1 spacer)
  const innerHeight = contentHeight - 4;

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <Box flexDirection="row" flexGrow={1}>
        <Pane
          width={leftWidth}
          focused={listFocused}
          title={searchOpen ? "FILTER" : "SESSIONS"}
          meta={searchOpen ? "" : `${filtered.length}`}
        >
          {searchOpen ? (
            <SearchBar
              label={<Text color={ACCENT}>›</Text>}
              value={filter}
              onChange={setFilter}
              onSubmit={(v) => { setCommittedFilter(v); setSearchOpen(false); setSelectedIdx(0); }}
            />
          ) : null}
          <SessionList
            sessions={filtered}
            selectedId={selected?.id ?? null}
            width={leftInnerWidth}
            height={innerHeight - (searchOpen ? 1 : 0)}
          />
          {filtered.length === 0 && !searchOpen && (
            <Text dimColor>(no sessions)</Text>
          )}
        </Pane>
        <Pane
          width={rightWidth}
          focused={previewFocused}
          title="PREVIEW"
          meta={selected ? truncateProject(selected.projectPath, rightInnerWidth - 16) : ""}
        >
          {detail.status === "loading" && (
            <Box>
              <Text color={ACCENT}><Spinner /></Text>
              <Text dimColor> loading messages…</Text>
            </Box>
          )}
          {detail.status === "error" && (
            <Text color="red">! {detail.error.message}</Text>
          )}
          {detail.status === "ready" && (
            <SessionPreview
              messages={detail.messages}
              sessionId={selected?.id ?? null}
              focused={previewFocused}
              height={innerHeight}
              width={rightInnerWidth}
              emoji={emoji}
            />
          )}
        </Pane>
      </Box>
      <Footer context={footerContext} />
    </Box>
  );
}

function Pane({
  width,
  focused,
  title,
  meta,
  children,
}: {
  width: number;
  focused: boolean;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={focused ? ACCENT : MUTED}
      paddingX={1}
    >
      <Box flexShrink={0}>
        <Text color={focused ? ACCENT : undefined} bold={focused}>
          {title}
        </Text>
        {meta && (
          <Text dimColor>{"  "}{meta}</Text>
        )}
      </Box>
      <Box height={1} flexShrink={0} />
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}

function truncateProject(p: string, max: number): string {
  if (!p) return "";
  if (p.length <= max) return p;
  if (max < 4) return "…";
  return "…" + p.slice(p.length - (max - 1));
}
