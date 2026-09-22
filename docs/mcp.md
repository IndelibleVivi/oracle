# MCP Server

`oracle-mcp` is a minimal MCP stdio server that mirrors the Oracle CLI. It shares session storage with the CLI (`~/.oracle/sessions` or `ORACLE_HOME_DIR`) so you can mix and match: run with the CLI, inspect or re-run via MCP, or vice versa.

## Let Them Fight

Claude Code can call `oracle-mcp` and ask a subscription-backed ChatGPT browser session for a second opinion. Use the `chatgpt-pro-heavy` preset when you want a compact MCP request that targets ChatGPT browser mode, the current Pro picker alias, and Pro Extended thinking time. The preset is intentionally boring at the API layer: it is a shortcut for existing browser-mode fields, not a new model id.

For this fork's canonical GPT-5.6 Pro transport, first initialize and validate
the Oracle-only Chrome profile outside MCP:

```bash
oracle browser install
oracle browser setup --use-mock-keychain # unattended macOS profile
# sign in, close the entire Chrome for Testing browser
oracle browser smoke
```

Then set `browser.transport:"cdp"`, `browser.manualLogin:true`, and the dedicated
profile path in the Oracle user config. Call `consult` with
`engine:"browser"`, `model:"gpt-5-pro"`, and
`browserModelStrategy:"select"`. Transport and browser identity are
operator-level boundaries rather than agent-supplied MCP fields. The effective
UI receipt is model `GPT-5.6 Sol` plus reasoning tier `Pro`.

Set `browser.transport:"opencli"` only when the operator explicitly chooses the
Browser Bridge alternative. MCP never changes transports in response to a
runtime failure.

## Tools

### `chatgpt_image`

- Inputs: `prompt` (required), `files?: string[]` for reference images/assets, `outputPath?: string`, `aspectRatio?: string`, `model?: string`, plus browser controls such as `browserThinkingTime`, `browserModelLabel`, `browserModelStrategy`, `browserKeepBrowser`, and `dryRun`.
- Behavior: convenience wrapper for ChatGPT browser image generation. It forces `engine:"browser"`, sets `generateImage` for the existing image-aware wait/download path, and defaults `browserAttachments:"always"` when files are provided so reference images are uploaded instead of pasted.
- Output: returns the normal session metadata plus `requestedOutputPath` and `structuredContent.images[]` with saved local paths, MIME type, size, dimensions, and ChatGPT file id when available. Signed source/download URLs are not returned. If `outputPath` is omitted, Oracle picks a unique file under `ORACLE_HOME_DIR/generated/`.
- Output path safety: agent-supplied `outputPath` must resolve under `ORACLE_HOME_DIR/generated` by default; traversal and symlink escapes are rejected. This keeps MCP writes away from Oracle config, session metadata, and browser profile state. Set `ORACLE_MCP_ALLOW_EXTERNAL_OUTPUT=1` to allow writing elsewhere as an explicit operator decision. Omit `outputPath` to use the safe default.
- Local browser only: image output is unsupported when a remote browser service is configured (`ORACLE_REMOTE_HOST`); the image would be written on the remote host and not transferred back, so `chatgpt_image`/`consult` image runs fail closed with a clear error rather than returning empty `structuredContent.images`. Run on the local browser to generate images.

```json
{
  "prompt": "Create a 9:16 App Store screenshot background for a focus timer.",
  "files": ["./reference-screen.png"],
  "aspectRatio": "9:16"
}
```

### `consult`

- Inputs: `prompt` (required), `files?: string[]` (globs), `model?: string` (defaults to CLI), `engine?: "api" | "browser" | "broker"` (optional; Oracle follows CLI defaults: `ORACLE_ENGINE` and the effective config first, then API when `OPENAI_API_KEY` is set, otherwise browser), `slug?: string`.
- Presets: `preset?: "chatgpt-pro-heavy"` applies browser mode + current Pro model alias + extended thinking, unless the request overrides those fields.
- Browser-only extras: `browserAttachments?: "auto"|"never"|"always"`, `browserBundleFiles?: boolean`, `browserBundleFormat?: "auto"|"text"|"zip"`, `browserThinkingTime?: "light"|"standard"|"extended"|"extra-high"|"pro"|"heavy"`, `browserResearchMode?: "deep"`, `browserFollowUps?: string[]`, `browserKeepBrowser?: boolean`, `browserModelLabel?: string`, `browserModelStrategy?: "select"|"current"|"ignore"`, `generateImage?: string`, `outputPath?: string`.
- Dry runs: set `dryRun: true` to preview the resolved request without creating a session or touching the browser.
- Behavior: starts a session, runs it with the chosen engine, returns a session-log preview + metadata. Background/foreground follows the CLI (e.g., GPT‑5 Pro detaches by default). If API mode fails because `OPENAI_API_KEY` is missing and you have ChatGPT Pro, retry with `engine: "browser"` or `preset: "chatgpt-pro-heavy"` to use your signed-in ChatGPT session instead of an API key.
- Full output: `structuredContent.output` contains the full log when it fits within 4,000 UTF-16 code units; longer logs return the tail as a preview with `outputTruncated:true`, total `logBytes`, and `logResourceUri`. Read that MCP resource or call `sessions` with `{id: sessionId, detail: true}` for the complete stored log. The text result also states when it is truncated. These fields describe the stored log, which may include progress and multiple model runs, rather than certifying a single answer artifact.
- Logging: emits MCP logs (`info` per line, `debug` for streamed chunks with byte sizes). If browser prerequisites are missing, returns an error payload instead of running.
- Research mode: set `browserResearchMode:"deep"` for broad public-web research and cited reports. Use normal browser runs with `gpt-5.5-pro` + `browserThinkingTime:"extended"` for legacy Pro Extended code review, `gpt-5.6-sol` + `browserThinkingTime:"extra-high"` for Extra High, or `gpt-5.6-sol` + `browserThinkingTime:"pro"` when you explicitly want the current Pro effort tier.
- Multi-turn consults: set `browserFollowUps:["Challenge your recommendation", "Give the final decision"]` to keep one ChatGPT browser conversation open and ask sequential follow-up prompts. Use one-shot calls for narrow bugs and exact file-set reviews; use multi-turn for ambiguous architecture/product decisions where a challenge pass and final recommendation are useful; use Deep Research for broad public-web work with citations. Oracle never invents follow-ups automatically.
- Conversation retention: Oracle exposes no ChatGPT archive input or action. Browser target cleanup may close Oracle-owned Chrome targets, but the account conversation remains visible for inspection and manual follow-up.
- ChatGPT image generation: set `engine:"browser"` and `generateImage` to a path under `ORACLE_HOME_DIR/generated` to use the same image-aware wait/download path as CLI `--generate-image`. Saved files are returned in `structuredContent.images` and recorded as session artifacts; multiple images save as numbered siblings. Agent-supplied `generateImage` / `outputPath` are constrained to that generated-output directory by default (set `ORACLE_MCP_ALLOW_EXTERNAL_OUTPUT=1` to allow external paths).

#### Opt-in durable broker consults

R8 adds an explicit `engine:"broker"` candidate while legacy MCP defaults remain
unchanged until G3. Start the certified local worker separately, pass a stable
`idempotencyKey`, and optionally set `waitTimeoutMs` as the MCP host wait budget.
A host timeout returns `jobId + state`; the worker continues and a repeated call
with the same key and inputs reattaches to the same job. Broker-only fields are
rejected on API/browser requests rather than ignored. The canonical v2 worker
currently supports macOS GUI sessions only; native Windows and other non-macOS
browser workers remain deferred.

Each prompt object and sealed source bundle object is limited to 16 MiB, checked
before durable client intent or admission. A job that reaches `recoverable`
returns immediately with `isError:true`, `status:"recovery-required"`, its
durable `jobId`, and explicit `job_resume` / inspection guidance; this is an
action-required result, not a host timeout.

```json
{
  "engine": "broker",
  "idempotencyKey": "review-auth-boundary-v1",
  "waitTimeoutMs": 120000,
  "prompt": "Review this boundary.",
  "files": ["src/**/*.ts"]
}
```

The read/recovery tools are `job_status`, `job_result`, `job_events`, and
`job_resume`. Their structured outputs expose only stable public projections;
protocol payloads and forensic internals remain available only through the
explicit private debug export. Batch-owned jobs reject generic `job_resume` and
remain under their parent authority until the R9 mapping is complete.

#### Long browser consults from agents

Browser-backed GPT-5.6 Pro consults can legitimately run for many minutes. Some MCP clients show little progress while a tool call is active, so agents should treat a long Oracle call as a running browser job, not as a failed step. Use `engine:"browser"` and `model:"gpt-5-pro"` explicitly, then inspect the shared session store (`sessions`, `oracle status`, or `oracle session <id>`) before retrying a prompt. Direct CDP waits inside one browser worker and OpenCLI waits inside one tool-side waiter; neither needs the calling agent to poll or open duplicate sessions. The legacy `chatgpt-pro-heavy` preset retains its upstream model/effort contract. Window visibility follows the operator's stored control policy: setup is visible, direct-CDP macOS runs can be consistently off-screen, and OpenCLI window presentation remains Browser Bridge-owned.

#### ChatGPT images from agents

For generated images, pass an explicit `generateImage` path. That opt-in is important because it switches the browser wait loop to watch for ChatGPT image artifacts instead of only assistant text. The path must resolve under `ORACLE_HOME_DIR/generated` unless `ORACLE_MCP_ALLOW_EXTERNAL_OUTPUT=1` is set.

```json
{
  "engine": "browser",
  "model": "gpt-5.5-pro",
  "prompt": "Create a 9:16 App Store screenshot background for a focus timer.",
  "generateImage": "${ORACLE_HOME_DIR}/generated/focus-timer-bg.png"
}
```

The MCP response includes `structuredContent.images[]` with the saved file path, MIME type, size, dimensions, and ChatGPT file id when available. Signed source/download URLs remain internal.

### `sessions`

- Inputs: `{id?, hours?, limit?, includeAll?, detail?}` mirroring `oracle status` / `oracle session`.
- Behavior: without `id`, returns a bounded list of recent sessions. With `id`/slug, returns a summary row; set `detail: true` to fetch full metadata, log, and stored request body.

### `project_sources`

- Inputs: `operation: "list"|"add"`, `chatgptUrl?: string`, `files?: string[]`, `dryRun?: boolean`, `confirmMutation?: boolean`, `browserKeepBrowser?: boolean`.
- Behavior: manages the ChatGPT Project Sources tab through local browser automation. v1 is intentionally append-only: it can list existing sources and add files, but it cannot delete, replace, or sync.
- Safety: `add` requires `confirmMutation: true` unless `dryRun: true`. This keeps agent callers from mutating a persistent ChatGPT Project by accident.
- Workflow: use this when Claude Code, Codex, or another MCP host needs a durable shared context file in a ChatGPT Project. Use `consult` when you want an actual model answer.

## Resources

- `oracle-session://{id}/{metadata|log|request}` — read-only resources that surface stored session artifacts via MCP resource reads.

## Background / detach behavior

- Same as the CLI: heavy models (e.g., GPT‑5 Pro) detach by default; reattach via `oracle session <id>` / `oracle status`. MCP does not expose extra background flags.

## Launching & usage

- From this fork's source checkout:
  - `pnpm build`
  - `npm link`
  - `pnpm mcp` (or `oracle-mcp` in the repo root)
- mcporter example (stdio):
  ```json
  {
    "name": "oracle",
    "type": "stdio",
    "command": "node",
    "args": ["/absolute/path/to/oracle/dist/bin/oracle-mcp.js"]
  }
  ```
- Project-scoped Claude (.mcp.json) example:
  ```json
  {
    "mcpServers": {
      "oracle": { "type": "stdio", "command": "oracle-mcp", "args": [] }
    }
  }
  ```
- Bridge helper snippets:
  - Codex CLI: `oracle bridge codex-config`
  - Claude Code: `oracle bridge claude-config`
  - Claude Code with local macOS Chrome: `oracle bridge claude-config --local-browser > .mcp.json`
- Tools and resources operate on the same session store as `oracle status|session`.
- Defaults (model/engine/etc.) come from the effective Oracle CLI config; see `docs/configuration.md`, `~/.oracle/config.json`, and project `.oracle/config.json` files.
