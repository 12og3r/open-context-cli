// Centralized strings table. Keys are flat dot-paths so a missing translation
// shows up as the literal key in the UI — easier to spot than empty space.
//
// Adding a string: add the key to the `en` table first, then `zh`. If a
// translation lags, callers fall back to the English entry, then to the key.

export type Lang = "en" | "zh";

export const LANGS: ReadonlyArray<Lang> = ["en", "zh"];

export const DEFAULT_LANG: Lang = "en";

type StringTable = Record<string, string>;

const en: StringTable = {
  // Pane titles
  "title.sessions": "SESSIONS",
  "title.preview": "PREVIEW",
  "title.settings": "SETTINGS",
  "title.delete": "DELETE",

  // Empty / loading / status
  "empty.sessions": "(no sessions)",
  "empty.messages": "(no messages)",
  "loading.messages": "loading messages…",
  "loading.rendering": "rendering…",
  "loading.scanning": "Scanning {root}…",
  "loading.deleting": "deleting…",

  // Feature bar
  "feature.settings": "Settings",
  "feature.delete": "Delete",

  // Search / filter bar
  "search.label": "SEARCH",
  "filter.label": "FILTER",
  "search.no_matches": "no matches",

  // Settings panel
  "settings.help": "↑↓ field · ←→ move cursor · space to apply · ⏎ confirm · esc back",
  "settings.display_mode.title": "Display mode",
  "settings.display_mode.concise": "Concise",
  "settings.display_mode.full": "Full",
  "settings.display_mode.concise_desc": "Show only user and assistant messages.",
  "settings.display_mode.full_desc": "Show every message, including tool calls and results.",
  "settings.show_hash.title": "Show hash",
  "settings.show_hash.on": "On",
  "settings.show_hash.off": "Off",
  "settings.show_hash.on_desc": "Show sessionId and the current message's uuid in the preview footer.",
  "settings.show_hash.off_desc": "Hide hash values in the preview footer.",
  "settings.language.title": "Language",
  "settings.language.en": "English",
  "settings.language.zh": "中文",
  "settings.language.en_desc": "Use English for all interface labels and hints.",
  "settings.language.zh_desc": "界面文案使用简体中文。",
  "settings.launch_mode.title": "Continue-conversation launch mode",
  "settings.launch_mode.option_reuse": "Reuse current terminal",
  "settings.launch_mode.option_new_window": "Open in new terminal window",
  "settings.launch_mode.option_reuse_desc": "Hand the current terminal over to claude. PTY-based prefill works here.",
  "settings.launch_mode.option_new_window_desc": "Open a new window in your terminal app (Terminal, iTerm, Ghostty, Warp; macOS only). User message is auto-sent as the first prompt.",
  "settings.launch_mode.unsupported_note": "macOS only",

  // Continue conversation
  "continue.footer_label": "↪ Continue conversation",
  "continue.footer_label_force": "↪ Continue conversation (force)",
  "continue.force_hint": "project dir missing — Enter again to launch in {cwd}",
  "continue.error_no_claude": "claude not found in PATH",
  "continue.error_not_tty": "current stdout is not a TTY",
  "continue.error_unsupported": "\"new window\" mode is not supported on this platform",
  "continue.error_fork_failed": "failed to fork session: {detail}",
  "continue.error_launch_failed": "failed to launch claude: {detail}",
  "continue.error_source_missing": "session file no longer exists on disk",
  "continue.error_cwd_missing": "project directory not found: {cwd}",
  "continue.spawn_new_window_hint": "A new Terminal window has opened — paste with Cmd+V if a message was prepared.",

  // Delete dialog
  "delete.prompt": "Delete this session?",
  "delete.summary_label": "Summary: ",
  "delete.path_label": "Path:    ",
  "delete.warning": "This action cannot be undone — the JSONL file will be removed from disk.",
  "delete.cancel": "Cancel",
  "delete.delete": "Delete",
  "delete.help": "←→ move · ⏎ confirm · esc cancel",

  // Path input
  "path.brand": "open-context",
  "path.subtitle": "session browser",
  "path.no_default": "No sessions found in the default location.",
  "path.prompt": "Enter a path to a directory or .jsonl file",

  // Session list / preview
  "list.msgs_suffix": "msgs",
  "preview.session_hash_prefix": "session",
  "preview.msg_hash_prefix": "msg",

  // Message-row role headers. Tool-use rows usually show the actual tool name
  // (e.g. "Read", "Bash"); `role.tool` is just the fallback when toolName is
  // missing.
  "role.user": "user",
  "role.assistant": "assistant",
  "role.tool": "tool",
  "role.tool_result": "result",
  "role.system": "system",

  // Relative time
  "rt.just_now": "just now",
  "rt.yesterday": "Yesterday",
  "rt.minutes_ago": "{n}m ago",
  "rt.hours_ago": "{n}h ago",
  "rt.days_ago": "{n}d ago",

  // Footer hints — pipe-joined strings; one segment per token. Splitting at
  // render time avoids Record<FooterContext,string[]> here, which would force
  // i18n.ts to import a UI type and create a circular dependency.
  "footer.list":           "↑↓ select|⏎ focus preview|⇥ menu|p path|q quit",
  "footer.preview":        "↑↓ scroll|esc back|⌃F find|⇥ expand tool|⏎ continue|q quit",
  "footer.preview-search": "type to search|⏎ commit|esc cancel",
  "footer.path-input":     "type a path|⏎ submit|esc quit",
  "footer.feature-bar":    "←→ pick|⇥ next|⏎ open|esc back",
  "footer.settings":       "↑↓ field|←→ cursor|space apply|⏎ confirm|esc back",
  "footer.delete-confirm": "←→ choose|⏎ confirm|esc cancel",
};

const zh: StringTable = {
  "title.sessions": "会话",
  "title.preview": "预览",
  "title.settings": "设置",
  "title.delete": "删除",

  "empty.sessions": "（暂无会话）",
  "empty.messages": "（暂无消息）",
  "loading.messages": "正在加载消息…",
  "loading.rendering": "正在渲染…",
  "loading.scanning": "正在扫描 {root}…",
  "loading.deleting": "正在删除…",

  "feature.settings": "设置",
  "feature.delete": "删除",

  "search.label": "搜索",
  "filter.label": "筛选",
  "search.no_matches": "无匹配",

  "settings.help": "↑↓ 字段 · ←→ 移动光标 · 空格 切换 · ⏎ 确认 · esc 返回",
  "settings.display_mode.title": "显示模式",
  "settings.display_mode.concise": "精简",
  "settings.display_mode.full": "完整",
  "settings.display_mode.concise_desc": "仅显示用户与助手消息。",
  "settings.display_mode.full_desc": "显示所有消息，包括工具调用与结果。",
  "settings.show_hash.title": "显示哈希",
  "settings.show_hash.on": "开",
  "settings.show_hash.off": "关",
  "settings.show_hash.on_desc": "在预览底部显示会话 ID 与当前消息的 UUID。",
  "settings.show_hash.off_desc": "隐藏底部的哈希信息。",
  "settings.language.title": "语言",
  "settings.language.en": "English",
  "settings.language.zh": "中文",
  "settings.language.en_desc": "Use English for all interface labels and hints.",
  "settings.language.zh_desc": "界面文案使用简体中文。",
  "settings.launch_mode.title": "继续对话启动方式",
  "settings.launch_mode.option_reuse": "复用当前终端",
  "settings.launch_mode.option_new_window": "弹出新终端窗口",
  "settings.launch_mode.option_reuse_desc": "把当前终端交给 claude；可用 PTY 自动预填用户消息。",
  "settings.launch_mode.option_new_window_desc": "在你的终端 app 里弹新窗口（支持 Terminal / iTerm / Ghostty / Warp；仅 macOS）。用户消息会自动作为首条 prompt 发送。",
  "settings.launch_mode.unsupported_note": "仅 macOS 支持",

  "continue.footer_label": "↪ 继续对话",
  "continue.footer_label_force": "↪ 继续对话（强制）",
  "continue.force_hint": "项目目录已不存在 —— 再按一次 Enter 在 {cwd} 启动",
  "continue.error_no_claude": "在 PATH 中未找到 claude 命令",
  "continue.error_not_tty": "当前 stdout 不是 TTY",
  "continue.error_unsupported": "当前平台不支持「弹出新终端窗口」",
  "continue.error_fork_failed": "分叉会话失败：{detail}",
  "continue.error_launch_failed": "启动 claude 失败：{detail}",
  "continue.error_source_missing": "源会话文件已不存在",
  "continue.error_cwd_missing": "项目目录不存在：{cwd}",
  "continue.spawn_new_window_hint": "新终端窗口已打开 —— 如有预填消息，请在新窗口里 Cmd+V 粘贴。",

  "delete.prompt": "删除该会话？",
  "delete.summary_label": "摘要：  ",
  "delete.path_label": "路径：  ",
  "delete.warning": "此操作不可撤销 — 该 JSONL 文件将从磁盘移除。",
  "delete.cancel": "取消",
  "delete.delete": "删除",
  "delete.help": "←→ 选择 · ⏎ 确认 · esc 取消",

  "path.brand": "open-context",
  "path.subtitle": "会话浏览器",
  "path.no_default": "默认位置未找到任何会话。",
  "path.prompt": "请输入目录或 .jsonl 文件的路径",

  "list.msgs_suffix": "条消息",
  "preview.session_hash_prefix": "会话",
  "preview.msg_hash_prefix": "消息",

  "role.user": "用户",
  "role.assistant": "机器人",
  "role.tool": "工具",
  "role.tool_result": "结果",
  "role.system": "系统",

  "rt.just_now": "刚刚",
  "rt.yesterday": "昨天",
  "rt.minutes_ago": "{n} 分钟前",
  "rt.hours_ago": "{n} 小时前",
  "rt.days_ago": "{n} 天前",

  "footer.list":           "↑↓ 选择|⏎ 进入预览|⇥ 菜单|p 路径|q 退出",
  "footer.preview":        "↑↓ 滚动|esc 返回|⌃F 查找|⇥ 展开工具|⏎ 继续对话|q 退出",
  "footer.preview-search": "输入以搜索|⏎ 确认|esc 取消",
  "footer.path-input":     "输入路径|⏎ 提交|esc 退出",
  "footer.feature-bar":    "←→ 选择|⇥ 下一项|⏎ 打开|esc 返回",
  "footer.settings":       "↑↓ 字段|←→ 光标|空格 切换|⏎ 确认|esc 返回",
  "footer.delete-confirm": "←→ 选择|⏎ 确认|esc 取消",
};

const TABLES: Record<Lang, StringTable> = { en, zh };

export function t(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = TABLES[lang][key] ?? TABLES[DEFAULT_LANG][key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

/** Footer hints arrive as pipe-joined strings in the table; split for use. */
export function tList(lang: Lang, key: string): string[] {
  return t(lang, key).split("|");
}
