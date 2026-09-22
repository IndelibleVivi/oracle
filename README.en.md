<!-- readme-sync:language -->
<p align="right">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="./assets/readme/oracle-hero.svg" alt="Oracle visual identity: an indigo and gold wordmark above sealed context, exact-session recovery, declared batches, and dedicated Chrome capabilities" width="1100">
</p>

<!-- readme-sync:identity -->

# Oracle / IndelibleVivi fork

> Recoverable GPT-5.6 Pro consultations — one durable session or a declared parallel batch.

> **Unofficial / unsupported automation boundary:** This independently maintained source fork is not affiliated with, endorsed by, or authorized by OpenAI. ChatGPT UI, account policy, and platform terms may change and may affect browser automation. This repository makes no claim of OpenAI authorization or terms compliance; operators are responsible for evaluating applicable terms and account risk.

A high-cost Pro run should not depend on one fragile browser tab. This public fork persists selected context, dispatch receipts, conversation identity, answers, artifacts, and recovery lineage inside an Oracle session. Its canonical browser lane reaches ChatGPT through a dedicated Chrome for Testing profile and loopback CDP.

Oracle owns the prompt bundle, browser actions, session truth, recovery, and follow-up lineage. The human owns the first sign-in, real account challenges, and explicit owner decisions required by Batch Oracle. OpenCLI remains an explicit alternative transport for ordinary consultations; it never takes over a failed CDP run automatically.

`GPT-5.6 Pro` is the current human-facing target. The CLI uses the stable alias `gpt-5-pro` and selects and verifies the current GPT-5.6 Sol + Pro combination in the submission tab.

→ [Read the bilingual public launch note: why every Pro consultation needs a way back](./LAUNCH.md)

<!-- readme-sync:modes -->

## Two primary paths

| Path                | Best for                                                            | What Oracle persists                                                                           |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Single consultation | One complex review, research, or architecture question              | dispatch, conversation, answer, artifacts, follow-up, and recovery state                       |
| Batch Oracle        | At least two independently reviewable questions inside one decision | sealed source snapshot, parallel blind lanes, barrier, owner decisions, and optional synthesis |

Batch lanes are separated by responsibility rather than used as a same-question voting panel. Every first-stage input is sealed before any dispatch. Lanes then run concurrently within local and account capacity, and synthesis can start only after the barrier closes.

<!-- readme-sync:quickstart -->

## Quick start

> The Oracle packages published through Homebrew and npm come from upstream and do not contain this fork's changes. Install this repository from source.

Requirements: Node.js 24 or newer and a ChatGPT account with access to the requested model and reasoning tier.

```bash
git clone https://github.com/IndelibleVivi/oracle.git
cd oracle
corepack enable
pnpm install --frozen-lockfile
pnpm build
npm link
```

Install the official Chrome for Testing build and establish an Oracle-only browser identity:

```bash
oracle browser install
oracle browser setup --use-mock-keychain
oracle browser status
oracle browser smoke
```

`setup` is used only for the first human sign-in and does not expose a CDP endpoint. The command returns after the entire Chrome for Testing browser is closed. `status` provides a four-line health summary without requiring the operator to read a PID, port, or executable path. `smoke` performs two real cold starts and verifies persisted authentication, composer readiness, exact-target cleanup, and endpoint shutdown without submitting a prompt.

On macOS, `--use-mock-keychain` is an explicit unattended-mode tradeoff. It prevents the isolated profile from repeatedly requesting access to everyday Chrome Safe Storage while weakening at-rest cookie protection for that profile. Keep the directory owner-only and ChatGPT-only.

<!-- readme-sync:single-session -->

## Run one consultation

```bash
oracle --engine browser \
  --model gpt-5-pro \
  -p "Audit this change for correctness and missing tests." \
  --file "src/**"
```

Glob and directory inputs honor repository `.gitignore` rules, including nested rules. An explicitly named file overrides those rules; an explicit `!` exclusion still wins. Text files must be valid UTF-8 without binary NUL or the consultation stops before dispatch. Small text files may be inlined into the prompt, so no attachment card does not mean their contents were omitted. See the [CLI Reference](docs/cli-reference.md) for the exact selection rules.

Long runs remain recoverable sessions. When Pro is quiet, do not create a duplicate consultation. Read or reattach the existing session first:

```bash
oracle status --hours 72
oracle session <session-id> --render
oracle --followup <session-id> \
  -p "Challenge the previous recommendation and return the final decision."
```

Oracle records the committed turn identity and timing evidence and freezes the durable conversation ID as capture authority; if the same tab later navigates elsewhere, Oracle does not copy or accept that other conversation's answer. Recovery must return to the original conversation. A new attempt is allowed only on explicit resume after a durable receipt proves that the prompt was unsubmitted, uncommitted, and `retrySafe:true`.

Legacy direct-CDP submission activates and revalidates the exact owned target before measuring a fresh trusted Send point; clicks and Enter share one exact-user-turn verification path. Every potentially submitting input event requires the dispatch boundary, current prompt digest, and pre-dispatch turn baseline to be established and durably persisted first; an unavailable baseline or persistence failure prevents the event. After persistence returns, Oracle revalidates exact target ownership, the complete prompt, attachment readiness, and the current hit-tested Send point before allowing `mousePressed` or Enter `keyDown`; trusted-click moves the pointer first and then repeats those checks immediately before `mousePressed`. Pro response timing uses a marker written immediately before the actual `mousePressed` or Enter `keyDown`, not the earlier boundary time, so post-boundary attachment processing is not counted as reasoning time. Oracle may move from an unavailable trusted-click path to Enter only before any submitting event has been emitted. After either event, it never changes methods or dispatches again automatically. If the exact commit cannot be verified, an ordinary headful dedicated-profile run is persisted as incomplete/recoverable with `retrySafe:false` and preserves the exact tab. `oracle session <session-id> --render` reconnects only to the stored exact target ID, never another tab for the same conversation or a new browser. Any run with a persisted current-prompt digest but no verified committed turn index—including a non-Pro dispatch-boundary interruption before `recoveryKind` was written—is also exact-target-only. Recovery must then reconcile the current prompt digest to one unique user turn after that baseline before capturing an answer, so an earlier turn—including the answer preceding an ambiguous follow-up—cannot become the result. Pre-dispatch retained/manual states reattach only for exact-tab inspection and never auto-capture or submit. Because `--copy-profile` always deletes its temporary profile and local `--browser-headless` does not retain its browser process, ambiguous, retained-draft, and manual outcomes are explicitly non-reattachable in those modes and still block automatic rerun. Remote Chrome ignores that local launch flag and preserves its own exact-target recovery semantics.

When Oracle first observes a non-empty composer, it performs read-only checks for a bounded settle window of up to five seconds so transient profile/SPA restoration is not mistaken for stable draft state; persistent content still remains untouched and fails closed. Before a submission attempt begins any upload, typing, or dispatch, it proves that both composer text and the attachment set are empty, so a text-only run cannot carry an existing file; attachment-bearing runs likewise never sweep pre-existing attachment UI and later require their exact owned set before dispatch. If the Send control temporarily disappears while an attachment is processing, Oracle keeps waiting within the attachment timeout instead of immediately switching to Enter or emitting another dispatch. If attachment Send readiness fails before any submitting event, Oracle clears only that attempt's attachments and exact draft after re-verifying the exact target, ownership, and complete prompt. After targeted attachment removal, it resets a stale hidden file input only when that input's complete file set also belongs exactly to the attempt; mixed or unknown input remains retained. A final single DOM snapshot must prove that both composer text and the attachment set are empty before Oracle records `retrySafe:true`. When an automatic inline prompt changes to file fallback, Oracle likewise re-verifies the attempt's exact owned draft (using the observed truncated draft digest for `prompt-too-large`) and the first upload's exact owned attachment set before removing and re-uploading them. If any cleanup proof is missing, it preserves the exact tab with `retrySafe:false` and never clears or overwrites unknown content. A large prompt truncated before dispatch with no usable file fallback is likewise retained in its exact tab with `retrySafe:false`. A failure before any submitting event or draft exists is explicitly `retrySafe:true` and does not direct the user to reattach nonexistent retained state.

The strict `Pro` effort slider path is selected by a visible, interactive, valid five-position ARIA structure rather than a model family. Model identity remains independently verified; reaching the maximum must also agree with an exact `Pro` semantic label or effort pill. Unicode whitespace and punctuation are accepted, while position-only, `Professional`, malformed ranges, and numeric/label contradictions fail closed.

<!-- readme-sync:broker-candidate -->

## Oracle v2 broker candidate

R8 exposes an explicit opt-in durable `broker` engine in source for CLI/MCP
cutover validation. It is not the default engine, does not replace the
`--engine browser` path above, and does not move Batch to v2 early. It requires
an already certified v2 runtime and a separately running worker. Every live
call must carry a stable idempotency key so a killed caller can return to the
same job instead of repeating Send. The canonical v2 worker currently supports
only macOS GUI sessions; native Windows and other non-macOS browser workers
remain deferred, so ordinary Windows use stays on the legacy `browser` engine.

Each v2 prompt object and sealed source bundle object must be no larger than 16
MiB. CLI, MCP, and Batch check that boundary before writing durable client
intent or attempting admission, so an oversized input does not leave a falsely
recoverable job. A broker job that reaches `recoverable` returns its durable job
handle and explicit resume/inspect action immediately instead of consuming the
full host wait timeout.

```bash
oracle worker run
oracle --engine broker \
  --idempotency-key review-auth-boundary-v1 \
  -p "Review this boundary." \
  --file "src/**"
oracle job <job-id> --events
oracle session <job-id>
```

See the [CLI reference](docs/cli-reference.md) and [MCP](docs/mcp.md) for broker
clients, job tools, and timeout/reconnect semantics. The legacy engine remains
the default until the G3 owner gate; source-candidate completion is not
installation, activation, or a default switch.

<!-- readme-sync:batch -->

## Batch Oracle

Batch Oracle separates one complex decision into independent review responsibilities such as product constitution, security, human cognition, and an adversarial tribunal. It preserves every raw lane answer and disagreement. The host may integrate those answers directly or configure a contradiction-first synthesis.

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

A missing first-stage lane and a committed synthesis that remains unavailable after bounded recovery both require an explicit durable owner decision. Oracle never silently accepts missing work and never replaces a committed conversation with a new prompt. Ordinary field use usually means two or three independent lanes; configured Pro synthesis remains optional.

See [Batch Oracle v1](docs/batch-oracle.md) for the manifest, state machine, recovery matrix, bundle identity, and v1 boundaries.

<!-- readme-sync:browser -->

## Why a dedicated Chrome

The canonical lane in this fork uses two isolation boundaries together:

- Chrome for Testing provides an application identity separate from everyday Chrome.
- `~/.oracle/browser-profile` provides an Oracle-only persistent user-data directory.

Ordinary runs expose CDP only on `127.0.0.1` and manage pages by exact target ID. Oracle never points its launcher at the default personal Chrome profile and does not depend on the recurring Allow dialog used when an agent connects to everyday Chrome.

After installation and the first sign-in, Oracle also owns the dedicated browser process lifecycle. A healthy older managed Chrome for Testing generation can finish current work and roll over automatically when idle. Stale PID, port, and lock metadata, plus verified ghost processes, are repaired before send or after the final lease releases. For human diagnostics, start with `oracle browser status`, then preview an explicit repair with `oracle browser heal --plan`; ordinary consultations do not require the operator to manage these internals.

See [Dedicated Chrome transport](docs/dedicated-chrome.md) for the full lifecycle, privacy, and verification contract.

<!-- readme-sync:trust -->

## Trust boundary

| Boundary                           | Authority          | Contract                                                                                 |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Prompt and selected files          | Oracle             | Assemble locally and send only explicitly selected context                               |
| Session truth                      | Oracle             | Persist dispatch, conversation, answer, artifacts, and lineage                           |
| Browser process                    | Oracle             | Supervise managed generations, bind only loopback CDP, and drain exact owned idle state  |
| Remote service                     | Host operator      | Client describes the conversation; host owns executable, profile, transport, and cookies |
| App identity                       | Chrome for Testing | Keep Oracle processes separate from everyday Chrome                                      |
| Browser data                       | Dedicated profile  | Separate ChatGPT login state from personal browsing and other accounts                   |
| Account and missing-work decisions | Human owner        | Complete first sign-in, real challenges, and explicit owner closure                      |

<!-- readme-sync:scope -->

## Current fork scope

| Capability                         | Dedicated CDP |          OpenCLI alternative |
| ---------------------------------- | ------------: | ---------------------------: |
| GPT-5.6 Pro text consultation      |           Yes |                          Yes |
| Persistent isolated login          |           Yes |         Browser Bridge-owned |
| Recovery without resubmission      |           Yes |                          Yes |
| Oracle follow-up lineage           |           Yes |                          Yes |
| Deep Research                      |           Yes | No; rejected before dispatch |
| Image generation and download      |           Yes | No; rejected before dispatch |
| Batch Oracle v1                    |           Yes |                           No |
| Automatic cross-transport fallback |         Never |                        Never |

Attach-running personal Chrome, remote Chrome, API, MCP, and render paths remain separate explicit modes. See [Browser Mode](docs/browser-mode.md) for their boundaries.

<!-- readme-sync:docs -->

## Documentation

| Start here                                                                      | Contents                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Dedicated Chrome transport](docs/dedicated-chrome.md)                          | canonical topology, setup, lifecycle, privacy, and verification                |
| [Install from source](docs/install.md)                                          | this fork's only install path and the upstream-only distribution appendix      |
| [Batch Oracle v1](docs/batch-oracle.md)                                         | parallel-first manifests, sealing, barrier, synthesis, recovery, and rendering |
| [Quickstart](docs/quickstart.md)                                                | first sign-in, smoke, first consultation, render, and reattach                 |
| [Browser Mode](docs/browser-mode.md)                                            | direct CDP, attach-running, remote Chrome, OpenCLI, Deep Research, and images  |
| [OpenCLI alternative](docs/opencli-transport.md)                                | sealed bridge handoff and waiter-only recovery                                 |
| [Coding Agents](docs/agents.md)                                                 | Codex, Claude Code, Cursor, CLI, and MCP usage                                 |
| [Sessions](docs/sessions.md) · [Follow-ups](docs/followup.md)                   | durable runs and conversation lineage                                          |
| [Configuration](docs/configuration.md) · [CLI reference](docs/cli-reference.md) | config precedence, flags, and limits                                           |
| [Upstream parity](docs/upstream-parity.md)                                      | merge base, commit-by-commit intake, and fork-local evidence                   |

<!-- readme-sync:development -->

## Development and verification

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm docs:check
pnpm test:packed-cli
pnpm public:check
```

`oracle browser smoke` is the account-safe live transport test: it performs two cold starts and never creates a ChatGPT conversation.

<!-- readme-sync:provenance -->

## Provenance and license

This is a public fork of [steipete/oracle](https://github.com/steipete/oracle), preserving upstream Git history and the MIT license. The dedicated-Chrome default path, the fork's Pro timing and receipt contract, the OpenCLI alternative, and Batch Oracle are maintained within this fork. This repository is neither an upstream release nor affiliated with, endorsed by, or authorized by OpenAI, and it makes no platform-terms-compliance claim.

MIT. See [LICENSE](LICENSE).
