# Oracle fork agent contract

This repository is the public `IndelibleVivi/oracle` fork. Keep changes
portable and public-safe: never add personal account URLs, private machine
paths, signing-key locations, credentials, OTP procedures, private continuity,
or maintainer-only release instructions.

## Canonical product boundary

- The target canonical consultation lane is ChatGPT GPT-5.6 Pro through the v2
  durable broker, a certified login-only auth seed, and one disposable
  attempt sandbox/runtime/page. This is an accepted plan, not current runtime
  behavior or a default-engine claim.
- At `fork/main@efae6f94`, legacy `browser` remains the shipped/default
  executable route and v2 `broker` remains explicit opt-in. Both fixed-profile
  auto-submit routes are frozen for ordinary owner work until the disposable
  sandbox gates are complete.
- OpenCLI is an explicit alternative transport for ordinary consultations. It
  is never an automatic fallback.
- Batch Oracle v1 preserves its strict manifest, admitted source snapshot,
  sealed inputs, blind first stage, durable barrier, owner decisions, and
  verified rendering. New lane and synthesis attempts are Batch-owned Oracle
  v2 jobs admitted through `oracle-client`; the worker alone owns browser
  execution and global page concurrency.
- Batch parent state owns logical lineage, retry admission, barrier progression,
  answer acceptance, and owner closure. Durable worker jobs own execution and
  capture. Pre-R9 child-session state remains readable and protected from
  pruning, but is not a canonical execution path for new Batch work.
- Never click or auto-click ChatGPT's `Answer now` control. A quiet Pro run is
  recovered by reattaching its exact stored session, not by resubmitting.

## Oracle v2 integration boundary

- `fork/main@efae6f94714df2f63a2c3afbed817def42421f23` (PR #9 merge) is the
  accepted T0 authority-freeze baseline; `fork/main@39ab7fb3` (PR #8 merge) is
  the implementation-inspection baseline, and `fork/main@e6f170ff` remains the
  historical pre-v2 legacy baseline. Until G4, do not add capabilities to or broadly
  refactor `src/browser/**`; only a bounded data-loss or duplicate-send
  emergency fix may enter the frozen legacy lane. The sole additional exception
  is the owner-authorized 2026-09-25 semantic-picker compatibility delta recorded
  in `docs/oracle-v2-master-plan.md`: it may recognize the newly observed
  Intelligence trigger, simple picker view, and accessible effort status with
  focused regression coverage, without weakening proof or changing Send,
  recovery, ownership, or G3/G4. It does not authorize other legacy availability
  work.
- The accepted v2 architecture and complete coverage ledger live in
  `docs/oracle-v2-master-plan.md`. Current tranche and gate evidence live in
  `docs/oracle-v2-progress.md`. The source dependency, ownership, and G4
  deletion reference map lives in
  `docs/oracle-v2-browser-ownership-map.md`.
- New v2 source lives under `packages/*` and `apps/*`. It must not import the
  legacy browser implementation. ChatGPT page-reading and Playwright
  automation knowledge belongs only in `packages/chatgpt-adapter`. The
  sanitized `apps/oracle-provider-fixture` may define simulated provider
  markup and scenarios, but it must not become a second adapter or production
  selector authority.
- The canonical v2 worker is a macOS GUI-session worker over an owner-only Unix
  socket. Native Windows must fail closed before socket acquisition; do not
  substitute a named pipe or TCP listener without an accepted plan delta and
  equivalent owner-isolation evidence. Windows ordinary use remains on the
  legacy `browser` engine until a non-macOS worker is deliberately added.
- The R8 opt-in `broker` engine routes CLI and MCP through `oracle-client` and
  `oracle-bundle`; neither surface owns browser execution or worker state. R9
  routes Batch lane and synthesis execution through the same client protocol.
  Legacy `browser` remains the shipped/default ordinary engine until G3.
  Source-complete broker or Batch support is not an installed-runtime update,
  default-engine switch, or legacy retirement.
- Keep G1 runtime/login selection, G2 first live Send, G3 default-engine
  cutover, and G4 legacy removal as separate owner decisions.
- G3 may change the no-API default to `broker` only on a supported, certified
  macOS GUI worker host. Windows and every other deferred worker platform keep
  their existing engine default until that platform has its own accepted worker
  plan and evidence; a platform-agnostic `broker` default is forbidden.
- R11 remote bridge work is independent of G4. The disposable-attempt trim
  explicitly supersedes R12's old `R10-R11` dependency: G4 depends on accepted
  T1-T3 and G3 evidence, a rollback tag, a fresh deletion scan, and its own
  owner decision, not on remote bridge delivery.
- G4 is a repository-wide physical deletion gate, not a macOS-only cleanup.
  Do not remove the shared legacy implementation while any supported platform
  still selects it by default. Every such platform must first have an accepted
  replacement-worker cutover, or its support must be retired by a separate
  explicit owner decision. Deferred platform work does not itself authorize
  either outcome.

## Disposable attempt sandbox contract

- The fixed v2 `browser-profile` is a superseded runtime candidate. Treat it as
  login/auth-seed migration input only after the applicable owner gate; never
  run an ordinary consultation directly against the seed and never copy a
  sandbox back into it.
- Each turn attempt and purpose owns one private disposable sandbox, one exact
  Chrome for Testing process, one adapter, and at most one page. Preparation,
  verification, Send, and `dispatch-at-risk` commit observation are one
  `dispatch` purpose and must reuse the exact same sandbox/key/lifetime; only
  committed capture recovery and probe use distinct purpose-specific sandboxes.
  Browser resources are execution evidence, never durable job truth.
- Before Send, failure closes and removes the whole sandbox. Do not clear,
  adopt, digest-match, reclaim, or otherwise infer ownership of a composer
  draft or attachment.
- After `dispatch-at-risk`, Send authority is permanently absent. Commit may be
  observed only in the exact dispatch sandbox that emitted the potentially
  submitting event; if that workspace cannot prove the commit, preserve ledger
  truth as ambiguous and destroy browser resources. Multiple live recovery
  candidates or failed ambiguity containment latch the attempt runtime into a
  fatal state; no later page-open or preserved-page operation may succeed.
- Committed-capture recovery may create a fresh capture-only sandbox and
  navigate only from the durable submission receipt. It never fills the
  composer or emits Send.
- Completion, failed-unsent, ambiguity, and owner closure all end with exact
  sandbox process/profile cleanup. Cleanup and GC use durable job state, the
  immutable sandbox owner marker, and exact process identity only; composer DOM
  is never cleanup authority. A persisted PID is never a stable process handle:
  cross-process cleanup may request `Browser.close` only through the exact
  receipt-validated CDP connection, and must retain the sandbox if that process
  does not exit rather than signal the bare PID.
- Do not create durable draft/tab/target/page/PID/port/profile/sandbox states,
  profile-wide draft leases, digest adoption, orphan reclaim, sentinel holds,
  or cross-sandbox lineage. One job-local browser/cleanup/ambiguity failure
  must not block later jobs unless a distinct global authority or hard-capacity
  failure is proven.
- Implement one trim slice at a time. T0 is documentation/authority only; T1 is
  auth-seed and clone proof only; T2 integrates the provider router; T3 is
  bounded live acceptance. Do not cross an owner gate implicitly.
- T1 source primitives may exist without an accepted auth seed. If the
  owner-authorized two-clone proof finds inherited state in clone A or B, it
  must close and delete only that owned sandbox, reject the candidate, preserve
  the fixed profile unchanged, and stop for one explicit fresh auth-seed login.
  Do not treat fixture evidence as live certification or begin T2 while this
  gate is blocked.

## Batch Oracle source and documentation

- Canonical Batch implementation: `src/batch/` and `src/cli/batchCommand.ts`.
- Canonical Batch job lineage fields and reconciliation:
  `src/batch/types.ts` and `src/batch/reconcile.ts`.
- Pre-R9 child-session compatibility and pruning protection:
  `src/sessionManager.ts` and `src/batch/store.ts`; do not use them to launch
  new Batch work.
- User contract: `docs/batch-oracle.md`.
- CLI/config/session surfaces: `docs/cli-reference.md`,
  `docs/configuration.md`, and `docs/sessions.md`.
- Agent working method: `skills/oracle/SKILL.md`, especially
  `Parallel-first Batch Oracle`.
- Batch manifests are strict JSON/JSON5. Do not add YAML or a permissive
  unknown-field path.
- One active recoverable attempt is allowed per logical lane. Stable attempt
  keys are `batch:<batchId>:lane:<laneId>:attempt:<n>` and
  `batch:<batchId>:synthesis:<synthesisId>:attempt:<n>`. A new attempt is valid
  only on explicit Batch resume after the worker proves the earlier job
  failed-unsent or verified-unsent. A committed recoverable attempt resumes
  the same job and never resubmits Send.
- Source admission is snapshot-first: resolve membership, copy each admitted
  file once, hash the copied bytes, atomically publish the snapshot, then
  assemble every lane from it. Resume must use sealed copies and must not
  re-glob a changed workspace.
- Ambiguous or possibly committed work waits for owner resolution and must
  never be redispatched.
- Synthesis and raw rendering consume answers only through the accepted answer
  digest, receipt, and sealed input manifest. Integrity mismatch blocks use.
- Synthesis starts only after the durable barrier. Partial synthesis is an
  explicit two-step owner decision (`accept-missing`, then `--allow-partial`)
  and must preserve missing-lane provenance.
- Generic v2 job resume and abandon reject Batch-owned jobs. Recovery, retry,
  completion, and owner closure go through the Batch parent, which supplies the
  exact owner identity to parent-only worker operations. Generic inspection of
  pre-R9 Batch child sessions remains read-only.

## Verification

For Batch or shared worker/client changes, run the narrow affected tests
first, then complete the repository gates before proposing release:

```bash
pnpm check
pnpm test
pnpm build
pnpm docs:check
pnpm public:check
pnpm test:packed-cli
git diff --check
```

Do not relax recovery, prompt-identity, target-ownership, Pro timing, or
attachment-readiness assertions to make a change pass. Account-side live tests
are explicit and bounded; run them only when the task authorizes the exact
submission. The real two-clone `oracle browser smoke` path submits no prompt,
but still requires the exact T1 owner authorization because it operates on the
authenticated seed and disposable local browser state.

Windows-specific browser changes must also update `docs/windows-work.md` when
its operator truth changes. Public changelog entries describe shipped or
unreleased behavior honestly and never claim a source-only candidate is live.
