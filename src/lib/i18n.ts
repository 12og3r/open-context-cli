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
  "title.filter": "FILTER",
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
  "footer.list":           "↑↓ select|⏎ focus preview|/ search|esc menu|p path|q quit",
  "footer.preview":        "↑↓ scroll|esc back|⌃F find|⇥ expand tool|q quit",
  "footer.list-search":    "type to filter|⏎ apply|esc cancel",
  "footer.preview-search": "type to search|⏎ commit|esc cancel",
  "footer.path-input":     "type a path|⏎ submit|esc quit",
  "footer.feature-bar":    "←→ pick|⏎ open|esc back",
  "footer.settings":       "↑↓ field|←→ cursor|space apply|⏎ confirm|esc back",
  "footer.delete-confirm": "←→ choose|⏎ confirm|esc cancel",
};

const zh: StringTable = {
  "title.sessions": "会话",
  "title.filter": "筛选",
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

  "footer.list":           "↑↓ 选择|⏎ 进入预览|/ 搜索|esc 菜单|p 路径|q 退出",
  "footer.preview":        "↑↓ 滚动|esc 返回|⌃F 查找|⇥ 展开工具|q 退出",
  "footer.list-search":    "输入以筛选|⏎ 应用|esc 取消",
  "footer.preview-search": "输入以搜索|⏎ 确认|esc 取消",
  "footer.path-input":     "输入路径|⏎ 提交|esc 退出",
  "footer.feature-bar":    "←→ 选择|⏎ 打开|esc 返回",
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
