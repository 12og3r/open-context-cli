# 会话预览搜索体验重做

**日期**: 2026-05-08
**状态**: 已批准，待实现计划

## 背景

当前会话预览面板的 Ctrl+F 搜索是个最低限度实现：

- 弹出一个孤立的输入框，没有边界和提示。
- 输入时所有匹配文本反白，但没有任何"第几处 / 共几处"的统计。
- 没有跳转能力——按方向键不会在匹配间移动。
- Enter 关掉输入框后，光标停在原来浏览的位置，不会落到任何匹配上。

结果：用户搜到一个常见词时屏幕上一片反白，但完全不知道有几处、也跳不过去看下一处。

## 目标

1. 用户能立刻看到当前查询有多少处匹配，自己停在第几处。
2. 用户能用方向键在匹配间快速跳转，跳到的位置实时反映在会话区。
3. Enter 或 Esc 关闭搜索框后，光标停留在最后跳到的那一处。
4. 高亮信息保留到用户主动浏览为止——按一次普通导航键自动清空。

## 非目标

- 正则、大小写敏感、整词匹配等开关。当前用户都没要。
- 跨会话搜索。仍然只在当前选中的会话里搜。
- 搜索历史 / 上次查询词记忆。每次打开都给空白输入。
- 搜索结果列表面板。靠就地高亮 + 跳转。
- vim 风格 `?` 反向搜索。我们没有方向概念。

## 行为设计

### 状态机

三个状态：

```
                     Ctrl+F / /                Enter / Esc
   [浏览]      ──────────────────►[搜索框打开]──────────────►[搜后]
       ▲                                │                          │
       │                                │ ↑↓←→ 跳匹配               │
       │                                │ live 高亮+计数            │
       │                                ▼                          │
       │                                                           │
       │                                                           ↓
       └──────普通导航键(j/k/↑↓/g/G/PgUp/PgDn/Ctrl+D/U/Tab) 清高亮──┘
```

- **浏览态**：当前所有非搜索行为，光标在某条消息上。
- **搜索框打开**：顶部多一行搜索条；`matches` 实时计算；`matchIndex` 跟随方向键。
- **搜后态**：搜索框已收，但 `committedQuery`、`matches`、`matchIndex`、所有高亮仍在屏。

### 键位表

| 键 | 浏览态 | 搜索框打开 | 搜后态 |
|---|---|---|---|
| `Ctrl+F` | 进搜索框打开 | 无操作（不关闭、不重置） | 进搜索框打开（**清旧高亮重新搜**） |
| `/` | 进搜索框打开 | 字面字符，写入查询词 | 进搜索框打开（**清旧高亮重新搜**） |
| `↑` `←` | `↑` 上一条消息 / `←` 不动 | **上一处匹配**（环绕） | 同浏览态，**先清高亮再正常生效** |
| `↓` `→` | `↓` 下一条消息 / `→` 不动 | **下一处匹配**（环绕） | 同浏览态，**先清高亮再正常生效** |
| `j` `k` `g` `G` `PgUp` `PgDn` `Ctrl+D` `Ctrl+U` | 正常 | — | 正常，**先清高亮** |
| `Tab` | 折叠/展开 tool | — | 正常，**先清高亮** |
| 其他可见字符 | — | 写入查询词 | — |
| `Backspace` | — | 删字 | — |
| `Enter` / `Esc` | — | 关搜索框，光标停在 `matches[matchIndex]` 所在消息 | — |

注：

- `↑/←` 互为别名、`↓/→` 互为别名——四个箭头用同一组语义"上一处 / 下一处匹配"。代价：搜索框打开时无法用 `←→` 在输入框内移动文字光标，要改错字只能 backspace 重打。已与用户确认接受此代价。
- `/` 和 `Ctrl+F` 等价。仅在浏览态和搜后态触发；搜索框已打开时它是普通字符，可以搜路径里的 `/`。

### 视觉表现

**搜索框打开时**（输入框那一行额外占一行可视高度）：

```
🔎 useState_                                    3 / 47
  🤖 assistant  ·  3h ago
  ▏ 之前我们用 ·useState· 处理表单
  ▏
› 🤖 assistant  ·  2h ago
  ▏ const [x, setX] = ·useState·(0)
  ▏ const y = 【useState】(false)
  ▏ const z = ·useState·(true)
  ▏
  🤖 assistant  ·  1h ago
  ▏ 改用 useReducer 替代 ·useState·
                                                  ↓
```

- 输入框那行：左 `🔎 + 查询词`，右 `<matchIndex+1> / <matches.length>`，右对齐。
- 普通匹配（其他处）：ANSI INVERSE（`\x1b[7m`）反白。沿用现有的 `applyHighlight` 实现。
- 当前一处：黄底黑字（`\x1b[43m\x1b[30m`）替代 INVERSE。
- 会话区光标 `›` 跟随 `matches[matchIndex].msgIndex` 的消息行。
- 零匹配时计数器显示 `0 / 0`，整段计数器和搜索图标用红色（`\x1b[31m`），输入框文字本身保持默认色。

**搜后态**：搜索框那一行收起来，画面恢复原始高度。所有高亮（包括黄底当前一处）仍在屏，光标停在最后跳到的那处。

### 行为细节

#### 打开搜索框时的初始 matchIndex

不是 0，而是"`messages[cursor]` 所在消息及之后的第一处匹配"。如果当前消息以下没有匹配，回卷到第 0 处。这样用户在某条消息上 `/useState` 时不会被弹回顶部。

实现：搜索框打开 + 查询词非空时（首次刷新）

```
const startCursor = effectiveCursor;
const firstAfter = matches.findIndex(m => m.msgIndex >= startCursor);
matchIndex = firstAfter >= 0 ? firstAfter : 0;
```

#### 输入字符时

每次查询词变化都重算 `matches`。`matchIndex` 重新定位为"距离上一次 matchIndex 最近的、仍在新结果集里的那处"——具体取上一次 matchIndex 对应的 `(msgIndex, charOffset)`，在新 matches 中二分找到 ≥ 这个位置的第一个。空查询词时 `matches = []`、`matchIndex = -1`、不显示计数器。

#### 跳转时

```
↓/→: matchIndex = (matchIndex + 1) % matches.length
↑/←: matchIndex = (matchIndex - 1 + matches.length) % matches.length
```

跳到一处后保证其 `startLine` 在 viewport 内：若不在，调整 `scrollLine` 让该 `startLine` 距 viewport 上沿 2 行（避免顶死，留点上文）。`pinToBottom` 永远 false 进入跳转后。

#### Enter / Esc

完全等价：

```
searchOpen = false
// committedQuery / matches / matchIndex 全部保留
cursor = matches[matchIndex].msgIndex     // 如果 matches 非空
pinToBottom = false
```

`matches` 为空时 Enter / Esc 仅关搜索框，光标和滚动状态不变。

#### 搜后态首次普通导航键

任何普通导航键（`j`/`k`/`↑`/`↓`/`←`/`→`/`g`/`G`/`PgUp`/`PgDn`/`Ctrl+D`/`Ctrl+U`/`Tab`）按下时，先清搜索状态：

```
committedQuery = ""
matches = []
matchIndex = -1
```

然后该键正常生效（不被吞）。`Ctrl+F` 和 `/` 在搜后态走"重开搜索框"分支——也清旧搜索状态，再 `searchOpen = true`、查询词为空。

## 数据结构

### Match

```ts
type Match = {
  msgIndex: number;        // 命中所在消息在 messages[] 中的下标
  startLine: number;       // 命中在 buffer.lines 中的起始行
  startCol: number;        // 命中在该行 ANSI-strip 后的起始列
  length: number;          // 命中字符数
};
```

`startLine` / `startCol` 之所以重要：原始 content 经过 markdown 渲染、ANSI 着色、`wrap-ansi` 软折行后，文本坐标全部偏移；要让光标和 viewport 跳得精准必须知道渲染缓冲里的实际坐标。

### 状态字段（在 SessionPreview 里新增）

```ts
const [matches, setMatches] = useState<Match[]>([]);
const [matchIndex, setMatchIndex] = useState<number>(-1);
```

`searchOpen`、`searchValue`、`committedQuery` 维持现有命名。

## 实现接触点

### `src/lib/render-message.ts`

`applyHighlight` 拆成两步：

1. 仍然给原文本所有匹配点包 INVERSE（保证 markdown 渲染、ANSI 折行不破坏命中区间——`wrap-ansi` 不会拆 ANSI 转义本身）。
2. 渲染完所有 lines 后，扫一遍 lines 找出所有 INVERSE 区段，按出现顺序登记 `(lineIndex, col, length)` 进 `matches`，连同消息归属（用 startLine/endLine 反查 msgIndex）一起返回。
3. 调用方传入 `matchIndex`：把第 `matchIndex` 处的 INVERSE 序列替换为黄底序列（`\x1b[43m\x1b[30m...\x1b[0m`），其余保持 INVERSE。

`renderConversation` 的返回类型扩展：

```ts
{
  lines: string[];
  startLine: number[];
  endLine: number[];
  matches: Match[];     // 新增
}
```

`renderConversation` 的入参新增 `matchIndex: number`（默认 -1）。

### `src/components/search-bar.tsx`

新增 `right` 槽用于计数器显示。**关键技术点**：当前用 `ink-text-input`，它内部也用 `useInput`，没法阻止它对 `↑↓←→` 的默认处理（`←→` 移动输入光标、`↑↓` 不动但也被吞）。要把方向键留给外层，需要替换为自写 minimal single-line input：

```ts
function MinimalInput({ value, onChange, onSubmit, onCancel,
                       onPrev, onNext }: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPrev: () => void;     // ↑/←
  onNext: () => void;     // ↓/→
}) {
  useInput((input, key) => {
    if (key.return) onSubmit();
    else if (key.escape) onCancel();
    else if (key.upArrow || key.leftArrow) onPrev();
    else if (key.downArrow || key.rightArrow) onNext();
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) onChange(value + input);
  });
  return <Text>{value}<Text inverse> </Text></Text>;  // 文字 + 闪烁块光标
}
```

这个组件不做光标移动、不做选区——单纯追加和退格。和现有 `ink-text-input` 的体验差异：用户没法在输入框中间插字。但因为方向键已被征用作匹配跳转，原本也用不到中间插字。

`SearchBar` 改为：

```tsx
<Box>
  <Text color={zeroMatches ? "red" : "cyan"}>🔎 </Text>
  <MinimalInput {...inputProps} />
  <Box flexGrow={1} justifyContent="flex-end">
    <Text color={zeroMatches ? "red" : "gray"}>
      {matches.length === 0 ? "" : `${matchIndex + 1} / ${matches.length}`}
    </Text>
  </Box>
</Box>
```

### `src/components/session-preview.tsx`

主要变化：

1. 新增 `matches` / `matchIndex` 状态。
2. `useInput` 顶部加搜后态拦截：

```ts
const inSearchAfterglow = !searchOpen && committedQuery !== "";
const isOrdinaryNav = key.downArrow || key.upArrow || key.leftArrow ||
                      key.rightArrow || input === "j" || input === "k" ||
                      input === "g" || input === "G" || key.pageUp ||
                      key.pageDown || (key.ctrl && (input === "d" || input === "u")) ||
                      (key.tab && !key.shift);

if (inSearchAfterglow && isOrdinaryNav) {
  setCommittedQuery("");
  setMatches([]);
  setMatchIndex(-1);
  // fallthrough，继续原导航逻辑
}
```

3. `Ctrl+F` 和 `/` 触发分支也清旧搜索状态再开新框。
4. `useMemo(buffer)` 的依赖加入 `matchIndex`、`matches`——因为 `matchIndex` 变了，黄底高亮位置就要重画。
5. 把 `matches` 提到 `useMemo` 外：让 SearchBar 也能拿到 `matches.length`、`matchIndex` 用作计数显示。

最干净的方案：`renderConversation` 里把 matches 一并算出来返回，SessionPreview 一处持有。计数显示从这个数据派生。

6. 搜索框内 `onPrev / onNext / onSubmit / onCancel` 触发的状态变更：

```ts
const onNext = () => {
  if (matches.length === 0) return;
  const next = (matchIndex + 1) % matches.length;
  setMatchIndex(next);
  scrollMatchIntoView(matches[next]);
};

const onSubmit = () => {       // Enter
  setSearchOpen(false);
  setCommittedQuery(searchValue);
  if (matches.length > 0) {
    setCursor(matches[matchIndex].msgIndex);
    setPinToBottom(false);
  }
};

const onCancel = () => {       // Esc，行为同 onSubmit
  onSubmit();
};
```

`scrollMatchIntoView(m)`：若 `m.startLine` 不在 `[scrollLine, scrollLine + viewportHeight)` 内，则 `setScrollLine(Math.max(0, Math.min(maxScroll, m.startLine - 2)))`。

## 边界情形

| 情形 | 行为 |
|---|---|
| 查询词为空 | 不算 matches、不显示计数器、不应用任何高亮；方向键无操作（不发出错误，单纯不响应） |
| 0 处匹配 | 计数器显示 `0 / 0`，红色；搜索图标变红；方向键无操作；Enter/Esc 关框，光标和滚动不变 |
| 1 处匹配 | 计数器显示 `1 / 1`；上下跳都回到自己（环绕） |
| 同一行多处匹配 | 每处算独立 Match；跳转可能停在同一行 |
| 当前一处匹配跨折行 | 视觉上当前一处的黄底也会跨行；scrollIntoView 用 `startLine`，把命中开头那行挤到上沿 +2 |
| 输入框正打到一半，会话拉来新消息 | 因为 SessionPreview 渲染依赖 messages，新消息进来会触发 useMemo 重算；matches 重算；matchIndex 用旧 (msgIndex, charOffset) 重新定位 |
| 切换会话时 searchOpen=true | 现有 useEffect 已经在 sessionId 变化时全部 reset，沿用之 |

## 测试要点

虽然计划阶段才写测试，但要预先想清楚：

- 打开搜索框 → 输入"useState" → 计数器显示总数。
- 按 `↓` 三次 → matchIndex 推进，光标和 viewport 跟随。
- 按 `Enter` → 搜索框收，光标停在第 4 处所在消息，高亮全在。
- 在搜后态按 `j` → 高亮全清，cursor 下移一条消息。
- 在搜后态按 `Ctrl+F` → 旧高亮清，新搜索框为空。
- `/foo` 在浏览态触发搜索，但搜索框打开后输入 `/` 是字面字符。
- 0 匹配时计数器红色，方向键无响应。
- 跨会话切换时搜索状态完全 reset。

## 风险和未决

- **`ink-text-input` 替换风险**：自写 MinimalInput 失去光标移动、文本选区、CJK 输入法回显等能力。CJK 输入法是真正风险——纯字符追加可能导致 IME 中间状态丢失。如发现 IME 问题，后备方案是保留 `ink-text-input` 作输入主体，外层在 useInput 里通过判断"按下的键是不是 ink-text-input 已经吞掉了"来跳转——`ink` 的 useInput 是广播式的、handler 都会跑，所以可以在外层平行处理 `↑↓←→` 自己的逻辑，让 ink-text-input 的左右光标移动同时发生但视觉上不可见（因为我们的输入框没显示文字光标位置）。这条作为 fallback 不写进基础设计。
- **黄底配色对比度**：黑字+黄底在多数终端主题下都清楚，但极少数暗色主题黄色发淡。计划阶段先按 `\x1b[43m\x1b[30m` 实现，发现问题再考虑加粗或换色。

## 不写入设计的小事

- 计数器右对齐用 `flexGrow + justifyContent` 还是手动 padding——实现细节，写计划时定。
- "把当前一处的 ANSI INVERSE 替换为黄底"具体用 string.replace 还是按字节切片重组——实现细节，写计划时定。
