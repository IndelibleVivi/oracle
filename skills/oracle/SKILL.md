---
name: oracle
description: "Oracle second-model review: bundle prompts/files, debug, refactor, design."
---

# Oracle (CLI) — best use

Oracle bundles a prompt and selected files for a ChatGPT GPT-5.6 Pro
second-model review with real repository context. The canonical lane is browser
mode over direct CDP with Oracle's dedicated profile. A prompt is required;
attach files only when they add necessary context. Treat responses as advisory
and verify them against the codebase and tests.

This fork reserves the canonical Oracle lane for ChatGPT GPT-5.6 Pro. Use
OpenCLI separately for incidental Gemini queries; Oracle never dispatches or
falls back to Gemini.

## Main use case (browser, GPT-5.6)

Use browser mode with GPT-5.6 when the ChatGPT account exposes it. GPT-5.6 Sol
and GPT-5.6 Sol Pro are distinct targets: base Sol uses the Extra High effort
setting, while Pro is a separate picker target for difficult or long-running
work.

Recommended defaults:

- Engine: browser (`--engine browser`)
- Browser transport: direct CDP (`--browser-transport cdp`)
- Window: visible while needed and never activated for submission; the isolated
  profile persists, while Chrome drains after the last ordinary run unless
  active/recoverable work or an unowned meaningful page remains. macOS cold
  starts use LaunchServices background-open semantics plus
  `--no-startup-window`, new tabs use `focus:false`, and page-side focus
  emulation supports trusted input without changing the frontmost app
- Base Sol: `--model gpt-5.6-sol`
- Base Sol maximum reasoning: `--browser-thinking-time extra-high` (Extra High)
- Explicit Pro effort on GPT-5.6 Sol: `--browser-thinking-time pro` (fails closed if Pro cannot be confirmed)
- Browser GPT-5.5 with Pro effort: `--model gpt-5.5 --browser-thinking-time pro`
- API Pro maximum reasoning: `--model gpt-5.6-sol --reasoning-mode pro --reasoning-effort max`
- Attachments: directories/globs plus excludes; never attach secrets by default

GPT-5.6 availability is account-dependent. Confirm the base Sol picker and
retain model-selection evidence. A bare `Pro` picker label proves picker
selection but does not, by itself, prove the server-side Pro generation. If the
Pro target cannot be confirmed, fail closed; do not substitute another model.

## GPT-5.6 model selection

This version supports GPT-5.6 on both surfaces, but Pro selection differs:

- `gpt-5.6`: follow the GPT-5.6 family default
- `gpt-5.6-sol`: pin ChatGPT's `GPT-5.6 Sol` entry
- Browser: `gpt-5-pro` selects ChatGPT's `Pro` target
- API: `--reasoning-mode pro` enables Pro execution on `gpt-5.6-sol`; pair it with `--reasoning-effort max` for maximum reasoning

For the canonical GPT-5.6 Pro browser lane, use:

```bash
oracle --engine browser --browser-transport cdp --model gpt-5-pro \
  --browser-thinking-time pro \
  -p "<task>" --file "src/**"
```

For GPT-5.6 Sol Pro through the Responses API, use:

```bash
oracle --engine api --model gpt-5.6-sol \
  --reasoning-mode pro \
  --reasoning-effort max \
  -p "<task>" --file "src/**"
```

Do not use `--model "GPT-5.6 Sol Pro"`. Pro is intentionally handled as a
browser picker target and an API reasoning mode. Browser label validation rejects unknown future
variants such as `gpt-5.6-luna` instead of silently falling back to Sol; API
runs preserve such provider model IDs unchanged.

Browser mode maps these aliases to ChatGPT's Sol picker. API and multi-model
runs preserve the corresponding first-party OpenAI model IDs; provider-qualified
and unrelated custom IDs remain pass-through values.

The GPT-5.6 browser support depends on the unified Intelligence picker. It
recognizes the current English and Chinese effort labels, avoids matching
`高` inside `极高`, drives the current five-step Power slider through its ARIA
position and keyboard-owning row when Pro is not a static menu option, and
re-queries the composer pill after React replaces it so selection verification
cannot rely on a detached stale node.

## Golden path

1. Pick the smallest file set that still contains the truth.
2. Run the browser consultation directly. Normal consults must not run
   dry-runs, smoke tests, live tests, doctor, or preflight validation unless a
   concrete bundle/runtime uncertainty makes that diagnostic material.
3. Use browser mode, direct CDP, and the GPT-5.6 Pro target. Do not switch
   model, tier, provider, or transport silently.
4. If a run detaches or times out, reattach to the stored session instead of
   starting a duplicate.

## Commands

- Show help:
  - `oracle --help --verbose`

- Optional bundle diagnostics (large or uncertain file sets only):
  - `oracle --dry-run summary -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - `oracle --dry-run full -p "<task>" --file "src/**"`

- Inspect token usage:
  - `oracle --dry-run summary --files-report -p "<task>" --file "src/**"`

- Browser run:
  - `oracle --engine browser --browser-transport cdp --model gpt-5-pro --browser-thinking-time pro -p "<task>" --file "src/**"`

- Manual paste fallback:
  - `oracle --render-markdown --copy-markdown -p "<task>" --file "src/**"`
  - `--render` is an alias for `--render-markdown`.

- Performance trace:
  - `oracle --perf-trace --perf-trace-path /tmp/oracle-perf.json --dry-run summary -p "<task>" --file "src/**"`

## Parallel-first Batch Oracle

Use a declared batch when one difficult decision contains at least two
independent, decision-relevant questions whose prompts and evidence can be
sealed before either answer is known.

For every lane, state its mandate, why it exists, falsification target,
authority/files, exact prompt, and output contract. Do not fan out an identical
prompt for voting or manufacture distinction through reviewer personas alone.

Before dispatch, determine the ready set. A lane belongs in the current
parallel stage whenever its complete input can already be sealed. Dispatch all
ready lanes concurrently up to the owner's configured capacity. Do not
serialize independent work for procedural convenience.

Resolve the ready-set membership, copy each admitted source exactly once into
the owner-only batch snapshot, and assemble every first-stage lane from that
published snapshot. Seal every lane before dispatching any of them.
Independent lanes receive a blind first pass and never see sibling answers
while the stage is open.

Arrival order is transport state, not epistemic priority. Persist each raw
answer and receipt as it arrives, but do not perform rolling synthesis, rewrite
sibling prompts, or choose a direction before the barrier closes.

A batch owns one recoverable logical session per lane. Reattach quiet,
detached, or timed-out work within that lane. Create another attempt only when
durable evidence proves the prior prompt was unsubmitted, uncommitted, and
retry-safe. Once `dispatchStartedAt` exists, missing runtime evidence is
indeterminate rather than permission to send again.

Close the first-stage barrier only after every required lane is terminal.
Partial synthesis requires two explicit owner actions: record each unavailable
lane with `oracle batch accept-missing <batch-id> --lane <lane-id> --reason
"<reason>"`, then resume with `--allow-partial`. It must name missing lanes and
weakened conclusions.

Batch child sessions may be inspected by ID, where inspection means only
reading status/metadata, rendering existing logs/artifacts, or printing paths.
A plain `oracle session <child-id>` attach must return one read-only snapshot:
never wait, auto-reattach, repair capture, append logs/artifacts, update a model
run/session, or terminalize. Completed children remain renderable.

Never complete, recover, continue, or clone a Batch child with generic
`session --live|--harvest`, `--followup <child-id>`, or `restart <child-id>`.
Those paths fail closed before tab access, conversation URL resolution, or new
session creation, including for an owner-abandoned synthesis. Use `oracle batch
resume <batch-id>` for recovery/retry/completion and the parent
`batch accept-missing` commands for owner closure. Start a new ordinary Oracle
run explicitly when the desired consultation must be independent of the Batch
lineage.

A synthesis session receives canonical shared-authority bytes plus each
verified answer, its immutable receipt, and its sealed input manifest. It must
preserve dissent, identify unsupported agreement, produce a contradiction
matrix, expose owner-pending decisions, and propose one bounded next experiment
with kill criteria. Never decide by majority vote alone.

When every first-stage lane is accepted but synthesis remains `recoverable`,
`error`, or `indeterminate` after bounded exact recovery, the owner may preserve
that child and close the stage with `oracle batch accept-missing <batch-id>
--synthesis --reason "<reason>"`. This marks synthesis `abandoned` and the
parent `partial`; it never resends and does not discard verified lane answers.

Keep raw answers durable and loadable on demand. Do not permanently inject
every long child answer into the host's working context. During an open stage,
retain only batch status, lane identities, receipts, and paths.

Batch v1 has one independent parallel stage plus one optional synthesis stage.
Do not recursively spawn batches or grow an undeclared workflow DAG. Use only
the owner's configured capacity. Stop and report allowance or request-frequency
gates; never bypass them by changing model, transport, provider, account, or
engine.

Use `oracle batch validate <manifest.json5>` before the first real run when the
manifest or file scope is new. Continue with `oracle batch run`, then recover
the parent through `oracle batch status` and `oracle batch resume`; do not
restart individual Batch children. Load raw answers only when needed through
`oracle batch render --lane` or `--all`.

## Attaching files

`--file` accepts files, directories, and globs. Pass it multiple times or use
comma-separated entries.

- Include: `--file "src/**"`, `--file src/index.ts`, `--file docs --file README.md`
- Exclude: prefix a pattern with `!`, for example `--file "!src/**/*.test.ts"`
- Default ignored directories: `node_modules`, `dist`, `coverage`, `.git`,
  `.turbo`, `.next`, `build`, and `tmp`
- Globs/directories honor worktree `.gitignore` rules (including nested rules
  and negations) and do not follow symlinks. An exact file argument overrides
  ignores even alongside globs; explicit `!` exclusions still win.
- Text inputs require valid UTF-8 without binary NUL. Convert other encodings
  explicitly; invalid text stops preparation before broker admission. Browser
  raw uploads retain their separate binary path.
- Dotfiles require an explicit dot-segment in the pattern, such as
  `--file ".github/**"`.
- Files over 1 MB are rejected by default; configure
  `ORACLE_MAX_FILE_SIZE_BYTES` or `maxFileSizeBytes` when necessary.

Keep total input under roughly 196k tokens. Use `--files-report` or
`--dry-run json` to identify oversized inputs. Never attach `.env` files,
private keys, auth tokens, or other secrets unless they have been redacted and
are essential to the question.

## Engines and browser controls

- The canonical skill invocation explicitly selects browser mode, direct CDP,
  and GPT-5.6 Pro; it does not rely on engine auto-selection.
- Browser mode in this fork supports ChatGPT GPT targets only. API-only models
  remain available only when the operator explicitly intends an API run.
- API runs require explicit user consent because they may incur usage costs.
- Browser attachments use `--browser-attachments auto|never|always`.
- For many files, add `--browser-bundle-files --browser-bundle-format auto|zip`.
- Reuse an existing Chrome session with `--browser-tab <ref>`,
  `--browser-attach-running`, or `--remote-chrome <host:port>`.
- Use `--browser-model-strategy select|current|ignore` to control picker
  behavior.
- Use `--browser-follow-up "<prompt>"` for another turn in the same browser
  conversation, or `--followup <sessionId|responseId>` for a stored run.
- Use `--browser-research deep` only when Deep Research is explicitly wanted.

## API preflight

Before an API run, check provider readiness without printing secrets:

```bash
oracle doctor --providers --models gpt-5.4,claude-4.6-sonnet
oracle --preflight --models gpt-5.4,claude-4.6-sonnet
oracle --route --model gpt-5.4
```

Use `--provider openai` or `--no-azure` when first-party OpenAI routing is
required. For multi-model panels where partial success is useful, use
`--allow-partial --write-output <path>` so successful outputs and the manifest
can be recovered.

Set an explicit deadline for automation, for example `--timeout 10m`; Oracle
derives the HTTP timeout unless `--http-timeout` is supplied.

## Sessions and recovery

- Sessions are stored under `~/.oracle/sessions`; override with
  `ORACLE_HOME_DIR`.
- Browser artifacts include `transcript.md` and, when available, research
  reports and generated images.
- List recent sessions with `oracle status --hours 72`.
- Attach with `oracle session <id> --render`.
- Use `--slug "<3-5 words>"` for readable session IDs.
- If a run times out, reattach; do not re-run it. Use `--force` only when a
  genuinely new identical run is intended.
- Direct CDP defaults to `browserLifetime:"while-needed"`. The creation-time
  CDP target ID is immutable ownership evidence. Browser-terminal owned tabs
  close even when later evidence admission rejects the captured result;
  recoverable incomplete tabs receive bounded holds; unknown
  meaningful pages are preserved. Startup/final-release reconciliation closes
  terminal owned targets, coalesces blank sentinels, and reports a durable
  `complete`, `partial`, or `failed` receipt without holding the lease registry
  during CDP work. `persistent` is an explicit always-on mode.
- Oracle owns the dedicated Chrome process lifecycle after one-time setup. A
  healthy older managed generation may finish current work with rollover
  pending; the final idle release drains it. Startup repairs stale PID/port/
  lock metadata and a verified unusable managed process once before Send.
  Check `oracle browser status`; use `oracle browser heal --plan` and then
  `oracle browser heal` only for explicit no-prompt maintenance. Both preserve
  active/recoverable work and refuse foreign, everyday, attach-running, remote,
  or ambiguous owners.
- A missing model-selector button is not permission to retry a Pro request with
  `--browser-model-strategy current` or `ignore`. The canonical lane reloads
  the same Oracle-owned target once before Send and re-runs strict model/effort
  verification. If that bounded repair still fails, report the consultation as
  unsent and stop; never navigate an attached user-owned tab, create a
  replacement target, switch transport, or weaken the requested model.
- Diagnose retained tabs with `oracle browser reconcile-tabs --plan`. Apply
  ordinary owned/blank cleanup with `--apply`; add
  `--include-untracked-chatgpt` only when the operator explicitly intends to
  purge historical ChatGPT pages from Oracle's verified exact local Chrome for
  Testing profile. Never use that mode for attach-running, remote, everyday, or
  another Chrome profile.
- Keep caller-facing output task-level by default: preparing, sent, waiting,
  and complete, plus a repair phase only when one actually occurs. If browser
  startup fails before a verified Send, say that the review was not sent and
  preserve `promptSubmitted:false`; do not describe it as a started independent
  review, expose PID/port/executable/receipt internals, write private
  continuity, or launch a duplicate consultation merely to make the failure
  look complete.
- For direct-CDP Pro runs, trust is turn-scoped. The active turn must have its
  own dispatch/elapsed/workload receipt, a verified commit, and a normalized
  prompt digest bound to the exact committed user-turn index. Reattach accepts
  only the assistant successor of that matched turn. The first durable
  conversation URL is accepted only after that committed turn matches, then its
  conversation ID is frozen: same-target navigation to another conversation
  must stop thinking/response/Copy capture without overwriting the original
  recovery receipt. Treat
  `pro-turn-not-committed`, `pro-turn-identity-mismatch`,
  `conversation-id-mismatch`, `committed-prompt-mismatch`,
  `pro-response-timing-indeterminate`, and partial active workload as terminal;
  never start a duplicate to work around them.
- Attachment bytes are established before each Pro dispatch, including
  fallback submissions. A missing size is read from the local file; it is never
  counted as zero.
- Oracle has no ChatGPT conversation-archive capability. Conversations remain
  visible for inspection, recovery, provenance, and manual follow-up. Browser
  target cleanup may close Oracle-owned Chrome targets; it must never archive
  or delete the corresponding ChatGPT account conversation.

## Prompt template

Oracle starts with zero project knowledge. Include:

- Project briefing: stack, services, build/test commands, and platform constraints
- Where things live: entrypoints, configs, key modules, and dependency boundaries
- Exact question, prior attempts, and verbatim error text
- Constraints such as API compatibility, performance budgets, and files not to change
- Desired output such as a patch plan, tests, risk list, or tradeoff comparison

For a long investigation, make the prompt restorable: put a 6–30 sentence
briefing at the top, concrete reproduction and errors in the middle, and attach
all context files required by a fresh model at the bottom. Oracle runs are
one-shot; the model does not remember prior runs.
