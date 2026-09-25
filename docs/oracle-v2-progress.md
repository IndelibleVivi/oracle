---
title: Oracle v2 progress
summary: "Current tranche, evidence, owner gates, and next safe action for Oracle v2."
read_when:
  - Resuming Oracle v2 implementation or checking its current source and gate status
---

# Oracle v2 progress

Updated: 2026-09-15

Source integration record: `fork/main@efae6f94714df2f63a2c3afbed817def42421f23`
is the verified PR #9 merge and owner-accepted T0 baseline. PR #8 at
`39ab7fb35297e45fcf219ab31b7c787b44a69e51` remains the implementation-inspection
baseline used by the T0 map.

Historical pre-v2 legacy safety baseline: `fork/main@e6f170ff`

## Current state

R0 through R9 and the bounded legacy safety work through PR #8 are integrated
in `fork/main`. The executable legacy `browser` route and its ordinary default
remain source behavior, but its auto-submit lane is now frozen for owner work:
no new feature or symptom repair belongs there except a bounded data-loss or
duplicate-send emergency. R8's durable `broker` engine remains explicit opt-in
until G3. R9 continues to map new Batch lane and synthesis attempts to
Batch-owned v2 jobs while preserving parent manifest, sealing, blind-lane,
barrier, answer-integrity, and owner-closure authority.

On 2026-09-25, the owner authorized one bounded availability exception after a
ChatGPT frontend change removed the legacy picker trigger and power-slider
markers and made the shipped/default browser route fail before Send. The
admitted repair is limited to recognizing the newly observed semantic
Intelligence trigger, simple picker view, and accessible effort status, plus
focused regression coverage; it does not weaken model/effort proof or change
dispatch, recovery, browser ownership, or the G3/G4 gate.

T0 froze and the owner accepted the disposable-attempt plan against current
source. The existing v2
fixed-profile runtime is a superseded candidate, not the intended G3 runtime:
`packages/oracle-browser-runtime/src/runtime.ts` reuses
`runtimeRoot/browser-profile`; `CertifiedChatGptProvider` retains one runtime
and adapter; the adapter budgets three pages; startup preserves shared-profile
recovery markers; and any escaping runner job error currently blocks the whole
runner. T1 now has a source candidate for auth-seed candidates, immutable
sandbox/process receipts, atomic clone and exact cleanup, one-page attempt
runtimes, a two-clone fixture proof, and a separately invoked real no-Send
proof runner. None of those primitives is connected to provider dispatch;
legacy remains default and broker remains explicit opt-in.

The accepted replacement keeps the v2 kernel, store, worker ledger, bundle,
client, Batch, receipts, and adapter page semantics. A fixed profile becomes a
login-only auth seed; each job attempt/purpose receives an owner-only disposable
sandbox, exact process, adapter, and at most one page. Preparation through
`dispatch-at-risk` observation shares one exact dispatch sandbox/key/lifetime.
Pre-Send failure, completion, and ambiguity all end by removing that workspace
after ledger truth is saved; only committed-capture recovery or probe may create
a fresh purpose-specific sandbox.
The corrected source/reference and G4 deletion map is
[`oracle-v2-browser-ownership-map.md`](oracle-v2-browser-ownership-map.md).

The canonical R0-R9 worker remains a macOS GUI-session runtime over an
owner-only Unix socket. Native Windows fails closed before socket acquisition,
and other non-macOS browser workers remain deferred. The legacy `browser`
engine remains the ordinary Windows path.

On 2026-09-01, an owner-authorized bounded dogfood exercised the repo-local R9
candidate through one ordinary broker review and one two-lane-plus-synthesis
Batch. The candidate was invoked by its exact repo-local build, then stopped;
it was not linked or installed over the global CLI. Legacy `browser` remains
the shipped/default ordinary engine until G3. No v2 worker, Chrome for Testing
process, page, socket, or listener remained after orderly shutdown.

G2 remains certified from three bounded live canaries: canonical text, sealed
bundle, and an injected committed-capture interruption followed by
capture-only recovery. Every certified canary independently verified GPT-5.6
Sol and Pro, preserved exactly one durable Send attempt and one committed turn,
captured the expected answer, used no automatic fallback, and closed the owned
Chrome for Testing runtime.

G1 certified the single worker-managed exact Chrome for Testing runtime over
loopback direct CDP. The fixed v2-only profile retained its authenticated
session across repeated complete close/reopen cycles, all eight owner
acceptance checks passed, and no PID or port became durable job authority. The
private certification is `~/.oracle/v2/browser-runtime.json`; it is runtime
evidence only and does not install or activate v2 as the default engine.

R6 produced `compatible:true` from the real no-Send adapter probe with all ten
provider capabilities verified. It opened the Intelligence picker to verify
GPT-5.6 Sol and Pro independently, filled and cleared a fixed synthetic
composer marker to verify the lazy Send control, and separately uploaded then
removed `oracle-v2-no-send-probe.md`. The receipt records
`promptSubmitted:false` and lives at
`~/.oracle/v2/chatgpt-adapter-compatibility.json`. Sanitized fixture coverage
now mirrors the observed current control shapes, hidden fallback composer,
blocking history-limit modal, and strict no-sidebar/no-composer-content
diagnostic boundary.

The initial G1 spike rejected Playwright-bundled Chromium and the exact Chrome
for Testing executable launched as a Playwright persistent context because
owner-observed Google login could not complete. The branded stable Chrome
channel remained safety-blocked on macOS. Both failed runtimes closed cleanly,
did not submit a prompt, and did not affect everyday Chrome.

Faye accepted the evidence-driven G1 plan delta on 2026-08-31: v2 now has one
candidate path, with the exact Oracle Chrome for Testing process owned by the
worker/runtime host and Playwright attached over loopback direct CDP. The
runtime uses one fixed v2-only profile, has no automatic fallback, and never
persists PID or port as job authority. This changes neither the installed
legacy runtime nor the default browser engine.

Fresh R0 evidence:

- `pnpm install --frozen-lockfile`: passed;
- `pnpm check`: passed;
- `pnpm test`: 168 files passed, 15 skipped; 1,959 tests passed, 32 skipped;
- `pnpm build`: passed;
- `pnpm docs:check`: README sync and 99-flag help check passed;
- `pnpm run v2:boundaries`: passed;
- `git diff --check`: passed.

R0 commit: `7135507a` (`establish Oracle v2 architecture boundary`).

Fresh R1 evidence:

- `pnpm exec vitest run tests/v2/oracle-kernel.test.ts`: 13 tests passed;
- `pnpm check`: passed, including v2 boundaries;
- `pnpm test`: 169 files passed, 15 skipped; 1,972 tests passed, 32 skipped;
- `pnpm build`: passed;
- `git diff --check`: passed.

The kernel now owns strict JobSpec/event/state/receipt schemas, explicit schema
upcasting, the closed transition table, full receipt identity checks, and
action policy. `dispatch-at-risk` and every later state forbid Send;
verified-unsent work requires a new owner-authorized attempt, while committed
failures permit capture recovery only.

R1 commit: `2c5ab030` (`add Oracle v2 job kernel`).

Fresh R2 evidence:

- `pnpm exec vitest run tests/v2/oracle-store.test.ts tests/v2/oracle-kernel.test.ts`:
  21 tests passed;
- `pnpm check`: passed, including v2 boundaries;
- `pnpm test`: 170 files passed, 15 skipped; 1,980 tests passed, 32 skipped;
- `pnpm build`: passed;
- `git diff --check`: passed.

The store now owns migration v1, SQLite WAL/FULL transactions, explicit
idempotent admission, event/snapshot CAS updates, replay-based startup
integrity, owner-only CAS objects, rebuildable session projections, bounded
SQLite backups, and debug TTL/cap/pinning. Injected faults after event insert
and after snapshot update both roll back to the same last-good version.

R2 commit: `0d9df00e` (`add Oracle v2 durable job store`).

Fresh R3 evidence:

- `pnpm exec vitest run tests/v2/oracle-kernel.test.ts tests/v2/oracle-store.test.ts tests/v2/oracle-worker.test.ts`:
  30 tests passed, 1 soak test skipped;
- `ORACLE_V2_SOAK=1 pnpm exec vitest run tests/v2/oracle-worker.test.ts -t '1,000-job'`:
  1,000 jobs and 8,000 durable events passed in 137.51 seconds;
- `pnpm check`: passed, including v2 boundaries;
- `pnpm test`: 171 files passed, 15 skipped; 1,989 tests passed, 33 skipped;
- `pnpm build`: passed;
- `git diff --check`: passed.

The worker now binds an owner-only Unix socket before opening the single-writer
store, exposes upload/job/event/resume/abandon/canary operations, survives
client disconnect, enforces idempotent admission, and recovers preparing and
at-risk jobs from the ledger. Preparation/dispatch are serialized; committed
capture is bounded at three. A dispatch-at-risk restart uses commit observation
only and the same attempt never sends twice. The fake provider and client
exercise reconnect, restart, degraded read-only access, owner closure, capture
recovery, and bounded high-volume behavior without browser access.

R3 commit: `0e0c15bb` (`add Oracle v2 durable worker`).

Fresh R4 evidence:

- `pnpm exec vitest run tests/v2/oracle-kernel.test.ts tests/v2/oracle-store.test.ts tests/v2/oracle-worker.test.ts tests/v2/chatgpt-adapter.test.ts tests/v2/oracle-worker-faults.test.ts`:
  55 tests passed, 2 soak tests skipped, including 15 ordinary Playwright
  fixture scenarios and 10 hard child-process fault points;
- `ORACLE_V2_SOAK=1 pnpm exec vitest run tests/v2/oracle-worker.test.ts -t '1,000-job'`:
  the current R4 capture path completed 1,000 jobs and 8,000 durable events in
  169.25 seconds;
- `ORACLE_V2_FIXTURE_SOAK=1 pnpm exec vitest run tests/v2/chatgpt-adapter.test.ts -t '500 fixture jobs'`:
  500 jobs, 500 one-attempt Sends, 4,000 durable events, and zero leaked
  adapter pages passed in 424.42 seconds;
- `pnpm check`: passed, including the adapter/fixture boundary check;
- `pnpm test`: 173 files passed, 15 skipped; 2,014 tests passed, 34 skipped;
- `pnpm build`: passed;
- `pnpm docs:check`: README sync and 99-flag help check passed;
- `pnpm public:check`: 527 source files and 39 generated docs files passed the
  public-safety scan;
- `git diff --check`: passed.

The adapter now owns all Playwright page-reading and automation knowledge,
semantic locators, a bounded no-Send capability probe, structural UI
fingerprinting, exact model/Pro/prompt/bundle verification, one-shot dispatch,
commit recovery, conversation-bound capture, streaming completion, and native
copy/text-projection quality receipts. Capture persists canonical Markdown,
plain-text, and HTML-fragment roles while reusing one CAS object when two
representations are byte-identical. The sanitized fixture owns simulated UI
markup and scenarios only. Incompatible auth/rate/UI states create one durable
provider-status row and keep new jobs queued with `blockedBy=provider`; they do
not create per-job DOM incidents or Send. All ten test-only hard fault points
default off and recover from the same DB/socket/fixture state with at most one
Send per attempt.

R4 implementation commit: `4d30c010` (`add Oracle v2 provider fixture`), first
published on `fork/codex/oracle-v2` and retained in the integrated R0-R9
history.

Fresh R5-R6 evidence:

- both Playwright-owned executable candidates produced durable `login=fail`
  receipts; dependent checks are `blocked`, not misreported as failures;
- the installed direct-CDP safety baseline completed two no-Send cold starts
  with authenticated, prompt-ready observations and orderly browser drain;
- the replacement runtime contract exposes only worker-owned exact Chrome for
  Testing over direct CDP, one fixed profile, and no automatic fallback;
- the focused runtime suite passes 6 tests, including a real direct-CDP profile
  persistence cold restart against the sanitized provider fixture;
- Faye completed the one-time login and confirmed the authenticated state
  remained present after repeated orderly close/reopen cycles;
- all eight G1 checks passed at restart ordinal 17 and produced the fixed
  runtime certification;
- the real R6 adapter receipt at restart ordinal 19 is `compatible:true`, with
  all ten capabilities `verified` and `promptSubmitted:false`;
- real no-Send checks verified GPT-5.6 Sol, Pro, a background Playwright click,
  a lazy Send control, and synthetic attachment upload/removal without reading
  sidebar or conversation content;
- TypeScript, the focused current-style fixture tests, and the v2
  legacy-import/adapter boundary check pass;
- the final focused runtime/adapter run passed 25 tests with one bounded soak
  skipped; the full repository suite passed 174 files and 2,024 tests with 15
  files and 34 tests skipped;
- `pnpm check`, production build, docs/help check, packed-CLI smoke, public
  safety scan, and `git diff --check` pass.

Fresh R7 source and G2 evidence:

- the worker/runtime still owns one exact Chrome for Testing process and one
  fixed profile, while the adapter enforces at most three owned ChatGPT tabs
  and backpressures a fourth request;
- runtime startup closes stale restored page targets before adapter work, and
  each new page is bound through an exact unique target marker rather than an
  arbitrary next-page event;
- the hard-fault harness now shares one parent-owned browser across each fault
  case instead of relaunching a browser from every child; the full fault suite
  completed with no owned Chrome for Testing process left after closure;
- current UI regressions cover ProseMirror composer readback, the late
  conversation-history rate-limit modal, composer-anchored `aria-label` file
  tiles including provider duplicate-name suffixes, transient
  conversation-route rollback after apparent commit, and client-created
  provisional `/c/WEB:...` routes that must canonicalize before commit;
- the real preflight passed compatibility, exact GPT-5.6 Sol/Pro preparation,
  text-composer verification, and sealed-bundle attachment verification with
  `promptSubmitted:false` and no automatic fallback;
- the two earlier text attempts remain preserved without resubmission. The first
  exposed a transient route rollback; the second exposed that a client-created
  `/c/WEB:...` route had been accepted as durable conversation authority. Commit
  observation now rejects provisional identifiers and requires one stable
  canonical route plus the exact user-turn candidate;
- `r7-g2-text-v3` and `r7-g2-bundle-v1` each record one
  `dispatch-marked-at-risk`, one `submission-committed`, zero `capture-failed`,
  one `capture-completed`, and the exact expected answer;
- the first recovery harness attempt completed its new job but was not
  certified because an older recoverable job consumed the unscoped fault
  marker during worker startup. Worker fault points now carry job/request
  identity, and a regression proves that older recoverable jobs cannot consume
  a target-scoped interruption;
- `r7-g2-committed-capture-recovery-v2` records one durable Send and commit,
  exactly one target-bound `capture-failed`, then one `capture-completed` after
  worker restart with no resend. Its persisted marker and receipt both verify
  the exact job/request identity;
- the focused final R7 suite passed 6 files and 60 tests with 2 bounded tests
  skipped. `pnpm check`, `pnpm build`, `pnpm docs:check`,
  `pnpm public:check`, `git diff --check`, final canary inspection, and final
  browser ownership cleanup passed;
- private manifests, ledgers, answer objects, and certification receipts remain
  under `~/.oracle/v2/`; none are tracked source or installation evidence.

Fresh R8 source and live evidence:

- root CLI and MCP now use `oracle-client` plus the canonical
  `oracle-bundle` only when the explicit `broker` engine or its opt-in feature
  override is selected; v2 boundaries still prohibit browser/worker authority
  imports from those clients;
- live broker admission requires a stable request/idempotency identity. The
  client atomically creates one immutable `(scope, key)` intent and a separate
  admission binding before relying on a transport response; mismatched prompt,
  bundle, policy, lineage, route, or owner identity fails closed;
- source membership is shadow-compared with the legacy selector, then sealed
  into one deterministic UTF-8 bundle with bytewise path ordering,
  path-independent external aliases, and content receipts;
- `oracle job|resume|abandon`, `oracle worker run|status|doctor`, `oracle
canary`, `oracle debug export`, and `oracle session <job-id>` expose durable
  job operations without moving browser or ledger authority into the CLI;
- MCP `consult` returns `jobId + state` when its host wait expires and repeats
  the same key against the same job. `job_status`, `job_result`, `job_events`,
  and `job_resume` expose explicit allowlisted public projections; generic
  resume/abandon rejects Batch-owned jobs;
- a real child CLI was hard-killed after admission; the worker completed the
  job and a new CLI reattached with the same key, final answer, and exactly one
  Send. Output artifacts are atomic, owner-only files and post-admission client
  errors retain the durable job handle;
- three bounded ordinary real reviews completed through the R8 broker. Each
  recorded one committed Send and one capture, returned through its exact job,
  and released its review page; final CDP page count was zero after each of the
  last two reviews. Findings were reconciled into durable identity, public MCP
  projection, socket ownership, startup readiness, signal timing, and
  failure-independent cleanup fixes;
- the production host now publishes `phase:"starting"` before store/provider
  readiness instead of returning a transient 500, then reaches
  `phase:"ready"`. A no-Send live startup/shutdown readback ended with the Unix
  socket and the owned Chrome for Testing process both absent;
- the focused R8 integration set passed. The final full repository suite passed
  182 files and 2,057 tests with 15 files and 34 tests skipped; `pnpm check`,
  production build, docs/help check, packed-CLI smoke, public-safety scan, v2
  boundary check, and `git diff --check` passed;
- private live-review answers, run logs, intents, job ledgers, and browser
  receipts remain under `~/.oracle/v2/`; none are tracked source or evidence of
  installation/default activation.

Fresh R9 source and fixture evidence:

- every lane attempt uses
  `batch:<batchId>:lane:<laneId>:attempt:<n>` and synthesis uses
  `batch:<batchId>:synthesis:<synthesisId>:attempt:<n>`; immutable client
  intent identity includes prompt bytes, bundle bytes and media type, policy,
  lineage, route, and exact Batch owner;
- the Batch parent no longer imports or launches the legacy browser child
  runtime. It seals the complete first stage, admits jobs through
  `oracle-client`, hides sibling answers until the barrier, and consumes only
  worker answer objects bound to immutable Batch receipts and input manifests;
- local `maxParallel` is only a client admission cap. The worker retains one
  global preparation/dispatch lane and no more than three concurrent captures;
  Batch does not create or retain a page pool of its own;
- generic job resume/abandon rejects Batch-owned work. Parent-only resume and
  abandon require the exact owner identity. Failed-unsent or verified-unsent
  work gets a new attempt only through explicit Batch resume; committed
  capture recovery keeps the same `jobId` and performs zero additional Sends;
- the R9 integration runs a three-lane blind Batch through synthesis, restarts
  the worker after one committed lane capture failure, creates one safe second
  attempt after a targeted final-verification failure, accepts one ambiguous
  lane as missing, performs explicit partial synthesis, verifies raw answer
  receipts, and preserves TXT or ZIP sealed bundle media types. Every admitted
  attempt records at most one Send;
- pre-R9 Batch child-session state remains readable and protected from
  retention while referenced, but the v2 Batch runtime refuses to relaunch it;
- the full gate found that launcher cleanup could SIGKILL Chrome after its CDP
  endpoint closed but before Chrome 152 finished flushing the profile. Runtime
  close now waits a bounded interval for the owned process to exit naturally
  before fallback cleanup; the real managed-process cold-restart fixture
  preserves its profile sentinel and exits cleanly;
- focused Batch/client/adapter gates passed 38 tests with one bounded test
  skipped. The memory-safe serialized full repository suite passed 181 files
  and 2,047 tests with 15 files and 34 tests skipped. No real ChatGPT prompt was
  submitted for R9; all Batch Send/recovery evidence uses the sanitized fixture
  or `FakeProvider`.

Fresh PR #5 integration-review evidence:

- exact restart recovery now preserves only durable at-risk restored targets
  while stale restored pages still close; strict model readiness requires an
  explicit selected state, and repeated preparation failures release every tab
  lease;
- broker callers return `recoverable` immediately as action-required, and a
  prompt or sealed source bundle over the worker's 16 MiB object-body limit is
  rejected before durable client intent or admission;
- the final local integration suite passed 181 files and 2,058 tests with 15
  files and 34 tests skipped. Format, typecheck, lint, v2 boundaries, production
  build, docs/help, public-safety, packed-CLI smoke, and `git diff --check`
  passed. The PR merge/read-back and exact hosted checks remain GitHub-owned
  integration evidence.

Fresh T0 authority-freeze evidence:

- the source/dependency scan was performed at exact
  `fork/main@39ab7fb35297e45fcf219ab31b7c787b44a69e51` and records the fixed
  runtime profile, singleton provider/runtime/adapter, shared three-page budget,
  shared recovery binding, global runner-block behavior, legacy ownership
  callers, and G4 deletion boundary;
- the master plan and agent contract now define a login-only auth seed,
  per-attempt disposable sandbox, one-page adapter, same-sandbox at-risk
  observation, capture-only recovery, ledger/process-marker GC, and job-local
  cleanup isolation without changing executable source;
- `pnpm check` passed format, typecheck, lint, and v2 boundaries;
- `pnpm test` passed 181 test files with 15 skipped, containing 2,126 passing
  tests and 34 skipped;
- `pnpm build`, `pnpm docs:check`, `pnpm public:check`,
  `pnpm test:packed-cli`, and `git diff --check` passed;
- no worker, Chrome for Testing process, browser page, local profile operation,
  no-Send probe, account-side action, or live Send was run.

Fresh T1 source-candidate and live-gate evidence:

- `packages/oracle-browser-runtime` now models accepted/candidate auth seeds,
  shared clone versus exclusive refresh locking, receipt-validated atomic
  clones, immutable owner/process identity, exact CDP close plus post-close exit
  proof, and a one-page attempt runtime. Cross-process cleanup never signals a
  persisted bare PID because observation cannot close the PID-reuse race; a
  process that survives exact CDP close blocks deletion and retains its sandbox.
  The accepted seed cannot be launched as a job
  profile, arbitrary directories cannot impersonate a seed, and no sandbox
  copyback exists;
- PR review hardening atomically publishes each clone/refresh lock as a
  tokenized process-owner file with PID and process start time, and reclaims it
  only after that exact owner is absent; reuses an exact crash-restored
  recovery page, closes any in-flight or already-returned alternate target,
  makes a late or pre-first-open replacement exact recovery page reattachable,
  returns the exact preserved page when its arrival interrupts ordinary target
  navigation, refuses to choose between duplicate live preserved pages, and
  closes the whole runtime fail-safe if an alternate target or a failed-open
  target cannot close; serializes Chrome launch and cleanup,
  including launch/close receipt publication, through one atomic sandbox
  process-lifecycle reservation; revalidates the endpoint-reported browser PID
  and exact OS process identity before CDP
  close; removes `commit-recovery` as a separate sandbox purpose so at-risk
  observation must stay in the original `dispatch` workspace; and makes missing
  process receipts or failed process inspection block profile deletion unless a
  profile-wide process scan proves absence. A failed current-process identity
  lookup is no longer cached across later jobs. Auth-seed and attempt-lifecycle
  lock publication, token revalidation, reclamation, and release share a short
  runtime-root SQLite mutation lock, which the OS releases on process death, so
  a stale observer cannot rename a newly published live replacement. Attempt
  creation now atomically publishes an immutable owner, an empty final profile,
  and a live process-lifecycle reservation before any authenticated seed state
  is copied; cleanup blocks while that exact creator is live and can reclaim a
  partial clone only after its PID/start-time identity is stale;
- recovery-page preservation is reserved before any alternate-page close is
  awaited, so concurrent marked-page handlers cannot cross-close both exact
  recovery workspaces; a second live recovery page deterministically aborts the
  whole single-page runtime as ambiguous. Startup reconciliation installs its
  own synchronous page observer, so an unowned page that arrives and is closed
  by another handler before the next scan is still counted. Any unowned page
  arriving after reconciliation increments a live launch receipt before
  asynchronous page handling; the two-clone proof rechecks that count before
  and after browser close, so delayed restoration cannot certify a falsely
  clean clone. If late recovery ambiguity and shutdown fail together, the
  attempt runtime latches both errors as a sticky fatal state; later page-open,
  preserved-page, and close operations reject instead of continuing through
  the first recovery page;
- cleanup first writes an immutable sandbox/owner/process-status quarantine
  receipt and atomically removes the stopped sandbox from `attempts/`. If
  recursive deletion is interrupted, the next proof invocation resumes only
  that exact receipt-bound quarantine; unreceipted or invalid entries remain
  untouched and block seed acceptance. Acceptance and proof completion both
  require zero attempt and quarantine entries, and no cleanup decision reads
  composer DOM. The combined residue check and seed promotion share the same
  cross-process mutation lock as the sandbox-to-quarantine move, so concurrent
  cleanup cannot disappear between the two directory observations;
- the real proof now waits for DOM readiness plus five seconds of unchanged
  composer/attachment/recovery state before classifying a clone as initially
  clean. Candidate creation accepts only the exact fixed `browser-profile`
  migration source and rejects that path when its directory entry is a symlink
  or junction into accepted/disposable state; attempt creation atomically
  reserves one deterministic directory per job/turn/purpose before copying
  regardless of seed generation, concurrent page opens are rejected before a
  second target can be created, and every attempt-root entry blocks seed
  acceptance. Candidate creation likewise publishes a PID/start-time-owned
  staging receipt before copying login state, reclaims only an exactly
  receipted dead staging clone, resumes token-exact cleanup after a crash has
  already moved that clone to stale quarantine, requires the promoted candidate
  to be the sole candidate entry, and rejects any later candidate once a seed
  is accepted;
- process identity capture is opt-in for attempt runtimes only, so the current
  fixed-profile runtime and `CertifiedChatGptProvider` retain their pre-T1
  behavior. No provider dispatch integration or T2 runner change is present;
- the focused attempt-sandbox suite passes forty-four tests, including delayed restored-state
  detection, exact migration-source enforcement, abandoned-staging refusal,
  unreceipted-quarantine refusal, receipt-bound quarantine cleanup resumption,
  live late-restoration receipt propagation,
  cross-generation logical-attempt uniqueness, pre-launch process-slot and
  concurrent-open exclusion, cleanup-safe ownership before interrupted profile
  cloning, immutable receipt rejection, dead-lock and PID-reuse recovery,
  exact-process mismatch,
  bounded retryable Windows process-start inspection, process-inspection
  fail-closed behavior, stuck-after-CDP-close no-signal retention, missing
  receipt/live-process refusal,
  launch-versus-cleanup exclusion, launch-finalization-versus-cleanup exclusion,
  token-conditional auth/lifecycle stale-lock recovery under a live winner,
  exact dead-owner lifecycle-lock recovery,
  reused-CDP-port refusal, restored-page reuse, pre-first-open and late recovery
  reattachment without a second alternate target, duplicate-recovery ambiguity,
  concurrent recovery-page reservation, sole-candidate acceptance, dead
  candidate-staging reclamation and stale-quarantine resumption,
  alternate/failed-open close failure shutdown, and a real fixture browser that
  destroys dirty clone A, starts clone B clean, records zero Send, preserves the
  seed digest, and leaves zero attempt residue;
- the owner-authorized real gate was attempted once with the stopped worker and
  unowned fixed profile. Clone A reported inherited browser state before model
  probing, prompt fill, attachment upload, or any submitting input action. The
  runner therefore closed and deleted the whole owned clone, rejected and
  deleted its candidate, left no accepted seed, and stopped without opening
  clone B;
- post-failure readback found empty `attempts/` and
  `auth-seed-candidates/`, no attempt/candidate profile, and no process using
  either path. The fixed profile was not cleared, adopted, or overwritten;
- `pnpm check`, `pnpm build`, `pnpm docs:check`, `pnpm public:check`,
  `pnpm test:packed-cli`, and `git diff --check` passed. `pnpm test` passed all
  three partitions: process-serial had 88 passing and one skipped test,
  browser-serial had 30 passing and one skipped test, and the parallel
  partition had 2,054 passing and 32 skipped tests (2,172 passing and 34
  skipped across 197 files in total);
- the real T1 gate is not certified. It requires one explicit fresh auth-seed
  login, then the same two-clone no-Send proof. Fixture success is not a
  substitute, and T2 remains forbidden until that real gate passes.

## Bounded opt-in dogfood after R9

- the exact R9 repo-local build started one detached, explicitly owned v2
  worker against the certified profile. Worker doctor reached `ready` with a
  compatible provider and an empty queue. The global installed Oracle path,
  version, config, and legacy default were not changed;
- one ordinary broker review with a sealed documentation bundle completed with
  exactly one `submission-committed` and one `capture-completed` event. Its
  answer artifact and durable job projection agreed, and its page count returned
  to zero after completion;
- Batch `v2-bounded-dogfood-20260901T102353Z-a2ba` sealed two distinct blind
  lanes with an effective client admission cap of two and a total child cap of
  three. First-stage page count peaked at two, fell as lanes completed, and both
  verified answers were accepted before the durable barrier closed;
- the barrier admitted one synthesis job only after both lanes completed. That
  job recorded one committed Send. Its first 30-minute capture window ended
  recoverable; parent-only `batch resume` restarted capture on the same `jobId`
  without another Send or attempt. A second bounded capture window also ended
  recoverable;
- after the owner explicitly accepted the unavailable synthesis, the worker
  recorded `job-abandoned`, preserved the conversation and both verified lane
  answers, and terminalized the Batch as honest `partial`. The synthesis never
  produced a second `submission-committed` event;
- orderly worker shutdown removed the final retained page, exact v2 Chrome for
  Testing process family, Unix socket, and loopback endpoint. The earlier idle
  legacy Chrome for Testing runtime was independently reconciled and drained;
  final readback found neither Oracle runtime active;
- both independent lane reviews support continued bounded opt-in dogfood while
  legacy remains default. They do not establish the D19 stable-window resource
  plateau required for G3, and the synthesis timeout is retained as negative
  operational evidence rather than converted into a success claim.

## Legacy composer emergency source note

- 2026-09-15: an owner-authorized bounded emergency source patch restores exact
  composer identity in the legacy direct-CDP send path.
  `src/browser/actions/promptComposer.ts` binds the exact composer node Oracle
  focuses and types into, verifies that node with a bounded settled readback
  before Send, and releases the temporary binding on every path after the stamp.
  Detached, replaced, unavailable, or persistently mutated nodes still fail
  closed with zero dispatch, and the one trusted dispatch and no-duplicate-send
  invariants are unchanged.
- This is source only and stays inside the frozen legacy lane: no engine or
  routing change, no v2 capability, no selector change, no draft adoption, and
  no gate, installation, or live-runtime claim. T1/T2/T3/G3/G4 are untouched.

## Tranche ledger

| Tranche                        | State       | Evidence / blocker                                                                               |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------ |
| R0 freeze and architecture     | verified    | public plan, coverage ledger, workspace skeleton, contribution contract, boundary checker        |
| R1 kernel                      | verified    | 13 focused tests plus full repository gates                                                      |
| R2 store/CAS/projection        | verified    | 8 store tests, 13 kernel tests, and full repository gates                                        |
| R3 worker/client/fake provider | verified    | 9 ordinary tests plus the 1,000-job / 8,000-event bounded soak                                   |
| R4 fixture/adapter/faults      | verified    | 15 scenarios, 10 hard faults, and 500-job / 4,000-event no-page-leak soak                        |
| R5 / G1 runtime and login      | verified    | eight checks passed; fixed runtime certified after persistent owner login                        |
| R6 real no-Send probe          | verified    | real compatible receipt; GPT-5.6 Sol/Pro/composer/upload checks; no prompt submitted             |
| R7 / G2 live canary            | verified    | text, sealed-bundle, and committed-capture-recovery receipts all certified                       |
| R8 CLI/MCP cutover candidate   | verified    | repeated real reviews, killed-client reconnect, MCP timeout retrieval; legacy default kept       |
| R9 Batch cutover               | verified    | durable lane/synthesis jobs; restart, retry, owner closure, barrier, receipts, no duplicate Send |
| R10 / G3 default switch        | owner-gated | bounded opt-in dogfood completed; D19 stable-window and default owner decision remain            |
| R11 remote job bridge          | planned     | not reached                                                                                      |
| R12 / G4 legacy retirement     | owner-gated | not reached                                                                                      |

## Disposable-attempt trim ledger

| Slice                           | State                          | Evidence / blocker                                                                                                                                                                                              |
| ------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 authority freeze             | verified                       | PR #9 merged at `efae6f94`; owner accepted the boundary and deletion map; no executable or live action entered T0                                                                                               |
| T1 auth seed and clone proof    | source-candidate; live blocked | primitives, proof runner, and fixture gate pass; first real clone inherited old fixed-profile state and was discarded with zero owned residue; one fresh auth-seed login is required before rerunning the gate  |
| T2 provider sandbox integration | planned                        | cannot begin before T1 proof; legacy remains frozen/default and broker explicit                                                                                                                                 |
| T3 bounded live candidate       | owner-gated                    | each live case requires exact owner authorization after fixture/fault evidence                                                                                                                                  |
| G3 default cutover              | owner-gated                    | independent decision after T1-T3 and stable-resource evidence; default changes only on a supported, certified macOS GUI worker host                                                                             |
| G4 physical legacy deletion     | owner-gated                    | independent decision only after every supported platform has replacement cutover or explicit support retirement, plus rollback tag and fresh reference scan; R11 is neither prerequisite nor deletion authority |

## Current stop conditions

- Any v2 dependency on `src/browser/**`.
- Any need to weaken exact model/effort, attachment, retry, Batch, or owner
  authority contracts.
- Any ordinary job launch against the auth seed or any sandbox copyback to it.
- Any proposal for durable draft/tab/target/profile ownership, profile-wide
  draft leases, digest adoption, orphan reclaim, sentinel holds, or
  cross-sandbox recovery.
- Any cleanup or garbage-collection decision based on composer DOM.
- Any post-`dispatch-at-risk` path capable of emitting another Send.
- Any job-local draft/page/target/cleanup/ambiguity failure that blocks later
  jobs without a separately proven global capacity or authority failure.
- Any source change that would alter the current browser engine before G3.
- Any additional live browser Send without an exact owner-authorized scope and
  a fresh stable attempt identity.
- Any material scope or gate change not recorded in the master plan.

## Next safe action

Preserve every historical canary, R8 review, bounded-dogfood job, fixed v2
profile, and legacy dedicated profile without mutation; do not resend or create
a duplicate. T1 source is tracked by PR #10, but its real gate stopped correctly
because clone A inherited browser state from the old fixed profile. The next
safe action is one explicit fresh auth-seed login/setup followed by the same
two-clone no-Send proof. Do not clear or adopt the unknown old state, certify
from fixture evidence, connect the provider, start a live worker, submit a
prompt, change the default engine, begin T2/T3/R11, or remove legacy execution.
G3 and G4 remain later independent owner gates.
