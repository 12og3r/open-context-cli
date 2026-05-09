import React, { useMemo, useState } from "react";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { SessionMeta, SessionProvider } from "../providers/types.ts";
import type { ContinueRequest } from "../lib/continue-types.ts";
import { decodeProjectPath } from "../lib/decode-project-path.ts";
import { SessionList } from "./session-list.tsx";
import { SessionPreview } from "./session-preview.tsx";
import { SearchBar } from "./search-bar.tsx";
import { Footer, type FooterContext } from "./footer.tsx";
import { FeatureBar, type FeatureItem } from "./feature-bar.tsx";
import { SettingsPanel, applyDisplayMode } from "./settings-panel.tsx";
import { DeleteConfirm, type DeleteChoice } from "./delete-confirm.tsx";
import { useSessionDetail } from "../hooks/use-session-detail.ts";
import type { Settings } from "../lib/settings.ts";
import { useLang } from "../hooks/use-lang.ts";
import { t } from "../lib/i18n.ts";

const ACCENT = "cyan";
const DANGER = "red";
const MUTED = "gray";

type Focus = "list" | "preview" | "feature-bar" | "settings" | "delete-confirm";
type RightView = "preview" | "settings" | "delete-confirm";

export function SessionBrowser({
  provider,
  sessions,
  emoji,
  settings,
  updateSetting,
  onRequestPathInput,
  onQuit,
  onSessionRemoved,
  onRequestContinue,
}: {
  provider: SessionProvider;
  sessions: SessionMeta[];
  emoji: boolean;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onRequestPathInput: () => void;
  onQuit: () => void;
  onSessionRemoved?: (id: string) => void;
  onRequestContinue?: (req: ContinueRequest) => void;
}) {
  const lang = useLang();
  // Width-stable Unicode icons (each 1 cell across all major terminals).
  // Avoid emoji (⚙ / 🗑) — string-width reports them as 1 cell but most
  // terminals render them as 2, which would misalign the left pane's right
  // border with the right pane's left border on this row.
  const FEATURES: FeatureItem[] = [
    { id: "settings", label: t(lang, "feature.settings"), icon: "≡" },
    { id: "delete", label: t(lang, "feature.delete"), icon: "×" },
  ];
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

  // Delete-confirm dialog state. `target` is the session pinned at the moment
  // the user opened the dialog; we hold it locally so the visible "Delete this
  // session?" text doesn't shift if the list re-orders or the cursor moves.
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null);
  const [deleteCursor, setDeleteCursor] = useState<DeleteChoice>("cancel");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      if (key.tab) { setFocus("feature-bar"); return; }
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
      if (key.tab) {
        // Tab cycles within the bar (wraps); only Esc leaves.
        setFeatureIdx(i => (i + 1) % FEATURES.length);
        return;
      }
      if (input === "j" || key.downArrow || input === "l" || key.rightArrow) {
        setFeatureIdx(i => Math.min(FEATURES.length - 1, i + 1));
      } else if (input === "k" || key.upArrow || input === "h" || key.leftArrow) {
        setFeatureIdx(i => Math.max(0, i - 1));
      } else if (key.return || input === " ") {
        const f = FEATURES[featureIdx];
        if (f?.id === "settings") {
          setRightView("settings");
          setFocus("settings");
        } else if (f?.id === "delete") {
          if (!selected) return;
          setDeleteTarget(selected);
          setDeleteCursor("cancel");
          setDeleteError(null);
          setRightView("delete-confirm");
          setFocus("delete-confirm");
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

    if (focus === "delete-confirm") {
      if (deleteBusy) return;
      if (key.escape) { closeDeleteDialog(); return; }
      if (key.leftArrow || input === "h") setDeleteCursor("cancel");
      else if (key.rightArrow || input === "l") setDeleteCursor("delete");
      else if (key.return) {
        if (deleteCursor === "cancel" || !deleteTarget) {
          closeDeleteDialog();
        } else {
          void confirmDelete(deleteTarget);
        }
      }
      return;
    }
  });

  function closeDeleteDialog() {
    setRightView("preview");
    setFocus("feature-bar");
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleteBusy(false);
  }

  async function confirmDelete(target: SessionMeta) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await fs.unlink(target.filePath);
    } catch (err: unknown) {
      setDeleteBusy(false);
      setDeleteError((err as Error).message || "delete failed");
      return;
    }
    // Selection follows the same index — sessions shift up by one on removal,
    // so the next session naturally takes the slot. Clamp at the new end.
    const removingFiltered = filtered.findIndex(s => s.id === target.id);
    if (removingFiltered >= 0) {
      const newLen = filtered.length - 1;
      setSelectedIdx(prev => Math.min(prev, Math.max(0, newLen - 1)));
    }
    onSessionRemoved?.(target.id);
    setDeleteBusy(false);
    setDeleteTarget(null);
    setRightView("preview");
    setFocus("list");
  }

  const footerContext: FooterContext = searchOpen
    ? "list-search"
    : focus === "settings"
      ? "settings"
      : focus === "delete-confirm"
        ? "delete-confirm"
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
          title={searchOpen ? t(lang, "title.filter") : t(lang, "title.sessions")}
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
              <Text dimColor>{t(lang, "empty.sessions")}</Text>
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
          focused={previewFocused || focus === "settings" || focus === "delete-confirm"}
          accent={
            previewFocused
              ? ACCENT
              : focus === "settings"
                ? ACCENT
                : focus === "delete-confirm"
                  ? DANGER
                  : MUTED
          }
          title={
            rightView === "settings"
              ? t(lang, "title.settings")
              : rightView === "delete-confirm"
                ? t(lang, "title.delete")
                : t(lang, "title.preview")
          }
          meta={
            rightView === "settings" || rightView === "delete-confirm"
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
          ) : rightView === "delete-confirm" && deleteTarget ? (
            <DeleteConfirm
              session={deleteTarget}
              cursor={deleteCursor}
              busy={deleteBusy}
              error={deleteError}
              width={rightInnerWidth}
              height={innerHeight}
            />
          ) : (
            <>
              {detail.status === "loading" && (
                <Box>
                  <Text color={ACCENT}><Spinner /></Text>
                  <Text dimColor> {t(lang, "loading.messages")}</Text>
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
                  onRequestContinue={(info) => {
                    if (!selected || !onRequestContinue) return { ok: true };

                    // Pre-flight checks done while Ink is still up so we can
                    // surface failures as a hint under the footer instead of
                    // crashing out to stderr after unmount.
                    if (!fsSync.existsSync(selected.filePath)) {
                      return { ok: false, error: t(lang, "continue.error_source_missing") };
                    }

                    // Project directory missing: recoverable. First confirm
                    // returns recoverable=force-cwd so preview can offer
                    // (force); the next confirm arrives with info.force=true
                    // and we launch in process.cwd() instead.
                    let forceCwd: string | undefined;
                    const slug = path.basename(path.dirname(selected.filePath));
                    const decodedCwd = decodeProjectPath(slug);
                    if (decodedCwd && !fsSync.existsSync(decodedCwd)) {
                      if (!info.force) {
                        return {
                          ok: false,
                          error: t(lang, "continue.force_hint", { cwd: process.cwd() }),
                          recoverable: "force-cwd",
                        };
                      }
                      forceCwd = process.cwd();
                    }

                    const claudeProbe = spawnSync(
                      process.platform === "win32" ? "where" : "which",
                      ["claude"],
                      { stdio: "ignore" },
                    );
                    if (claudeProbe.status !== 0) {
                      return { ok: false, error: t(lang, "continue.error_no_claude") };
                    }

                    onRequestContinue({
                      sourcePath: selected.filePath,
                      targetUuid: info.targetUuid,
                      targetRole: info.targetRole,
                      userText: info.userText,
                      launchMode: settings.continueLaunchMode,
                      forceCwd,
                    });
                    return { ok: true };
                  }}
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
