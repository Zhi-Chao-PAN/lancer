# Lancer 本地控制接口

让本机命令行程序给 **正在运行的 Lancer 中的已有会话** 派活。请求经 Electron 主进程进入同一个 conversation owner / Pi runtime；不会直接读写 `~/.pi/agent/sessions/*.jsonl`，不会争抢 `.jsonl.lease`，也不会在 Lancer 退出时启动另一个 Pi。

> 新代码须由用户在合适时机更新并重新启动 Lancer 后生效。仓库 CLI 无须安装；它不能让仍运行旧代码的应用自动获得接口。

## 开关与安全边界

Settings → General → **Allow local control API / 允许本地控制接口**，默认开启，修改立即生效，关闭状态跨重启保留。

macOS 默认路径：

- `~/Library/Application Support/Lancer/control.sock`：Unix domain socket，权限 `0600`。
- 同目录 `control.token`：32 字节随机值的十六进制表示，权限 `0600`；重启复用。

Linux 使用 `$XDG_CONFIG_HOME/Lancer`（未设置时 `~/.config/Lancer`）。当前不支持 Windows 传输层。开发/测试自定义 `PI_APP_USER_DATA_DIR` 后，CLI 用 `--user-data-dir` 或 `LANCER_USER_DATA_DIR` 指向同一目录。

只监听 Unix socket，不开 TCP 端口、不对外网开放、无遥测。每个请求必须携带 token。token 等同于以用户权限向 Lancer 派活的能力：不要复制给不受信任的程序，也不要放入日志、版本控制或共享 artifacts。同一操作系统用户下能读取 token 的程序不被视为互相隔离的安全主体。

消息沿用界面发送的工具、扩展和审批策略（Pi `source: interactive`）。接口没有“跳过审批”或远程确认入口；需要确认时只能由用户在界面处理。关闭接口会断开控制连接，**不会取消此前已接受的运行**，不会撤销已有队列，也不会删除 token 或会话。启动失败仅记录主进程诊断，不阻断桌面打开；可关闭再开启重试。

启动时只清理确认无进程监听、归当前用户所有的陈旧 socket；普通文件、符号链接、其他用户的 socket、活跃 socket、异常 token 一律不覆盖。异常 token 文件需用户自行检查/处理。

## CLI

在仓库根目录运行，Node 22+，无额外依赖：

```sh
./scripts/lancer-ctl sessions
./scripts/lancer-ctl sessions --json
./scripts/lancer-ctl set-thinking '<session-id 或标题片段>' high
./scripts/lancer-ctl send '会话标题片段' '检查当前修改，完成后总结风险'
./scripts/lancer-ctl send '<session-id>' --mode queue '当前任务结束后补充测试'
./scripts/lancer-ctl send '<workspace-id>:<session-id>' --mode steer '先停止扩展范围，只修复登录问题'
./scripts/lancer-ctl send '<session-id>' --file /absolute/path/instruction.txt
./scripts/lancer-ctl tail '<session-id>' -n 20 --json
./scripts/lancer-ctl wait '<session-id>' --timeout 600
./scripts/lancer-ctl new --cwd /path/to/repo --zone research \
  --model provider/model-id --name '本地调研' '阅读仓库并说明入口'
```

所有命令都支持 `--user-data-dir /path/to/profile`。可把仓库 `scripts/` 加入 PATH；不要仅复制 shell 入口而遗漏同目录的 `lancer-ctl.mjs`。`new` 也支持 `--file`，正文与位置参数二选一。以 `-` 开头的正文可放在 `--` 后。

会话选择依次匹配完整 `workspaceId:sessionId`、完整 session id、忽略大小写的标题片段。多个命中会报 `AMBIGUOUS_SESSION` 并列出完整标识，绝不猜测目标。完整标题也仍按片段规则检查歧义。列表包含当前应用 catalog 中所有工作区会话（含已归档），不扫描未注册工作区。

### 发送模式

| 模式    | 空闲时             | 运行中                                        |
| ------- | ------------------ | --------------------------------------------- |
| `send`  | 开始新一轮，默认值 | 拒绝 `SESSION_BUSY`，要求显式选择 queue/steer |
| `queue` | 开始新一轮         | 同 Enter，加入 Pi follow-up 队列              |
| `steer` | 开始新一轮         | 同 Cmd+Enter，加入 Pi steering 通道           |

返回 `accepted: true` 表示主进程接受了派发，不表示模型已完成。请随后 `wait` / `tail` 获取结果。会话刚启动/收尾且上一派发尚未落定时，后续 queue/steer 可能返回 `SESSION_STARTING`；检查状态后由调用方决定是否再次发送。运行结束恰好与排队重叠时，Pi 原有错误会如实显示，不偷偷改为另一次运行。

外部发送不会消耗/覆盖用户未发送的草稿、附件或正在编辑的队列消息，也不切换窗口选中的会话。已有会话界面实时收到原有 transcript/event 更新。`new` 是显式创建行为，会在前台窗口选择新会话；没有可用窗口时仍可创建。它复用工作区注册、会话创建和模型选择路径；模型设置失败会保留已经创建的空会话，报错而不发送正文（不做破坏性回滚）。

`--zone` 使用应用当前分区定义：`video`（视频学习）、`research`（外网调研）、`lancer`、`xhs`（小红书）。它复用应用标题分区前缀；不传则沿用标题的现有推断规则。工作目录与分区是两个不同概念。

为避免冒充某个窗口或修改用户 composer，接口只发送**普通文本**，拒绝以 `/` 开头的 slash command。附件上传、审批响应、窗口导航不在 v1 范围；这些仍由界面提供。普通文本的模型执行、排队、引导、工具权限和界面走同一通道。

### 会话思考强度

`set-thinking <id|title> off|minimal|low|medium|high|xhigh|max` 调用与 UI 相同的 `setSessionThinkingLevel`，作用于已有会话并同步 UI chip；不修改全局 `defaultThinkingLevel` 或 settings.json，也不切换当前会话。持久化、可用强度及模型不支持时的降档行为沿用现有 UI / Pi runtime：已有对话重启后保留，尚无消息的空会话在重启初始化时可能恢复默认强度。

成功返回 `{ session: { workspaceId, sessionId }, thinkingLevel }`；参数非法、目标不存在/歧义或 runtime 设置失败会报错，不返回成功回执。运行旧版应用时需先更新并重启。

### 输出与等待

- `sessions --json`：`{ sessions: [...] }`；每项包含 `id/sessionId`、`workspaceId`、去分区前缀的 `title`、`rawTitle`、`zoneId/zone`、工作区名 `workspace`、`cwd`、`model`、`modelSource`、`thinkingLevel`（已知会话值，否则 null）、`status`、`archived`、`updatedAt`、`pending` 和最近本地派发 `submission`。
- `modelSource`：`session` 是已知会话模型；`workspace-default` 表示尚无会话模型记录时的当前默认值；无法确定则 `unknown` 且 `model: null`，不会为列列表强制打开所有历史会话。
- `status`：`idle`、`running`、`waiting`（有待用户处理的扩展/UI 对话）、`failed`。`pending` 覆盖控制派发尚未反映为 running 的启动/收尾窗口。
- `tail --json`：`session`、`messages`（最近 N 个消息/工具/阶段条目）、独立的 `lastAssistant`（最新助手文本全文，不受 N 截断）、`done`、`outcome`、可选 `error`。N 默认 20，允许 1–1000。使用主进程 transcript 缓存/既有加载路径，不直接解析 session 文件。
- `wait`：每 250ms 轮询主进程，等待非 running、非 waiting 且 `pending === 0`；包含当前运行内的引导/排队处理，不把 `agent_end` 的中间重试当结束。已经空闲的会话立即返回。默认超时 300 秒，超时不取消任务。
- `submission` 只保存每会话最近一次本地派发的内存回执；`pending/complete/failed` 是派发调用状态。queue/steer 的 complete 表示已入 Pi 通道，不是模型已经处理完；以 `wait` 的 `done` 为准。应用重启不保存回执。
- `outcome: idle` 表示当前已停止运行，不承诺任务业务成功；界面 Stop 也会回到 idle。v1 没有独立持久化的取消/成功原因或 run-id 等待锁。

退出码：成功 `0`；参数、连接、认证、派发拒绝、`wait` 确认失败 `1`；`wait` 超时 `2`（JSON 包含 `timedOut: true`）。Lancer 未运行/开关关闭会清楚报错，永不回退到直接写文件。

CLI 不自动重放请求；连接在响应前断开时结果可能未知，尤其 `send/new`，请先检查 sessions/tail，避免重复派活。`wait` 是对当前会话的观察，不是绑定某次 submission 的事务：另一个程序/用户后续又发送时可能一起等待；应用重启后应重新查询。

## Wire API v1

HTTP/1.1 **只在 Unix socket 上**：`POST /v1`，`Authorization: Bearer <control.token内容>`，JSON body。单请求上限 1 MiB，最多 32 个连接，普通请求/连接超时 30 秒（成功建立的 `stream` 长连接除外），header 超时 5 秒。CLI 响应上限 32 MiB；超大 transcript 可减少 N，但最后助手全文仍可能超限，CLI 会明确报错。

请求：

```jsonl
{ "operation": "sessions" }
{ "operation": "set-thinking", "session": "sessionId", "thinkingLevel": "high" }
{ "operation": "send", "session": "workspaceId:sessionId", "mode": "queue", "message": "继续测试" }
{ "operation": "tail", "session": "sessionId", "n": 20 }
{ "operation": "wait", "session": "sessionId" }
{ "operation": "new", "cwd": "/absolute/repo", "zone": "research", "model": "provider/id", "name": "调研", "message": "开始" }
```

上面的每行是一个独立请求；wire `wait` 只返回一次状态快照，阻塞/轮询由调用方实现。成功为 `{ "ok": true, "result": ... }`，失败为 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。

`send/new` 的 result：

```json
{
  "accepted": true,
  "session": { "workspaceId": "...", "sessionId": "..." },
  "submissionId": "...",
  "mode": "send"
}
```

状态码：成功 200；认证失败 401；错误 URL/method 404；超过请求大小 413；非法 JSON/参数、找不到/歧义会话、busy、disabled 等 400；主机操作失败 500。错误码包括 `UNAUTHORIZED`、`INVALID_JSON`、`INVALID_REQUEST`、`TOO_LARGE`、`NOT_FOUND`、`AMBIGUOUS_SESSION`、`SESSION_BUSY`、`SESSION_STARTING`、`DISABLED`、`INTERNAL_ERROR`。

手动查询（不要把 token 展开值写到日志）：

```sh
PROFILE="$HOME/Library/Application Support/Lancer"
curl --unix-socket "$PROFILE/control.sock" \
  -H "Authorization: Bearer $(tr -d '\n' < "$PROFILE/control.token")" \
  -H 'Content-Type: application/json' \
  -d '{"operation":"sessions"}' http://localhost/v1
```

## Lane runtime 扩展

以下命令需要运行支持 lane runtime 的新版应用；旧命令和未分组会话保持兼容。

```sh
./scripts/lancer-ctl new --cwd /path/to/repo --group build-1 --orchestrator lead-id --role lane '运行测试'
./scripts/lancer-ctl lanes --group build-1 --json
./scripts/lancer-ctl logs '<session-id>' --since 42 --json
./scripts/lancer-ctl stream '<session-id>' --since 42
./scripts/lancer-ctl stream
./scripts/lancer-ctl stop '<session-id>'
./scripts/lancer-ctl set-result '<session-id>' .lancer-task/out/result.json
./scripts/lancer-ctl set-stage '<session-id>' --stage testing --progress 0.5
./scripts/lancer-ctl set-stage '<session-id>' --stage null --progress null
```

`new` 和 `new --draft` 都支持 `--group`、`--orchestrator`、`--role lead|lane`，分别传递 wire 字段 `group`、`orchestrator`、`role`，由应用保存 laneGroup/orchestratorId/role 元数据。省略时不改变旧行为。

所有扩展仍使用相同的认证 `POST /v1`，不是 GET 或新的服务：

```jsonl
{ "operation": "lanes", "group": "build-1" }
{ "operation": "logs", "session": "sessionId", "since": 42 }
{ "operation": "stream", "session": "sessionId", "since": 42 }
{ "operation": "stop", "session": "sessionId" }
{ "operation": "set-result", "session": "sessionId", "path": ".lancer-task/out/result.json" }
{ "operation": "set-stage", "session": "sessionId", "stage": "testing", "progress": 0.5 }
{ "operation": "set-stage", "session": "sessionId", "stage": null, "progress": null }
```

- `lanes`：可省略 group；result 为 `{ lanes: [...] }`，包含 `id,title,model,status,stage,progress,startedAt,elapsed,resultPath,lastLine`。无 `--json` 时按此顺序输出制表符分隔列，未知字段留空。
- `logs`：result 为 `{ events: [...] }`；`--json` 保留完整 result，否则输出 `[seq] kind` 与文本。`since` 是非负安全整数，排除该序号本身，用最后收到的 seq 续读。日志来自现有会话事件，不直接读取 session 文件。
- `stream`：session 可省略以订阅所有会话；since 可省略。成功响应为 `Content-Type: application/x-ndjson`，每行一个事件 `{seq,sessionId,ts,kind,text}`，状态变化使用 `kind: "status"` 并携带状态数据；没有普通 `{ok,result}` 包装。CLI 原样增量写到 stdout，不等待连接结束、不累计整个流，建立后无 30 秒总时限。连接前的认证/参数错误仍使用普通 JSON 错误响应。Ctrl+C 结束订阅，不停止会话；断开不自动重连或重放，调用方保存 cursor 后显式续读。
- cursor 属于当前 Electron 进程，进程重启后从 `--since 0` 重新查询；不会把原始输出额外持久化成第二份历史。尚无实时事件的会话可由现有 transcript 投影日志，历史文本不是原来的 token 分块。
- 输出包括助手增量、工具调用名/参数摘要、工具结果首行及退出码；服务端负责密钥打码，工具参数匹配 key/token/secret/password 的值不得暴露。CLI 不额外解释或修改事件。
- `elapsed` 单位为毫秒；无可靠开始/结束时间时为 null（已观察但尚未开始的运行可为 0）。日志打码覆盖敏感参数、已识别的敏感值与常见凭据格式，不是任意自然语言内容的秘密检测器，调用方不应让模型输出凭据。
- lane 状态为 `running | queued | waiting | done | failed | idle`；waiting 表示等待人工，done 表示最近运行正常结束且无后续，failed 表示异常/中断，idle 表示未运行或已确认。运行元数据还包括 `finishedAt`；stage/progress 没有数据时为 null，不推测完成比例。旧 sessions/tail/wait 兼容语义以各自回执为准。
- `stop` 与界面停止按钮等价且幂等，不删除会话。
- `set-result` 的 path 原样传给服务端，以会话工作区解析相对路径；服务端必须校验 realpath containment，拒绝工作区外路径及符号链接逃逸。CLI 不以自身 cwd 提前解析它。
- `set-stage` 至少传一个字段；省略的字段不修改，字面量 `null` 清空对应字段。stage 是可选短字符串，progress 是 0..1 或 null；服务端负责最终字段约束校验。

## 验证

```sh
node --test scripts/lancer-ctl.test.mjs
pnpm typecheck
pnpm test:baseline
pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/unit/control-api.spec.ts
PI_APP_REAL_AUTH=0 PI_APP_TEST_MODE=background \
  pnpm --filter @lancer/desktop run test:e2e:runner -- apps/desktop/tests/core/local-control.spec.ts
```

单测覆盖解析、歧义、状态、派发、认证、权限、body 上限、陈旧 socket、关闭与 CLI 无回退。Electron 用隔离 profile/workspace、本地确定性 provider 启动真实 Pi runtime，CLI 发消息后检查界面、工具实际写入、queue/steer、审批、后台会话隔离、新建模型/分区、失败和开关重启持久化；不需要真实凭据。该证明不是外部 provider、原生 OS 输入或打包/安装验证。

## 仅建立待办会话

`./scripts/lancer-ctl new --draft --cwd /path/to/project --zone video --name '待办 · 下载视频'`

`--draft` 只复用原会话创建与分区路径，不发送消息、不调用模型；不能同时传正文或 `--file`。回执 `created: true, started: false` 表示空会话已建立，不表示任务完成。省略 `--model` 沿用当前默认模型，任务名称不代表已配置该任务所需的其他模型。Wire API 为 `operation: "new", draft: true`，不含 `message`。

### Agent child waiting

The in-session `wait_threads` tool waits on child-subtree events (default 60 seconds,
maximum 120). A timeout does not cancel children or accept pending reports. A caller
can wait again; live pending reports remain eligible for the normal automatic return
once the parent is idle. Restored reports stay available for explicit inspection and
never automatically restart model work. A successful wait accepts the reports it
returns, preventing a second automatic delivery.

Repeated unchanged `list_threads` / `read_thread` calls may park on the same event
wait, but always return a fresh list/read result with their original action and schema.
Implicit inspection waits leave reports pending for explicit wait or normal automatic delivery.
Cold-start child status uses persisted `lastRunOutcome` first. Legacy records without
an outcome or report keep their prior status; missing history is not evidence of failure.
