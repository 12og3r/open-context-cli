# 从历史消息继续对话（Continue Conversation）

**日期**: 2026-05-09
**状态**: 已批准，待实现计划

## 背景

`open-context` 目前只是一个浏览器：用户能翻看 Claude Code 留下的历史会话，
但无法基于历史里任意一条消息**重启**对话。

实际工作流里这是个高频需求：

- 看到一段几天前对自己有用的对话，想沿着那个方向继续问；
- 用户消息当时写得不够好，想编辑后重新发；
- 助手某一轮的回应不满意，想从那个分支点重新走。

Claude Code 自己有 `claude --resume <id>`，但那是续接整段会话，没有"从中间任意一点
分叉"的语义。

## 目标

1. 在预览面板中，光标定位到任一 `user` / `assistant` 消息时，按 Enter 即可发起
   "继续对话"。
2. 选中**用户消息**时：新会话的历史不含该消息，输入框中**已经预填好**这条消息原文，
   光标待编辑、未发送。
3. 选中**助手消息**时：新会话的历史**包含**该消息（含同一回合内的工具调用），
   输入框为空，等待用户输入下一句。
4. 不污染原始 JSONL：分叉走一个新 UUID 的文件，原会话保持不变。
5. 默认体验是"复用当前终端"——干净退出 open-context，claude 接管同一个终端窗口；
   有"弹出新终端窗口"作为可选项（macOS 起步）。

## 非目标

- 不支持在 `tool_use` / `tool_result` 行触发"继续对话"。这些是助手一回合的内部
  零件，不是对话转折点。Tool 行的 Enter 维持原本的展开/折叠语义。
- 不做"分支管理"——不记录新旧会话的派生关系，新会话就是一个全新会话。
- 不实现"两个对话并排比较"等高级功能。
- 非 macOS 平台 MVP 不支持"弹出新终端窗口"模式（设置项灰显）。

## 行为设计

### 触发与确认

预览面板获得焦点、光标在 `user` 或 `assistant` 消息行上：

- 第一次按 **Enter** → 在预览底部插入一个临时 footer 行：

  ```
  ──────────────────────────────────────────
  ↪ 继续对话    Enter=确认  Esc=取消
  ──────────────────────────────────────────
  ```

- 此时屏蔽预览原本的导航键（j/k/g/G/PgUp/PgDn 等）；只接受 Enter / Esc。
- **Enter** 再按一次 → 执行 fork + launch；
- **Esc** → 隐藏 footer，恢复原本导航。

光标在 `tool_use` / `tool_result` 行上时，Enter 仍然是展开/折叠，**不**显示
"继续对话" footer。

### Fork 算法

定位逻辑只看消息的 `uuid`（每条 Message 自带源 JSONL entry 的 uuid）。

1. 取光标消息的 `uuid` 与 `role`。
2. 流式读源 JSONL，逐行 parse。
3. 跳过非 `user` / `assistant` 的行（如 `summary`、`custom-title`），让新会话由
   claude 自行生成新的摘要，避免误导。
4. 切点：
   - **user** 消息：复制目标 uuid 那一行**之前**的所有 `user`/`assistant` 行，
     **不包含**目标行（其文本要去预填输入框）。
   - **assistant** 消息：复制到目标 uuid 那一行（**包含**整行；同 uuid 下的多个
     Message 切片归属同一行，整轮带过去）。
5. 写入 `~/.claude/projects/<同项目 slug>/<新-uuid>.jsonl`。`新-uuid` 由
   `crypto.randomUUID()` 生成。
6. 复制每行时，如果其内部携带 `sessionId` 字段，重写为新 uuid，保持一致。
7. 失败回滚：若文件已写出但后续 launch 失败，删除该文件，避免遗留。

### 启动模式 A：复用当前终端（默认）

```
open-context (Ink)
   │
   │  unmount UI
   ▼
node-pty.spawn('claude', ['--resume', newUuid], {cwd, cols, rows, env})
   │
   │  wait first stdout chunk + ~80ms
   ▼
write '\x1b[200~' + userText + '\x1b[201~'   (仅 user-msg 分支)
   │
   ▼
pipe pty.stdout → process.stdout
pipe process.stdin (raw) → pty.stdin
forward SIGWINCH (cols/rows)
   │
   ▼
child exit → process.exit(child.exitCode)
```

实现要点：

- Ink 原生支持 bracketed paste（`usePaste`），上面的 `\x1b[200~ ... \x1b[201~`
  会被 claude 当成一次完整粘贴，落入输入框、可编辑、未发送。
- 写入须发生在 claude 首帧渲染之后。"首次 stdout chunk + 80ms" 是经验值，
  够大多数情况。
- claude 退出后，open-context 不再恢复；用户想再浏览历史就重新跑 `open-context`。
  这是为了避免 Ink unmount 之后再 remount 带来的状态同步复杂度。
- `env`：透传 `process.env`，仅追加我们必要的（暂无）。
- 当前 stdout 不是 TTY（被 pipe / 重定向）时不能进入这个模式，回退到打印命令并退出。
- 注意区别于模式 B：模式 A 下子进程结束意味着整体结束；模式 B 下 open-context 进程
  原地继续运行，新窗口里的 claude 与本进程互相独立。

### 启动模式 B：弹出新终端窗口（可选，MVP 仅 macOS）

```
1. 同样建好 fork JSONL
2. 若是 user-msg 分支：pbcopy 写入用户消息原文
3. osascript 启 Terminal.app 跑：
     cd <projectPath> && claude --resume <new-uuid>
4. 用户进入新窗口后，user-msg 分支需要 Cmd+V 粘贴
5. 当前 open-context 进程继续保留在原窗口
```

非 macOS 平台：设置面板中此选项灰显，附说明"目前仅 macOS 支持"。
iTerm2 / Kitty / Alacritty 等的差异化适配不在 MVP 范围。

### 设置项

- key: `continueLaunchMode`
- 类型: `"reuse-current" | "new-window"`
- 默认: `"reuse-current"`

在 SettingsPanel 增加一组单选，标题如"继续对话启动方式"，下方两选项；非 macOS 把
`new-window` 灰掉并加一行注解。

## 数据流 & 组件影响

涉及修改：

- `src/components/session-preview.tsx`：在 `useInput` 里增加 Enter 在 user/assistant
  行触发"继续对话"的分支；新增本地状态 `confirmContinue: boolean`；底部 footer
  渲染该状态对应的提示行。屏蔽其它键的逻辑收敛到这一段。
- `src/components/settings-panel.tsx`：加一组单选项，调用 `updateSetting`。
- `src/lib/settings.ts`：新增 `continueLaunchMode` 字段，默认值 `"reuse-current"`，
  跟现有 settings 的持久化一致。
- `src/lib/i18n.ts`：新增 zh/en key（见下文）。
- 新增 `src/lib/continue-fork.ts`：fork 算法（流式读源 JSONL → 切片 → 写新 JSONL）。
  纯函数，可测。
- 新增 `src/lib/continue-launch.ts`：两种启动模式的执行入口。封装 node-pty 调用 +
  bracketed paste 注入；封装 osascript 新窗口路径。
- `src/app.tsx`：暴露一个回调让 `SessionBrowser` / `SessionPreview` 能让顶层
  unmount Ink 树（`useApp().exit()` 之后再 spawn pty）。
- `package.json`：加 `@lydell/node-pty` 到 `dependencies`；构建脚本对该包加
  `--external` 防止被 inline 进 bundle。

## i18n key 列表

| key | zh | en |
|-----|----|----|
| `continue.footer_label` | `↪ 继续对话` | `↪ Continue conversation` |
| `continue.confirm_hint` | `Enter=确认  Esc=取消` | `Enter=confirm  Esc=cancel` |
| `continue.error_no_claude` | `未在 PATH 中找到 claude 命令` | `claude not found in PATH` |
| `continue.error_not_tty` | `当前终端不可用，无法继续对话` | `current stdout is not a TTY` |
| `continue.error_unsupported` | `当前平台不支持「弹出新终端窗口」` | `"new window" mode is not supported on this platform` |
| `settings.launch_mode.title` | `继续对话启动方式` | `Continue-conversation launch mode` |
| `settings.launch_mode.option_reuse` | `复用当前终端` | `Reuse current terminal` |
| `settings.launch_mode.option_new_window` | `弹出新终端窗口` | `Open in new terminal window` |
| `settings.launch_mode.unsupported_note` | `仅 macOS 支持` | `macOS only` |

## 错误与边界

- **`claude` 不在 PATH**：fork JSONL 之前先 `which claude`（或 `Bun.which`）做预检；
  失败时不写文件，footer 行红字显示 `continue.error_no_claude`。
- **stdout 非 TTY**：复用当前终端模式直接拒绝；新窗口模式不受影响。
- **fork 文件已存在**（理论上不会）：用 randomUUID 防碰撞；万一碰上就报错。
- **claude 启动后立即退出**（用户改密码 / 配置异常等）：父进程跟随退出码退出。
- **fork 写出后 launch 失败**：捕获 spawn 错误，删除刚建好的新 JSONL 文件，footer
  以红字显示错误信息，光标回到原位。
- **`projectPath` 为空**（极个别会话从单个 .jsonl 路径加载、没有解码出工作目录）：
  此时模式 A 的 spawn cwd 用 `process.cwd()`；模式 B 的 osascript 命令省略
  `cd ...`，直接 `claude --resume <id>`。
- **bracketed paste 失败**（极旧的 claude 不支持 `usePaste`）：用户会看到原始
  转义序列出现在输入框；这是降级体验而非崩溃。MVP 不专门 detect，记录在已知问题。
- **多消息共享 uuid**（assistant 一轮里 text + tool_use + tool_result）：fork 按
  JSONL 行切，自然把整轮带过去；用户感知一致。
- **空会话**：messageCount=0 时光标不会落到任何 `user`/`assistant` 行，自然触发不到。

## 测试

- `tests/lib/continue-fork.spec.ts`：固定的 fixture JSONL，覆盖
  - user 切点：目标行被排除，前置行顺序保持；
  - assistant 切点：目标行被包含；
  - assistant 一轮内多 Message 共 uuid：整行作为一个原子单位；
  - `summary` / `custom-title` 行被丢弃；
  - `sessionId` 字段被正确改写。
- `tests/components/session-preview-continue.spec.tsx`：
  - 光标在 user 行 → Enter → footer 出现 → 再 Enter → 调用注入回调；
  - 光标在 tool 行 → Enter → 不显示 footer，保持原有展开行为；
  - footer 状态下方向键不动光标；
  - Esc 关闭 footer，恢复导航。
- 启动器（continue-launch）的端到端测试不放进 CI（依赖真实终端 + claude
  二进制），手动验证步骤写进 README。

## 发布到 npm

- `package.json` `bin` 字段已存在，发布时不变；
- 把 `@lydell/node-pty` 加到 `dependencies`；
- `bun build` 加 `--external @lydell/node-pty` 防止打进 bundle；
- README 增补一节："如果 prebuilt 二进制下载失败，请确认 Python 3 + C++ 工具链
  在 PATH 中" —— 这是 node-pty 的标准 fallback 提示。

## 未来工作（不在 MVP 内）

- 弹出新终端窗口的 PTY 注入（需要 launcher 子命令），让 user-msg 也能直接预填；
- iTerm2 / Kitty / Alacritty / WezTerm / Linux 终端的多端适配；
- 显示分叉树（一个会话被分叉过几次、各自走向哪儿）。
