<!-- readme-sync:language -->
<p align="right">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="./assets/readme/oracle-hero.svg" alt="Oracle 视觉标识：靛蓝与金色字标，下方呈现 sealed context、exact-session recovery、declared batches 与 dedicated Chrome 四项能力" width="1100">
</p>

<!-- readme-sync:identity -->

# Oracle / IndelibleVivi fork

> 可恢复的 GPT-5.6 Pro 咨询：单会话，或声明式并行批次。

> **非官方 / unsupported automation boundary：** 这是独立维护的 source fork，不隶属于 OpenAI，也未获 OpenAI 认可、背书或授权。ChatGPT UI、账户策略与 platform terms 可能变化并影响 browser automation；本仓库不声称 OpenAI 授权或 terms compliance，使用者须自行判断适用条款与账户风险。

高成本 Pro 运行不适合寄托在一张脆弱的浏览器标签页上。这个公开 fork 将选定的上下文、提交收据、会话身份、回答、产物和恢复 lineage 持久化在 Oracle session 中；canonical browser lane 经由独立的 Chrome for Testing profile 与 loopback CDP 进入 ChatGPT。

Oracle 负责 prompt bundle、browser action、session truth、恢复和 follow-up lineage。人负责首次登录、真实账户挑战，以及 Batch Oracle 中需要明确记录的 owner decision。OpenCLI 保留为普通咨询的显式替代 transport，不会自动接管失败的 CDP 运行。

`GPT-5.6 Pro` 是当前的人类可读目标。CLI 使用稳定别名 `gpt-5-pro`，并在提交标签页中选择和核验当前的 GPT-5.6 Sol + Pro 组合。

→ [阅读双语公开发布说明：为什么每一次 Pro consultation 都该有一条回来的路](./LAUNCH.md)

<!-- readme-sync:modes -->

## 两条主要路径

| 路径         | 适合什么                           | Oracle 持久化什么                                                                   |
| ------------ | ---------------------------------- | ----------------------------------------------------------------------------------- |
| 单会话咨询   | 一项复杂审查、研究或架构问题       | dispatch、conversation、answer、artifacts、follow-up 与恢复状态                     |
| Batch Oracle | 同一决策中至少两项可独立审查的问题 | sealed source snapshot、并行 blind lanes、barrier、owner decisions 与可选 synthesis |

Batch Oracle 的 lane 按职责拆分，不做同题投票。所有第一阶段输入先整体密封，再在本机与账户容量允许的范围内并行 dispatch；synthesis 只有在 barrier 关闭后才可能启动。

<!-- readme-sync:quickstart -->

## 快速开始

> Homebrew 与 npm 上发布的 Oracle package 来自上游仓库，不包含这个 fork 的改动。请从源码安装本仓库。

要求：Node.js 24 或更新版本，以及能够访问目标模型与 reasoning tier 的 ChatGPT 账户。

```bash
git clone https://github.com/IndelibleVivi/oracle.git
cd oracle
corepack enable
pnpm install --frozen-lockfile
pnpm build
npm link
```

安装官方 Chrome for Testing，并为 Oracle 建立独立浏览器身份：

```bash
oracle browser install
oracle browser setup --use-mock-keychain
oracle browser status
oracle browser smoke
```

`setup` 只用于首次人工登录，不开放 CDP endpoint。关闭整个 Chrome for Testing 后命令才会返回。`status` 给出无需读取 PID、port 或 executable path 的四行健康摘要。`smoke` 会执行两次真实冷启动，核验登录持久化、composer readiness、exact-target cleanup 与 endpoint shutdown，全程不提交 prompt。

在 macOS 上，`--use-mock-keychain` 是显式 unattended-mode tradeoff。它避免独立 profile 反复请求日常 Chrome Safe Storage，同时降低该 profile 的静态 cookie 保护强度；请保持目录 owner-only，并只用于 ChatGPT。

<!-- readme-sync:single-session -->

## 运行一次普通咨询

```bash
oracle --engine browser \
  --model gpt-5-pro \
  -p "Audit this change for correctness and missing tests." \
  --file "src/**"
```

Glob 和目录输入遵循仓库的 `.gitignore`（包括嵌套规则）；明确点名的文件会覆盖 ignore 规则，显式 `!` 排除仍优先。文本文件须是有效 UTF-8 且不含 binary NUL，否则咨询会在投递前停止。小文本可能直接内联在 prompt 中，因此没有附件卡片不代表没有交付文件内容。规则细节见 [CLI Reference](docs/cli-reference.md)。

长运行会保留为可恢复 session。Pro 暂时安静时，不要另起一份重复咨询；先读取或 reattach 已有 session：

```bash
oracle status --hours 72
oracle session <session-id> --render
oracle --followup <session-id> \
  -p "Challenge the previous recommendation and return the final decision."
```

Oracle 会记录已提交 turn 的 identity 与 timing evidence，并把 durable conversation ID 冻结为 capture authority；同一 tab 后来跳到别的 conversation 时不会复制或接纳那边的答案。恢复必须回到原 conversation；只有 durable receipt 明确证明 prompt 尚未提交、尚未 commit 且 `retrySafe:true` 时，显式 resume 才能创建新 attempt。

Legacy direct-CDP 提交会先激活并重新验证 exact owned target，再从新鲜 DOM 计算可信 Send 坐标；click 与 Enter 共用同一条 exact-user-turn 验证。任何可能触发提交的 input event 都必须先成功建立并持久化 dispatch boundary、current prompt digest 与 pre-dispatch turn baseline；baseline 不可用或写入失败时绝不发出 event。持久化返回后，Oracle 会再次验证 exact target ownership、完整 prompt、attachment readiness 与当前 hit-tested Send point，之后才允许 `mousePressed` 或 Enter `keyDown`；trusted-click 会先移动 pointer，再紧贴 `mousePressed` 重做这些检查。Pro response timer 不使用较早的 boundary 时间，而是在实际 `mousePressed` 或 Enter `keyDown` 紧前写入，因而 attachment processing 的 post-boundary 等待不会被误算成 reasoning time。只有在尚未发出任何 submitting event 时，Oracle 才能从不可用的 trusted-click 路径改用 Enter；一旦发出 event，就绝不自动换方法或再次 dispatch。若 exact commit 无法验证，普通 headful dedicated-profile run 会持久化为 incomplete/recoverable、`retrySafe:false` 并保留 exact tab；`oracle session <session-id> --render` 只会重新连接 stored exact target ID，绝不 fall back 到同 conversation 的另一个 tab 或新 browser。任何已经持久化 current prompt digest、但还没有 verified committed turn index 的运行（包括 `recoveryKind` 尚未写入的 non-Pro dispatch-boundary 中断）也只能使用这个 exact target。恢复还必须先把 current prompt digest 复核到 baseline 之后唯一的 user turn，才会捕获 answer，因而不会把 earlier turn（包括 ambiguous follow-up 之前的 answer）误收为结果。Pre-dispatch retained/manual state 只会 reattach exact tab 供人工检查，不会自动 capture 或 submit。`--copy-profile` 的临时 profile 与 local `--browser-headless` 的 browser process 都不会保留，因此 ambiguous、retained-draft 与 manual outcomes 都会明确标记为不可 reattach，且仍禁止自动重跑；remote Chrome 忽略这个 local launch flag，并保留自己的 exact-target recovery 语义。

首次发现 composer 非空时，Oracle 会在最多 5 秒的 bounded settle window 内只读复核，避免把 profile/SPA 恢复过程中的瞬时 draft 当成稳定状态；若内容持续存在，仍会保持原样并 fail closed。每个 submission attempt 在开始任何 upload、typing 或 dispatch 前都会证明 composer text 与 attachment set 都为空，因而 text-only run 也不会带上已有文件；attachment-bearing run 同样不会 sweeping pre-existing attachment UI，并在后续 dispatch 前要求自己的 exact attachment set。附件 processing 期间若 Send control 暂时消失，Oracle 会在 attachment timeout 内继续等待，不会立刻改走 Enter 或发出另一次 dispatch。若 attachment Send readiness 在任何 submitting event 之前失败，且 exact target、ownership 与本 attempt 的完整 prompt 都能重新证明，Oracle 才会清理这次 attempt 自己的 attachments 和 exact draft；定向移除 attachment 后，仅当 hidden file input 的完整 file set 也精确属于本 attempt 时才会清掉其 stale value，mixed/unknown input 仍然保留。最终必须在同一个 DOM snapshot 中证明 composer text 与 attachment set 都为空，才能记录 `retrySafe:true`。Auto inline prompt 转为 file fallback 时，Oracle 还会重新证明本 attempt 的 exact owned draft（`prompt-too-large` 时使用 observed truncated draft 的 digest）与第一次 upload 的 exact owned attachment set，之后才定点移除并重传；任一清理证据不足时则保留 exact tab、记录 `retrySafe:false`，绝不清空或覆盖未知内容。大型 prompt 若在 dispatch 前被截断且没有可用 file fallback，也会作为 retained draft 保留 exact tab 并记录 `retrySafe:false`。若失败发生在任何 submitting event 与 draft 产生之前，则明确记录 `retrySafe:true`，不会误导用户去 reattach 一个不存在的 retained state。

Strict `Pro` effort 的 slider 路径由可见、可交互、合法五档的 ARIA 结构决定，不再绑定某个 model family。Model identity 仍单独验证；slider 到达 maximum 后还必须读到 exact `Pro` semantic label 或 effort pill，支持 Unicode 空白/标点但拒绝 position-only、`Professional`、畸形 range 和 numeric/label contradiction。

<!-- readme-sync:broker-candidate -->

## Oracle v2 broker 候选路径

R8 在源码中提供了显式 opt-in 的 durable `broker` engine，供 CLI/MCP
cutover 验证。它不是默认引擎，不会替换上面的 `--engine browser`，也不会把
普通咨询自动切到 v2。使用前必须已有 certified v2 runtime，并单独运行 worker；
每个 live call 都必须携带稳定 idempotency key，caller 被终止后才能回到同一
job，而不是重复 Send。当前 canonical v2 worker 仅支持 macOS GUI session；
native Windows 与其他 non-macOS browser worker 仍 deferred，Windows 普通使用
继续走 legacy `browser` engine。

每个 v2 prompt object 与 sealed source bundle object 都必须不超过 16 MiB；CLI、
MCP 与 Batch 会在写入 durable client intent 或 admission 以前完成检查，超限输入
不会留下一个假装可恢复的 job。进入 `recoverable` 的 broker job 会立即返回
durable job handle 与明确的 resume/inspect 动作，而不是耗完整个 host wait timeout。

```bash
oracle worker run
oracle --engine broker \
  --idempotency-key review-auth-boundary-v1 \
  -p "Review this boundary." \
  --file "src/**"
oracle job <job-id> --events
oracle session <job-id>
```

CLI/MCP 的 broker client、job tools、timeout/reconnect 语义见
[CLI reference](docs/cli-reference.md) 与 [MCP](docs/mcp.md)。在 G3 owner gate
以前，legacy engine 仍是默认；源码候选完成不等于安装、激活或默认切换。

<!-- readme-sync:batch -->

## Batch Oracle

Batch Oracle 适合把一项复杂决策拆成不同职责的独立审查 lane，例如 product constitution、security、human cognition 与 adversarial tribunal。它保留各 lane 的原始回答和分歧，之后可由 host 直接整合，也可配置 contradiction-first synthesis。

R9 源码候选保留 v1 manifest 与 parent contract，但把每个 lane / synthesis
attempt 映射为 durable Oracle v2 job。Batch parent 只负责 sealed input、blind
lane、barrier、retry admission 和 owner closure；worker 独占 browser/page
execution。运行前必须单独启动 `oracle worker run`。`--max-parallel` 只是 Batch
client 的 admission cap，worker 仍以自己的全局 dispatch mutex 与最多三个
capture page 执行；Batch 不会自行拉起 Chrome 或堆 child tabs。

```bash
oracle batch validate batch.json5
oracle batch run batch.json5
oracle batch status <batch-id> --json
oracle batch resume <batch-id>
oracle batch accept-missing <batch-id> --lane <lane-id> --reason "<owner reason>"
oracle batch resume <batch-id> --allow-partial
oracle batch accept-missing <batch-id> --synthesis --reason "<owner reason>"
oracle batch render <batch-id> --all
```

第一阶段 lane 的缺失、以及已提交但长期不可恢复的 synthesis，都需要 owner 以 durable decision 明确关闭。Oracle 不会静默接受缺失，也不会用新 prompt 替换已 commit 的 conversation。普通 field use 通常采用两到三条独立 lane；配置式 Pro synthesis 保持可选。

只有 durable worker evidence 明确为 `failed-unsent` / verified-unsent 时，显式
`batch resume` 才会创建下一个 attempt；committed recoverable work 恢复同一
`jobId`，不会重复 Send。generic `oracle resume|abandon <job-id>` 会拒绝
Batch-owned job，所有恢复和 accept-missing 都由 parent 完成。旧的 pre-R9
child-session state 仍可只读检查，但不会被新 Batch execution 重新拉起。

完整 manifest、状态机、恢复矩阵、bundle identity 与 v1 边界见 [Batch Oracle v1](docs/batch-oracle.md)。

<!-- readme-sync:browser -->

## 为什么使用独立 Chrome

这个 fork 的 canonical lane 同时使用两层隔离：

- Chrome for Testing 提供与日常 Chrome 不同的 app identity；
- `~/.oracle/browser-profile` 提供 Oracle 专用的持久化 user-data directory。

普通运行只在 `127.0.0.1` 上开放 CDP，并以 exact target ID 管理自己创建的页面。Oracle 不会把 launcher 指向默认个人 Chrome profile，也不会依赖每次连接日常浏览器时出现的 Allow dialog。

安装和首次登录之后，Oracle 也负责这份独立 browser 的 process lifecycle：旧的受管 Chrome for Testing generation 可以先完成当前工作，并在空闲时自动 rollover；stale PID、port、lock 与已验证的幽灵进程会在 send 前或最后一个 lease 释放后安全修复。需要人工诊断时先运行 `oracle browser status`，再用 `oracle browser heal --plan` 预览；普通咨询不要求操作者处理这些内部事实。

完整 lifecycle、privacy 与 verification contract 见 [Dedicated Chrome transport](docs/dedicated-chrome.md)。

<!-- readme-sync:trust -->

## Trust boundary

| 边界               | Authority          | Contract                                                                        |
| ------------------ | ------------------ | ------------------------------------------------------------------------------- |
| Prompt 与选定文件  | Oracle             | 本地组装，只发送明确选择的 context                                              |
| Session truth      | Oracle             | 持久化 dispatch、conversation、answer、artifacts 与 lineage                     |
| Browser process    | Oracle             | 监督受管 generation，只绑定 loopback CDP，并清理 exact owned target 与空闲进程  |
| Remote service     | Host operator      | Client 只描述 conversation；host 掌握 executable、profile、transport 与 cookies |
| App identity       | Chrome for Testing | 不把 Oracle 进程注册成日常 Chrome                                               |
| Browser data       | Dedicated profile  | 将 ChatGPT 登录状态与个人浏览、其他账户分离                                     |
| Account 与缺失决策 | Human owner        | 完成首次登录、真实挑战和显式 owner closure                                      |

<!-- readme-sync:scope -->

## 当前 fork 范围

| 能力                      | Dedicated CDP |  OpenCLI alternative |
| ------------------------- | ------------: | -------------------: |
| GPT-5.6 Pro 文本咨询      |           Yes |                  Yes |
| 持久化隔离登录            |           Yes | Browser Bridge-owned |
| 恢复且不重复提交          |           Yes |                  Yes |
| Oracle follow-up lineage  |           Yes |                  Yes |
| Deep Research             |           Yes |  No；dispatch 前拒绝 |
| 图像生成与下载            |           Yes |  No；dispatch 前拒绝 |
| Batch Oracle v1           |           Yes |                   No |
| 自动跨 transport fallback |         Never |                Never |

Attach-running personal Chrome、remote Chrome、API、MCP 与 render path 仍作为独立显式模式存在。它们的边界见 [Browser Mode](docs/browser-mode.md)。

<!-- readme-sync:docs -->

## 文档入口

| 从这里开始                                                                      | 内容                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Dedicated Chrome transport](docs/dedicated-chrome.md)                          | canonical topology、setup、lifecycle、privacy 与 verification               |
| [Install from source](docs/install.md)                                          | 本 fork 唯一 install path 与 upstream-only distribution appendix            |
| [Batch Oracle v1](docs/batch-oracle.md)                                         | parallel-first manifest、sealing、barrier、synthesis、recovery 与 rendering |
| [Quickstart](docs/quickstart.md)                                                | 首次登录、smoke、第一次咨询、render 与 reattach                             |
| [Browser Mode](docs/browser-mode.md)                                            | direct CDP、attach-running、remote Chrome、OpenCLI、Deep Research 与 images |
| [OpenCLI alternative](docs/opencli-transport.md)                                | sealed bridge handoff 与 waiter-only recovery                               |
| [Coding Agents](docs/agents.md)                                                 | Codex、Claude Code、Cursor、CLI 与 MCP 使用方式                             |
| [Sessions](docs/sessions.md) · [Follow-ups](docs/followup.md)                   | durable runs 与 conversation lineage                                        |
| [Configuration](docs/configuration.md) · [CLI reference](docs/cli-reference.md) | 配置优先级、flags 与 limits                                                 |
| [Upstream parity](docs/upstream-parity.md)                                      | merge base、逐 commit intake 分类与 fork-local evidence                     |

<!-- readme-sync:development -->

## 开发与验证

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm docs:check
pnpm test:packed-cli
pnpm public:check
```

`oracle browser smoke` 是 account-safe 的 live transport test：它会冷启动两次，并且不会创建 ChatGPT conversation。

<!-- readme-sync:provenance -->

## Provenance 与许可

这是 [steipete/oracle](https://github.com/steipete/oracle) 的公开 fork，保留上游 Git history 与 MIT license。独立 Chrome 默认路径、fork 的 Pro timing / receipt contract、OpenCLI alternative，以及 Batch Oracle 属于本 fork 的实现与维护范围；这里不是上游 release，也不附属于、代表、获 OpenAI 背书或授权，且不声称 platform-terms compliance。

MIT。见 [LICENSE](LICENSE)。
