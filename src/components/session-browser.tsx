import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";
import { SessionList } from "./session-list.tsx";
import { SessionPreview } from "./session-preview.tsx";
import { SearchBar } from "./search-bar.tsx";
import { Footer, type FooterContext } from "./footer.tsx";
import { FeatureBar, type FeatureItem } from "./feature-bar.tsx";
import { SettingsPanel, applyDisplayMode } from "./settings-panel.tsx";
import { useSessionDetail } from "../hooks/use-session-detail.ts";
import { useSettings } from "../hooks/use-settings.ts";

const ACCENT = "cyan";
const MUTED = "gray";

type Focus = "list" | "preview" | "feature-bar" | "settings";
type RightView = "preview" | "settings";

const FEATURES: FeatureItem[] = [
  { id: "settings", label: "Settings", icon: "⚙" },
];

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

  const [focus, setFocus] = useState<Focus>("list");
  const [rightView, setRightView] = useState<RightView>("preview");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [committedFilter, setCommittedFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [featureIdx, setFeatureIdx] = useState(0);

  const { settings, update: updateSetting } = useSettings();

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

  // Apply the user's display-mode preference at this layer so the preview's
  // cursor / match logic operates on the filtered array. Memoized so toggling
  // the preference doesn't churn the preview's render buffer when nothing
  // changed.
  const visibleMessages = useMemo(() => {
    if (detail.status !== "ready") return [];
    return applyDisplayMode(detail.messages, settings.displayMode);
  }, [detail, settings.displayMode]);

  useInput((input, key) => {
    if (searchOpen) return;
    if (input === "q" || (key.ctrl && input === "c")) { onQuit(); return; }

    if (focus === "list") {
      if (input === "p") { onRequestPathInput(); return; }
      if (key.escape) { setFocus("feature-bar"); return; }
      if (input === "j" || key.downArrow) setSelectedIdx(i => Math.min(filtered.length - 1, i + 1));
      else if (input === "k" || key.upArrow) setSelectedIdx(i => Math.max(0, i - 1));
      else if (key.return || input === "l" || key.rightArrow) {
        if (rightView !== "preview") setRightView("preview");
        setFocus("preview");
      }
      else if (input === "/") setSearchOpen(true);
      return;
    }

    if (focus === "preview") {
      if (key.escape || input === "h" || key.leftArrow) setFocus("list");
      return;
    }

    if (focus === "feature-bar") {
      if (key.escape) { setFocus("list"); return; }
      if (input === "j" || key.downArrow || input === "l" || key.rightArrow) {
        setFeatureIdx(i => Math.min(FEATURES.length - 1, i + 1));
      } else if (input === "k" || key.upArrow || input === "h" || key.leftArrow) {
        setFeatureIdx(i => Math.max(0, i - 1));
      } else if (key.return || input === " ") {
        const f = FEATURES[featureIdx];
        if (f?.id === "settings") {
          setRightView("settings");
          setFocus("settings");
        }
      }
      return;
    }

    if (focus === "settings") {
      if (key.escape) {
        setRightView("preview");
        setFocus("list");
        return;
      }
      if (key.return) {
        // Enter == "confirm settings" — close the panel and drop the user
        // straight onto the previously-selected session's preview.
        setRightView("preview");
        setFocus("preview");
        return;
      }
      // arrow / space handling lives inside SettingsPanel
    }
  });

  const footerContext: FooterContext = searchOpen
    ? "list-search"
    : focus === "settings"
      ? "settings"
      : focus === "feature-bar"
        ? "feature-bar"
        : focus;

  const listFocused = focus === "list";
  const previewFocused = focus === "preview";

  // Inner widths (pane − 2 borders − 2 padding)
  const leftInnerWidth = leftWidth - 4;
  const rightInnerWidth = rightWidth - 4;
  // Inner heights (pane − 2 borders − 1 header − 1 spacer)
  const innerHeight = contentHeight - 4;
  // Feature bar is 2 rows (separator + button row). Pin it to the bottom of
  // the pane so empty rows stack above it rather than below — that's what makes
  // the bottom region read as a discrete panel without feeling tall.
  const featureBarHeight = 2;
  const listHeight = Math.max(1, innerHeight - featureBarHeight - (searchOpen ? 1 : 0));

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <Box flexDirection="row" flexGrow={1}>
        <Pane
          width={leftWidth}
          focused={listFocused || focus === "feature-bar"}
          accent={listFocused ? ACCENT : focus === "feature-bar" ? ACCENT : MUTED}
          title={searchOpen ? "FILTER" : "SESSIONS"}
          meta={searchOpen ? "" : `${filtered.length}`}
        >
          {searchOpen ? (
            <SearchBar
              value={filter}
              onChange={setFilter}
              onSubmit={() => { setCommittedFilter(filter); setSearchOpen(false); setSelectedIdx(0); }}
              onCancel={() => { setCommittedFilter(filter); setSearchOpen(false); }}
              onPrev={() => {}}
              onNext={() => {}}
              matchIndex={-1}
              matchCount={-1}
            />
          ) : null}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <SessionList
              sessions={filtered}
              selectedId={selected?.id ?? null}
              width={leftInnerWidth}
              height={listHeight}
            />
            {filtered.length === 0 && !searchOpen && (
              <Text dimColor>(no sessions)</Text>
            )}
          </Box>
          <FeatureBar
            items={FEATURES}
            selectedId={FEATURES[featureIdx]?.id ?? null}
            focused={focus === "feature-bar"}
            width={leftInnerWidth}
          />
        </Pane>
        <Pane
          width={rightWidth}
          focused={previewFocused || focus === "settings"}
          accent={previewFocused ? ACCENT : focus === "settings" ? ACCENT : MUTED}
          title={rightView === "settings" ? "SETTINGS" : "PREVIEW"}
          meta={
            rightView === "settings"
              ? ""
              : selected
                ? truncateProject(selected.projectPath, rightInnerWidth - 16)
                : ""
          }
        >
          {rightView === "settings" ? (
            <SettingsPanel
              settings={settings}
              onChange={updateSetting}
              focused={focus === "settings"}
              width={rightInnerWidth}
              height={innerHeight}
            />
          ) : (
            <>
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
                  messages={visibleMessages}
                  sessionId={selected?.id ?? null}
                  focused={previewFocused}
                  height={innerHeight}
                  width={rightInnerWidth}
                  emoji={emoji}
                  showHash={settings.showHash}
                />
              )}
            </>
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
  accent,
  title,
  meta,
  children,
}: {
  width: number;
  focused: boolean;
  accent: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={focused ? accent : MUTED}
      paddingX={1}
    >
      <Box flexShrink={0}>
        <Text color={focused ? accent : undefined} bold={focused}>
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
