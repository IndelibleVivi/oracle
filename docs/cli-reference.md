---
title: CLI Reference
description: "Every flag you'll actually use, grouped by what it does. Run `oracle --help --verbose` for the full hidden list."
---

This is the curated cheatsheet. The authoritative source is always `oracle --help` (and `oracle --help --verbose` for advanced flags).

## Commands

| Command                        | What it does                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `oracle [flags] -p "<prompt>"` | Run a consult.                                                                              |
| `oracle status`                | List recent sessions (see [Sessions](sessions.md)).                                         |
| `oracle session <id>`          | Replay or block on an ordinary stored session; read a durable v2 job projection by job ID.  |
| `oracle restart <id>`          | Re-run an ordinary session with the same prompt + files.                                    |
| `oracle batch …`               | Validate, run, close, resume, inspect, or render a parallel batch.                          |
| `oracle docs check`            | Check documented flags against CLI help metadata.                                           |
| `oracle job <job-id>`          | Inspect one durable Oracle v2 job and final result handle.                                  |
| `oracle resume <job-id>`       | Resume an eligible ordinary v2 capture without retrying Send.                               |
| `oracle abandon <job-id>`      | Record owner abandonment for an eligible ordinary v2 job.                                   |
| `oracle worker …`              | Run, inspect, or diagnose the opt-in v2 worker.                                             |
| `oracle serve`                 | Run the loopback-only-by-default remote browser host (see [Browser Mode](browser-mode.md)). |
| `oracle bridge claude-config`  | Emit a `.mcp.json` for Claude Code (see [MCP](mcp.md)).                                     |
| `oracle tui`                   | Interactive TUI (humans only).                                                              |
| `oracle-mcp`                   | Stdio MCP server entrypoint.                                                                |

## Batch Oracle

| Command                                                              | Purpose                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `oracle batch validate <manifest.json5>`                             | Strictly validate JSON5, paths, duplicate lanes, and declared job caps without admission.                |
| `oracle batch run <manifest.json5>`                                  | Seal all first-stage lanes and admit the blind ready set as Batch-owned durable v2 jobs.                 |
| `oracle batch status [batch-id] [--json]`                            | Reconcile durable worker jobs and show one Batch, or list recent batches.                                |
| `oracle batch resume <batch-id>`                                     | Resume committed capture on the same job; create a new attempt only after verified-unsent/failed-unsent. |
| `oracle batch accept-missing <batch-id> --lane <id> --reason <text>` | Preserve the job lineage and record an explicit owner closure for one unavailable lane.                  |
| `oracle batch accept-missing <batch-id> --synthesis --reason <text>` | Preserve an unavailable terminal synthesis job and close the parent honestly as `partial`.               |
| `oracle batch resume <batch-id> --allow-partial`                     | Cross the barrier after every unavailable lane has an `accept-missing` decision.                         |
| `oracle batch render <batch-id> [--lane <id>\|--all]`                | Render status, one verified raw answer, or all answers in manifest order followed by synthesis.          |

`batch run --max-parallel <count>` can only lower the effective manifest,
user-config, and Batch client admission capacity. It does not define or reserve
browser pages. New Batch work requires a separately running v2 worker, which
owns global dispatch serialization and a maximum of three concurrent capture
pages. Batch v1 still requires exact GPT-5.6 Pro/Sol selection and the Pro
reasoning tier. See
[Batch Oracle v1](batch-oracle.md).

Batch job inspection is read-only. Generic `oracle resume <job-id>` and
`oracle abandon <job-id>` reject Batch-owned jobs; the parent uses exact-owner
Batch operations instead. Pre-R9 child sessions remain read-only and protected
while referenced, but generic live/harvest, follow-up, restart, and
stored-session execution remain rejected. Perform all recovery, retry,
completion, and owner closure through the Batch parent so canonical answers,
receipts, and barrier state advance together.

## Core consult flags

| Flag                                  | Purpose                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `-p, --prompt <text>`                 | Required prompt.                                                                                 |
| `-f, --file <paths...>`               | Files / dirs / globs. Repeatable. `!` prefix = exclude.                                          |
| `-e, --engine <api\|browser\|broker>` | Force engine. `broker` is the opt-in R8 candidate; legacy defaults remain unchanged until G3.    |
| `-m, --model <name>`                  | Single model. See [Mythical Pro Agents](mythical-pro-agents.md).                                 |
| `--models <list>`                     | Comma-separated multi-model run (API only).                                                      |
| `--slug <name>`                       | Stable session slug.                                                                             |
| `--render`                            | Print the assembled bundle to stdout.                                                            |
| `--copy`                              | Copy the bundle to the clipboard.                                                                |
| `--write-output <path>`               | Save the final answer to a file; multi-model runs add per-model files plus `<stem>.oracle.json`. |
| `--files-report`                      | Print per-file token usage.                                                                      |
| `--dry-run [summary\|json\|full]`     | Preview without sending.                                                                         |

### Source selection and text integrity

Glob and directory inputs honor worktree `.gitignore` rules, including ordered
negations, root anchors, and rules in nested directories. An invocation within
a repository inherits rules from the nearest ancestor `.git` marker down to
each candidate; without that marker, the working directory is the boundary.
Git's index, `.git/info/exclude`, and global excludes are not consulted. Rule
matching is case-sensitive and does not load Git configuration. An excluded
parent directory cannot be reopened by a rule inside it. Unreadable or invalid
relevant rule files stop selection instead of silently admitting their files.

An exact file argument explicitly overrides ignore rules, whether used alone
or alongside globs. An explicit `!` exclusion still removes it. Naming a
directory does not grant the same per-file override. Existing default-ignored
directories and explicit hidden-path consent remain separate filters; broad
globs do not follow symlinks.

Text sources must be valid UTF-8 without binary NUL bytes. Validation uses the
original bytes before any replacement decoding or bundle normalization, and
checks the per-file size cap again after reading. Convert non-UTF-8 sources
explicitly before including them as text. Raw browser uploads such as PDFs
continue through the separate binary upload path. An empty resolved selection
or invalid text fails before broker intent/admission; it is not downgraded to
a prompt-only consultation.

The default browser attachment policy remains `auto`: selected small text may
be fully present inline without an attachment card. Correct file selection
and an upload icon are separate facts. `broker` continues to seal selected
text into one source bundle; these input checks neither select an engine nor
change a previously admitted job's identity or recovery rules.

## Opt-in Oracle v2 broker candidate

R8 exposes the durable worker path for explicit CLI validation. It is not the
default engine, does not replace `--engine browser`, and requires the certified
v2 runtime plus a separately running worker. Live broker calls require a stable
logical key so a killed caller can reattach without creating a second Send.
The canonical worker currently supports only macOS GUI sessions. Native
Windows fails closed before socket acquisition and continues to use the legacy
`browser` engine; non-macOS browser workers remain deferred.

Each prompt object and sealed source bundle object is limited to 16 MiB. Oracle
checks that limit before durable client intent or admission. If a waiting job
becomes `recoverable`, the CLI returns the durable job handle immediately with
`oracle resume <job-id>` / `oracle job <job-id>` guidance instead of waiting for
the remaining timeout.

```bash
oracle worker run
oracle --engine broker \
  --idempotency-key review-auth-boundary-v1 \
  -p "Review this boundary." \
  --file "src/**"
oracle job <job-id> --events
oracle session <job-id>
```

`oracle worker status|doctor` distinguishes the `starting` phase from a ready
worker. `oracle resume` is capture-only for eligible ordinary jobs;
`oracle abandon --reason <text>` records an owner decision. Generic resume or
abandon rejects Batch-owned jobs. Broker-only identity flags fail closed on
legacy engines instead of being silently ignored. R9 Batch lane/synthesis jobs
also use this client protocol, while the ordinary default engine remains legacy
until G3.

## Followup / lineage

| Flag                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `--followup <id\|slug\|resp_…>` | Continue a saved ChatGPT browser or OpenAI/Azure Responses API session. |
| `--followup-model <model>`      | Pick API lineage when the parent used `--models`.                       |

`--followup` accepts ordinary sessions only. Batch-owned jobs and pre-R9 Batch
children fail closed before conversation URL resolution; use
`oracle batch resume <batch-id>`.

## Run control

| Flag                                       | Purpose                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `--wait`                                   | Keep the original CLI attached until the session completes.                            |
| `--timeout <seconds\|duration\|auto>`      | Overall API deadline. `auto` = 60m for Pro, 120s otherwise; accepts values like `10m`. |
| `--background`, `--no-background`          | Force Responses API background mode on/off.                                            |
| `--http-timeout <ms\|s\|m\|h>`             | Override the HTTP client timeout; explicit `--timeout` values are reused when omitted. |
| `--allow-partial`, `--partial <mode>`      | Accept partial multi-model success when mode is `ok`; default mode is `fail`.          |
| `--preflight`                              | Check redacted provider readiness for requested API model(s), then exit.               |
| `--perf-trace`, `--perf-trace-path <path>` | Write CLI startup / first-output timing trace JSON.                                    |
| `--heartbeat <seconds>`                    | Emit progress heartbeats; browser mode reports thinking-sidecar liveness.              |

Notes:

- `--dry-run` is mutually exclusive with `--render` / `--render-markdown`; choose the preview or rendered bundle path.
- Missing root prompts exit nonzero after help so scripts fail closed.
- Ctrl-C exits foreground API runs with code 130 and stops an attached local Pro browser worker. Unexpected foreground termination leaves the detached browser worker running so the session can still finish.
- `--perf-trace=/tmp/oracle.json` is accepted in addition to `--perf-trace-path`; `ORACLE_PERF_TRACE=1` writes a local `.oracle-perf-…json` file.

## API endpoints

| Flag                  | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `--base-url <url>`    | LiteLLM / Azure / OpenRouter / proxy.     |
| `--provider <mode>`   | API route: `auto`, `openai`, or `azure`.  |
| `--no-azure`          | Ignore Azure env/config for this run.     |
| `--route`             | Print redacted API route plan, then exit. |
| `--azure-endpoint`    | Azure OpenAI endpoint.                    |
| `--azure-deployment`  | Azure deployment name.                    |
| `--azure-api-version` | Azure API version.                        |

See [OpenAI / Azure / OpenRouter](openai-endpoints.md) and [OpenRouter](openrouter.md).

## Browser mode

Profile lifecycle commands:

| Command                                                                                        | Purpose                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oracle browser install [--cache-dir …] [--no-write-config] [--json]`                          | Install or resume official stable Chrome for Testing and persist its separate executable identity after validation.                                                              |
| `oracle browser setup [--profile-dir …] [--chrome-path …] [--use-mock-keychain]`               | Open Chrome for Testing for sign-in and wait for the whole browser to close; no CDP/prompt. The macOS mock-keychain option is persisted to user config.                          |
| `oracle browser status [--profile-dir …] [--chrome-path …] [--json]`                           | Show readiness, browser generation, active/recoverable consultation counts, and any human action; process internals are JSON-only.                                               |
| `oracle browser heal [--profile-dir …] [--chrome-path …] [--plan] [--json]`                    | Reconcile owned targets and repair only a verified idle dedicated browser. Plan makes no changes; active, recoverable, foreign, attach-running, and remote state is preserved.   |
| `oracle browser smoke [--profile-dir …] [--port …] [--visible] [--use-mock-keychain] [--json]` | Cold-start and attach twice with the same profile; verify login without submitting a prompt.                                                                                     |
| `oracle browser reconcile-tabs [--plan\|--apply] [--include-untracked-chatgpt] [--json]`       | Plan by default; reconcile terminal owned and duplicate blank targets only in the verified exact dedicated profile. Untracked ChatGPT cleanup requires explicit apply + include. |

| Flag                                                                           | Purpose                                                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `--browser-transport <opencli\|cdp>`                                           | Use canonical isolated-profile CDP (default) or explicit OpenCLI Browser Bridge.                                             |
| `--chatgpt-url <url>`                                                          | Target a ChatGPT workspace / project folder.                                                                                 |
| `--browser-model-strategy <select\|current\|ignore>`                           | Control ChatGPT model picker.                                                                                                |
| `--browser-manual-login`                                                       | Use the persistent isolated Oracle profile (direct-CDP default; historical flag name).                                       |
| `--browser-use-mock-keychain`                                                  | macOS isolated-profile opt-in that avoids recurring Keychain dialogs; weaker deterministic at-rest cookie protection.        |
| `--browser-attach-running`                                                     | Attach to your already-running Chrome via DevTools.                                                                          |
| `--browser-tab <ref>`                                                          | Reuse an existing tab (`current`, id, URL, title substring).                                                                 |
| `--browser-thinking-time <light\|standard\|extended\|extra-high\|pro\|heavy>`  | Effort intensity; `pro` selects the Pro tier and fails closed if unconfirmed, other unmatched tiers keep the current effort. |
| `--browser-research deep`                                                      | Activate Deep Research mode.                                                                                                 |
| `--browser-follow-up <prompt>`                                                 | Multi-turn in the same ChatGPT conversation.                                                                                 |
| `--browser-port <port>`                                                        | Pin Chrome DevTools port.                                                                                                    |
| `--browser-inline-cookies[(-file)] <…>`                                        | Supply cookies for explicit ephemeral compatibility mode (`browser.manualLogin:false`).                                      |
| `--browser-timeout`, `--browser-input-timeout`, `--browser-attachment-timeout` | Overall / input / attachment readiness timeouts (h/m/s/ms).                                                                  |
| `--browser-recheck-delay`, `--browser-recheck-timeout`                         | Delayed retry after a timeout.                                                                                               |
| `--browser-auto-reattach-delay/-interval/-timeout`                             | Periodically retry capture from a stored conversation after an actual timeout.                                               |
| `--browser-reuse-wait`                                                         | Wait for shared Chrome profile before launching.                                                                             |
| `--browser-profile-lock-timeout`                                               | Wait for the dedicated-profile startup/composer lock.                                                                        |
| `--browser-max-concurrent-tabs`                                                | Soft limit for shared-profile parallel runs (default 3).                                                                     |
| `--browser-keep-browser`                                                       | Compatibility flag for `browserLifetime:"persistent"`; the dedicated default is `while-needed`.                              |
| `--browser-headless`, `--browser-hide-window`                                  | Visibility controls.                                                                                                         |
| `--browser-attachments <auto\|never\|always>`                                  | Attach files inline vs upload.                                                                                               |
| `--browser-bundle-files`, `--browser-bundle-format <auto\|text\|zip>`          | Bundle browser uploads as text or byte-preserving ZIP.                                                                       |
| `--bundle-label <label>`                                                       | Give generated TXT/ZIP attachments a stable semantic label before the content-derived ID.                                    |
| `--browser-chrome-path`, `--browser-cookie-path`                               | Override Chrome / cookie store discovery (Linux / Windows).                                                                  |

See [Browser Mode](browser-mode.md) for usage.

## Remote browser

Remote-service host flags:

| Flag                                | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `--host <address>`                  | Bind `oracle serve`; defaults to `127.0.0.1`.                            |
| `--allow-non-loopback`              | Independently opt in to a non-loopback bind and emit a security warning. |
| `--port <number>`                   | Select the service port; defaults to an ephemeral port.                  |
| `--token <value>`                   | Set the bearer token; defaults to a fresh random token.                  |
| `--manual-login`                    | Reuse the host-owned dedicated manual-login profile.                     |
| `--manual-login-profile-dir <path>` | Select that host-owned profile directory.                                |

| Flag                          | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `--remote-host <host:port>`   | Use a remote `oracle serve` host.            |
| `--remote-token <secret>`     | Auth for the remote host.                    |
| `--remote-chrome <host:port>` | Attach to an existing remote Chrome session. |

## Image / media (browser)

| Flag                      | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `--generate-image <file>` | Save a generated ChatGPT browser artifact. |

## Stale session detection

| Flag                     | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `--zombie-timeout <…>`   | Cutoff for "stale" sessions.                 |
| `--zombie-last-activity` | Use last log entry instead of session start. |

## Environment variables

| Var                                 | Effect                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| `OPENAI_API_KEY`                    | Enables OpenAI API mode.                                |
| `AZURE_OPENAI_API_KEY` etc.         | Enables Azure mode (paired with endpoint / deployment). |
| `ANTHROPIC_API_KEY`                 | Enables Claude API mode.                                |
| `OPENROUTER_API_KEY`                | Enables OpenRouter ids.                                 |
| `ORACLE_HOME_DIR`                   | Override `~/.oracle/` root.                             |
| `ORACLE_MAX_FILE_SIZE_BYTES`        | Per-file size cap (default 1 MB).                       |
| `ORACLE_BROWSER_COOKIES_JSON`       | Inline ChatGPT cookies (JSON / base64).                 |
| `ORACLE_BROWSER_COOKIES_FILE`       | Path to cookies JSON.                                   |
| `ORACLE_BROWSER_ATTACHMENT_TIMEOUT` | Attachment upload/readiness timeout for browser mode.   |
| `ORACLE_CHATGPT_ACCOUNT_EMAIL`      | Exact saved account for the Welcome back picker.        |

## See also

- `oracle --help` — short usage.
- `oracle --help --verbose` — every flag, including hidden ones.
- [Configuration](configuration.md) — `~/.oracle/config.json` and project `.oracle/config.json` defaults.
- [Batch Oracle v1](batch-oracle.md) — strict manifests, stage barriers, recovery, and synthesis.
