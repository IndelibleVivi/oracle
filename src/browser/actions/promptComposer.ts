import { createHash, randomUUID } from "node:crypto";
import type { ChromeClient, BrowserLogger } from "../types.js";
import {
  INPUT_SELECTORS,
  PROMPT_PRIMARY_SELECTOR,
  PROMPT_FALLBACK_SELECTOR,
  SEND_BUTTON_SELECTORS,
  STOP_BUTTON_SELECTOR,
  ASSISTANT_ROLE_SELECTOR,
} from "../constants.js";
import {
  buildConversationTurnCountExpression,
  buildConversationTurnListExpression,
} from "../conversationTurns.js";
import { delay } from "../utils.js";
import { logDomFailure } from "../domDebug.js";
import { buildClickDispatcher } from "./domEvents.js";
import { BrowserAutomationError } from "../../oracle/errors.js";

const ENTER_KEY_EVENT = {
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
} as const;
const ENTER_KEY_TEXT = "\r";
const TARGET_COMPOSITING_SETTLE_MS = 150;
const PREEXISTING_COMPOSER_SETTLE_MS = 5_000;
const PREEXISTING_COMPOSER_POLL_MS = 200;
const OWNED_DRAFT_CLEAR_SETTLE_MS = 250;
const COMPOSER_BINDING_SETTLE_MS = 2_000;
const COMPOSER_BINDING_SETTLE_POLL_MS = 100;

// Input.insertText gives ProseMirror plain text, but ProseMirror renders each
// line as a direct block. HTMLElement.innerText inserts an extra newline
// between those blocks, so an unchanged multiline prompt appears mutated.
// Reconstruct the plain-text value from the editor blocks instead. Real text,
// empty paragraphs, and explicit hard breaks remain identity-bearing.
const COMPOSER_VALUE_READER_SOURCE = `
      const readComposerValue = (node) => {
        if (!node) return '';
        if (node instanceof HTMLTextAreaElement) return node.value ?? '';
        const readInlineText = (current) => {
          if (current?.nodeType === Node.TEXT_NODE) return current.nodeValue ?? '';
          if (!(current instanceof HTMLElement)) return '';
          if (current.tagName === 'BR') {
            return current.classList.contains('ProseMirror-trailingBreak') ? '' : '\\n';
          }
          return Array.from(current.childNodes).map(readInlineText).join('');
        };
        if (
          node instanceof HTMLElement &&
          (node.isContentEditable || node.getAttribute('contenteditable') === 'true')
        ) {
          const blocks = Array.from(node.children);
          return blocks.length > 0
            ? blocks.map(readInlineText).join('\\n')
            : readInlineText(node);
        }
        return node.innerText ?? node.textContent ?? '';
      };
`;

function createComposerBindingKey(): string {
  return `__oracleComposer_${randomUUID().replaceAll("-", "")}`;
}

function buildComposerBindingResolverSource(key: string | null | undefined): string {
  const keyLiteral = JSON.stringify(key ?? null);
  return `
      const composerBindingKey = ${keyLiteral};
      const boundComposerNode = (() => {
        if (!composerBindingKey) return null;
        const bound = globalThis[composerBindingKey];
        return bound instanceof HTMLElement && bound.isConnected ? bound : null;
      })();
`;
}

async function releaseExactComposerBinding(
  Runtime: ChromeClient["Runtime"],
  key: string,
): Promise<void> {
  const keyLiteral = JSON.stringify(key);
  try {
    await Runtime.evaluate({
      expression: `(() => {
        // oracle-composer-binding-release
        delete globalThis[${keyLiteral}];
      })()`,
      returnByValue: true,
    });
  } catch {
    // Best-effort only. The key is attempt-unique and is never adopted later.
  }
}

interface ExactComposerRead {
  available: boolean;
  value: string;
  anyCandidateHasContent: boolean;
}

async function readExactBoundComposer(
  Runtime: ChromeClient["Runtime"],
  key: string,
): Promise<ExactComposerRead> {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      // oracle-composer-binding-read
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      ${buildComposerBindingResolverSource(key)}
      const candidates = inputSelectors
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      return {
        boundFound: Boolean(boundComposerNode),
        editorText: boundComposerNode ? readComposerValue(boundComposerNode) : '',
        anyCandidateHasContent: candidates.some(
          (node) => readComposerValue(node).trim().length > 0,
        ),
      };
    })()`,
    returnByValue: true,
  });
  const value = result?.value;
  return {
    available: value?.boundFound === true,
    value: typeof value?.editorText === "string" ? value.editorText : "",
    anyCandidateHasContent: value?.anyCandidateHasContent === true,
  };
}

async function verifyExactBoundComposerPrompt({
  runtime,
  key,
  prompt,
  logger,
  diagnostic,
}: {
  runtime: ChromeClient["Runtime"];
  key: string;
  prompt: string;
  logger: BrowserLogger;
  diagnostic: SubmissionDiagnostic;
}): Promise<void> {
  const matches = (value: string) => normalizeComposerText(value) === normalizeComposerText(prompt);
  const deadline = Date.now() + COMPOSER_BINDING_SETTLE_MS;
  let read = await readExactBoundComposer(runtime, key);

  if (
    prompt.length >= 50_000 &&
    read.value.length > 0 &&
    read.value.length < prompt.length - 2_000
  ) {
    await logDomFailure(runtime, logger, "prompt-too-large");
    throw new BrowserAutomationError(
      "Prompt appears truncated in the composer (likely too large).",
      {
        stage: "submit-prompt",
        code: "prompt-too-large",
        submissionCommitted: false,
        draftRetained: true,
        promptLength: prompt.length,
        observedLength: read.value.length,
        observedDraftSha256: composerSha256(read.value),
      },
    );
  }

  while (read.available && !matches(read.value) && Date.now() < deadline) {
    await delay(Math.min(COMPOSER_BINDING_SETTLE_POLL_MS, Math.max(0, deadline - Date.now())));
    read = await readExactBoundComposer(runtime, key);
  }

  const composerLooksEmpty = read.value.length === 0 && !read.anyCandidateHasContent;
  diagnostic.composerLengthBeforeDispatch = read.value.length;
  diagnostic.composerCleared = composerLooksEmpty;
  diagnostic.draftRetained = !composerLooksEmpty;
  if (!read.available || !matches(read.value)) {
    throw new BrowserAutomationError(
      "Prompt composer changed after Oracle populated it; refusing to send.",
      {
        stage: "submit-prompt",
        code: "composer-mutated-before-send",
        submissionCommitted: false,
        draftRetained: diagnostic.draftRetained,
        expectedLength: prompt.length,
        observedLength: read.value.length,
      },
    );
  }
}

export interface AttachmentReadyExpectation {
  name: string;
  generatedBundle?: boolean;
}

type AttachmentReadyInput = string | AttachmentReadyExpectation;

type SubmissionDispatchMethod = "trusted-click" | "enter";
type PotentiallySubmittingEvent = "mousePressed" | "enterKeyDown";

interface SubmissionDiagnostic {
  initialDispatchMethod: SubmissionDispatchMethod | null;
  targetActivationAttempted: boolean;
  targetActivationVerified: boolean;
  preDispatchBaseline: number | null;
  composerLengthBeforeDispatch: number | null;
  composerCleared: boolean | null;
  draftRetained: boolean | null;
  newUserTurnObserved: boolean;
  matchingUserTurnObserved: boolean;
  assistantObserved: boolean;
  generationControlObserved: boolean;
  retryEligible: boolean;
  retryBlockedReason: string | null;
  alternateDispatchAttempted: boolean;
  alternateDispatchMethod: SubmissionDispatchMethod | null;
  finalCommitClassification: string | null;
  ownershipVerified: boolean;
  composerMatchedPromptBeforeDispatch: boolean;
  ownedAttachmentCleanupAttempted: boolean;
  ownedAttachmentSetVerified: boolean;
  ownedAttachmentCleanupSucceeded: boolean;
  ownedDraftCleanupAttempted: boolean;
  ownedDraftCleanupSucceeded: boolean;
  potentiallySubmittingEventEmitted: boolean;
  potentiallySubmittingEvent: PotentiallySubmittingEvent | null;
}

interface SubmitPromptDependencies {
  runtime: ChromeClient["Runtime"];
  input: ChromeClient["Input"];
  page?: ChromeClient["Page"];
  attachmentNames?: AttachmentReadyInput[];
  baselineTurns?: number | null;
  inputTimeoutMs?: number | null;
  attachmentTimeoutMs?: number | null;
  /** Persist the at-risk dispatch boundary before final target/input revalidation. */
  onPromptDispatched?: () => Promise<void> | void;
  /** Record the dispatch-event timestamp immediately before mousePressed/keyDown. */
  onPromptDispatchEvent?: () => Promise<void> | void;
  onPromptCommitted?: (
    committedTurns: number | null,
    committedUserTurnIndex: number | null,
  ) => Promise<void> | void;
  onPromptCommitPending?: () => Promise<void> | void;
  isSubmissionOwner?: () => Promise<boolean> | boolean;
}

function createSubmissionDiagnostic(baselineTurns?: number | null): SubmissionDiagnostic {
  return {
    initialDispatchMethod: null,
    targetActivationAttempted: false,
    targetActivationVerified: false,
    preDispatchBaseline:
      typeof baselineTurns === "number" && Number.isFinite(baselineTurns) && baselineTurns >= 0
        ? Math.floor(baselineTurns)
        : null,
    composerLengthBeforeDispatch: null,
    composerCleared: null,
    draftRetained: null,
    newUserTurnObserved: false,
    matchingUserTurnObserved: false,
    assistantObserved: false,
    generationControlObserved: false,
    retryEligible: false,
    retryBlockedReason: null,
    alternateDispatchAttempted: false,
    alternateDispatchMethod: null,
    finalCommitClassification: null,
    ownershipVerified: false,
    composerMatchedPromptBeforeDispatch: false,
    ownedAttachmentCleanupAttempted: false,
    ownedAttachmentSetVerified: false,
    ownedAttachmentCleanupSucceeded: false,
    ownedDraftCleanupAttempted: false,
    ownedDraftCleanupSucceeded: false,
    potentiallySubmittingEventEmitted: false,
    potentiallySubmittingEvent: null,
  };
}

function enrichSubmissionError(error: unknown, diagnostic: SubmissionDiagnostic): Error {
  if (error instanceof BrowserAutomationError) {
    const noPotentiallySubmittingEvent =
      diagnostic.potentiallySubmittingEventEmitted === false &&
      error.details?.potentiallySubmittingEventEmitted !== true &&
      error.details?.dispatchAttempted !== true;
    const noRetainedDraft =
      diagnostic.draftRetained !== true && error.details?.draftRetained === false;
    const inferredRetrySafe =
      error.details?.retrySafe !== false &&
      error.details?.recoverable !== true &&
      noPotentiallySubmittingEvent &&
      noRetainedDraft;
    const retrySafe = error.details?.retrySafe === true || inferredRetrySafe;
    if (inferredRetrySafe) {
      diagnostic.retryEligible = true;
      diagnostic.retryBlockedReason = null;
      diagnostic.finalCommitClassification ??= "safe-pre-dispatch-failure";
    }
    const guidance = retrySafe
      ? "No potentially submitting event was emitted and no draft was retained; an explicit retry is safe."
      : "Keep this session and inspect it with `oracle session <session-id> --render`; do not immediately rerun the prompt.";
    return new BrowserAutomationError(
      error.message.includes("oracle session <session-id>")
        ? error.message
        : `${error.message} ${guidance}`,
      {
        ...error.details,
        retrySafe,
        dispatchAttempted:
          error.details?.dispatchAttempted ?? diagnostic.potentiallySubmittingEventEmitted,
        potentiallySubmittingEventEmitted:
          error.details?.potentiallySubmittingEventEmitted ??
          diagnostic.potentiallySubmittingEventEmitted,
        submissionDiagnostic: { ...diagnostic },
      },
      error,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function submitPrompt(
  deps: SubmitPromptDependencies,
  prompt: string,
  logger: BrowserLogger,
): Promise<number | null> {
  const diagnostic = createSubmissionDiagnostic(deps.baselineTurns);
  try {
    return await submitPromptInternal(deps, prompt, logger, diagnostic);
  } catch (error) {
    const finalError = await cleanupOwnedDraftAfterAttachmentReadinessFailure({
      deps,
      prompt,
      diagnostic,
      error,
    });
    throw enrichSubmissionError(finalError, diagnostic);
  }
}

export async function assertPromptComposerEmptyBeforeAttachmentMutation(
  Runtime: ChromeClient["Runtime"],
): Promise<void> {
  const diagnostic = createSubmissionDiagnostic();
  try {
    await assertPromptComposerEmptyForSubmission(Runtime, diagnostic);
    if (!(await verifyComposerAttachmentSetEmpty(Runtime))) {
      diagnostic.draftRetained = true;
      throw new BrowserAutomationError(
        "The ChatGPT composer already contains attachments; refusing to remove or replace them.",
        {
          stage: "submit-prompt",
          code: "preexisting-composer-attachments",
          submissionCommitted: false,
          draftRetained: true,
        },
      );
    }
  } catch (error) {
    throw enrichSubmissionError(error, diagnostic);
  }
}

export async function clearOwnedPromptAndAttachmentsForFallback(
  Runtime: ChromeClient["Runtime"],
  expectedPrompt: string,
  attachmentNames: AttachmentReadyInput[],
  observedDraftSha256?: string,
): Promise<void> {
  try {
    const ownedPrompt = await readExactOwnedPromptComposer(Runtime);
    const expectedDigest = observedDraftSha256?.toLowerCase();
    const promptMatches = expectedDigest
      ? /^[a-f0-9]{64}$/.test(expectedDigest) &&
        composerSha256(ownedPrompt ?? "") === expectedDigest
      : ownedPrompt !== null &&
        normalizeComposerText(ownedPrompt) === normalizeComposerText(expectedPrompt);
    if (!promptMatches || ownedPrompt === null) {
      throw new Error("exact owned prompt changed before fallback cleanup");
    }
    const attachmentsMatch =
      attachmentNames.length > 0
        ? await verifyExactOwnedAttachmentSet(Runtime, attachmentNames)
        : await verifyComposerAttachmentSetEmpty(Runtime);
    if (!attachmentsMatch) {
      throw new Error("composer attachment set changed before fallback cleanup");
    }

    if (attachmentNames.length > 0) {
      await clearExactOwnedAttachmentSet(Runtime, attachmentNames);
    }

    if (!(await clearExactOwnedPromptComposer(Runtime, ownedPrompt))) {
      throw new Error("exact owned prompt changed during fallback cleanup");
    }

    if (!(await verifyComposerCleanupComplete(Runtime))) {
      throw new Error("composer state changed during final fallback cleanup verification");
    }
  } catch (error) {
    throw new BrowserAutomationError(
      "Oracle could not verify removal of only this attempt's prompt and attachments before file fallback, so the exact tab was retained for recovery.",
      {
        stage: "submit-prompt",
        code: "fallback-cleanup-unverified",
        submissionCommitted: false,
        dispatchAttempted: false,
        potentiallySubmittingEventEmitted: false,
        draftRetained: true,
        retrySafe: false,
        recoverable: true,
        cleanupVerified: false,
      },
      error,
    );
  }
}

async function submitPromptInternal(
  deps: SubmitPromptDependencies,
  prompt: string,
  logger: BrowserLogger,
  diagnostic: SubmissionDiagnostic,
): Promise<number | null> {
  // The exact composer-node binding is created before typing and released on
  // every path afterwards, including failures inside Input.insertText, the
  // first verification or fallback write, target activation, settled readback,
  // and either dispatch method. Release is best-effort and attempt-unique.
  const composerBindingKey = createComposerBindingKey();
  try {
    return await runSubmitPromptAttempt(deps, prompt, logger, diagnostic, composerBindingKey);
  } finally {
    await releaseExactComposerBinding(deps.runtime, composerBindingKey);
  }
}

async function runSubmitPromptAttempt(
  deps: SubmitPromptDependencies,
  prompt: string,
  logger: BrowserLogger,
  diagnostic: SubmissionDiagnostic,
  composerBindingKey: string,
): Promise<number | null> {
  const { runtime, input } = deps;

  await waitForDomReady(runtime, logger, deps.inputTimeoutMs ?? undefined);
  await assertPromptComposerEmptyForSubmission(runtime, diagnostic);
  const encodedPrompt = JSON.stringify(prompt);
  const composerBindingKeyLiteral = JSON.stringify(composerBindingKey);
  const focusResult = await runtime.evaluate({
    expression: `(() => {
      ${buildClickDispatcher()}
      const SELECTORS = ${JSON.stringify(INPUT_SELECTORS)};
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const focusNode = (node) => {
        if (!node) {
          return false;
        }
        // Learned: React/ProseMirror require a real click + focus + selection for inserts to stick.
        dispatchClickSequence(node);
        if (typeof node.focus === 'function') {
          node.focus();
        }
        const doc = node.ownerDocument;
        const selection = doc?.getSelection?.();
        if (selection) {
          const range = doc.createRange();
          range.selectNodeContents(node);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return true;
      };

      const candidates = [];
      for (const selector of SELECTORS) {
        const node = document.querySelector(selector);
        if (node) {
          candidates.push(node);
        }
      }
      const preferred = candidates.find((node) => isVisible(node)) || candidates[0];
      if (preferred && focusNode(preferred)) {
        // Bind this exact node to the attempt before Input.insertText lands in
        // it, so the later pre-dispatch identity read cannot drift to another
        // first-visible candidate.
        globalThis[${composerBindingKeyLiteral}] = preferred;
        const bound = globalThis[${composerBindingKeyLiteral}] === preferred;
        return { focused: true, bound };
      }
      return { focused: false, bound: false };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!focusResult.result?.value?.focused) {
    await logDomFailure(runtime, logger, "focus-textarea");
    throw new Error("Failed to focus prompt textarea");
  }
  if (focusResult.result?.value?.bound !== true) {
    // Without an exact-node binding Oracle cannot prove which composer node it
    // populated, so it refuses to type at all instead of sending later.
    throw new BrowserAutomationError(
      "Oracle could not bind the exact ChatGPT composer node before typing; refusing to modify the page.",
      {
        stage: "submit-prompt",
        code: "composer-state-unavailable",
        submissionCommitted: false,
        draftRetained: false,
      },
    );
  }

  await input.insertText({ text: prompt });

  // Some pages (notably ChatGPT when subscriptions/widgets load) need a brief settle
  // before the send button becomes enabled; give it a short breather to avoid races.
  await delay(500);

  const primarySelectorLiteral = JSON.stringify(PROMPT_PRIMARY_SELECTOR);
  const fallbackSelectorLiteral = JSON.stringify(PROMPT_FALLBACK_SELECTOR);
  const verification = await runtime.evaluate({
    expression: `(() => {
      const editor = document.querySelector(${primarySelectorLiteral});
      const fallback = document.querySelector(${fallbackSelectorLiteral});
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      ${buildComposerBindingResolverSource(composerBindingKey)}
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const candidates = inputSelectors
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      const active = candidates.find((node) => isVisible(node)) || candidates[0] || null;
      return {
        // Prefer the exact node Oracle typed into; only fall back to the legacy
        // primary selector when no attempt binding resolves.
        editorText: readComposerValue(boundComposerNode || editor),
        fallbackValue: fallback?.value ?? '',
        activeValue: readComposerValue(active),
      };
    })()`,
    returnByValue: true,
  });

  const editorTextRaw = verification.result?.value?.editorText ?? "";
  const fallbackValueRaw = verification.result?.value?.fallbackValue ?? "";
  const activeValueRaw = verification.result?.value?.activeValue ?? "";
  const editorTextTrimmed = editorTextRaw?.trim?.() ?? "";
  const fallbackValueTrimmed = fallbackValueRaw?.trim?.() ?? "";
  const activeValueTrimmed = activeValueRaw?.trim?.() ?? "";
  if (!editorTextTrimmed && !fallbackValueTrimmed && !activeValueTrimmed) {
    // Learned: occasionally Input.insertText does not land. Write only the
    // exact node selected above; never switch to another inferred composer.
    await runtime.evaluate({
      expression: `(() => {
        ${buildComposerBindingResolverSource(composerBindingKey)}
        if (!boundComposerNode) return false;
        if (boundComposerNode instanceof HTMLTextAreaElement) {
          boundComposerNode.value = ${encodedPrompt};
          boundComposerNode.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
          boundComposerNode.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        boundComposerNode.textContent = ${encodedPrompt};
        boundComposerNode.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
        return true;
      })()`,
    });
  }

  const preDispatchBaseline =
    typeof deps.baselineTurns === "number" &&
    Number.isFinite(deps.baselineTurns) &&
    deps.baselineTurns >= 0
      ? Math.floor(deps.baselineTurns)
      : null;
  diagnostic.preDispatchBaseline = preDispatchBaseline;
  await activateExactSubmissionTarget({
    Page: deps.page,
    isSubmissionOwner: deps.isSubmissionOwner,
    diagnostic,
  });
  await verifyExactBoundComposerPrompt({
    runtime,
    key: composerBindingKey,
    prompt,
    logger,
    diagnostic,
  });
  diagnostic.composerMatchedPromptBeforeDispatch = true;

  let dispatchIntentPersisted = false;
  const persistDispatchIntent = async (): Promise<void> => {
    if (dispatchIntentPersisted) return;
    await deps.onPromptDispatched?.();
    dispatchIntentPersisted = true;
  };
  const revalidateAfterDispatchIntent = async (): Promise<void> => {
    await activateExactSubmissionTarget({
      Page: deps.page,
      isSubmissionOwner: deps.isSubmissionOwner,
      diagnostic,
    });
  };
  const markPotentiallySubmittingEvent = async (
    method: SubmissionDispatchMethod,
    event: PotentiallySubmittingEvent,
  ): Promise<void> => {
    if (diagnostic.potentiallySubmittingEventEmitted) return;
    await deps.onPromptDispatchEvent?.();
    diagnostic.initialDispatchMethod = method;
    diagnostic.potentiallySubmittingEventEmitted = true;
    diagnostic.potentiallySubmittingEvent = event;
    diagnostic.retryEligible = false;
    diagnostic.retryBlockedReason = "potentially-submitting-event-emitted";
  };

  try {
    const clicked = await attemptSendButton(
      runtime,
      input,
      logger,
      deps?.attachmentNames,
      deps?.attachmentTimeoutMs,
      prompt,
      () => markPotentiallySubmittingEvent("trusted-click", "mousePressed"),
      persistDispatchIntent,
      revalidateAfterDispatchIntent,
      composerBindingKey,
    );
    if (!clicked) {
      await persistDispatchIntent();
      await revalidateAfterDispatchIntent();
      await assertComposerUnchanged(runtime, prompt, composerBindingKey);
      await dispatchEnterKey(input, () => markPotentiallySubmittingEvent("enter", "enterKeyDown"));
      logger("Submitted prompt via Enter key");
    } else {
      logger("Clicked send button");
    }
  } catch (error) {
    if (!diagnostic.potentiallySubmittingEventEmitted) throw error;
    diagnostic.finalCommitClassification = "commit-indeterminate-after-dispatch";
    throw buildIndeterminateCommitError({
      prompt,
      diagnostic,
      cause: error,
    });
  }

  const commitTimeoutMs = Math.max(60_000, deps.inputTimeoutMs ?? 0);
  // Learned: the send button can succeed but the turn doesn't appear immediately; verify commit via turns/stop button.
  let committed: { turnsCount: number | null; userTurnIndex: number | null };
  try {
    committed = await verifyPromptCommitted(
      runtime,
      prompt,
      commitTimeoutMs,
      logger,
      preDispatchBaseline ?? undefined,
      deps.onPromptCommitPending,
      diagnostic,
    );
  } catch (error) {
    const alreadyIndeterminate =
      error instanceof BrowserAutomationError && error.details?.retrySafe === false;
    if (diagnostic.potentiallySubmittingEventEmitted && !alreadyIndeterminate) {
      diagnostic.finalCommitClassification = "commit-indeterminate-after-dispatch";
      throw buildIndeterminateCommitError({
        prompt,
        diagnostic,
        timeoutMs: commitTimeoutMs,
        cause: error,
      });
    }
    throw error;
  }
  diagnostic.finalCommitClassification = "verified-single-user-turn";
  await deps.onPromptCommitted?.(committed.turnsCount, committed.userTurnIndex);
  return committed.turnsCount;
}

async function assertPromptComposerEmptyForSubmission(
  Runtime: ChromeClient["Runtime"],
  diagnostic: SubmissionDiagnostic,
): Promise<void> {
  const deadline = Date.now() + PREEXISTING_COMPOSER_SETTLE_MS;
  let composerLength = 0;
  while (true) {
    const result = await Runtime.evaluate({
      expression: `(() => {
        // oracle-preexisting-composer-check
        const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
        ${COMPOSER_VALUE_READER_SOURCE}
        const isVisible = (node) => {
          if (!node || typeof node.getBoundingClientRect !== 'function') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const inputs = inputSelectors
          .map((selector) => document.querySelector(selector))
          .filter((node) => Boolean(node));
        const active = inputs.find((node) => isVisible(node)) || inputs[0] || null;
        const composerValue = readComposerValue(active);
        return {
          composerFound: Boolean(active),
          composerEmpty: String(composerValue).trim().length === 0,
          composerLength: String(composerValue).length,
        };
      })()`,
      returnByValue: true,
    });
    const value = result.result?.value as
      | { composerFound?: boolean; composerEmpty?: boolean; composerLength?: number }
      | undefined;
    if (value?.composerFound === false || typeof value?.composerEmpty !== "boolean") {
      throw new BrowserAutomationError(
        "Oracle could not verify the active ChatGPT composer before typing; refusing to modify the page.",
        {
          stage: "submit-prompt",
          code: "composer-state-unavailable",
          submissionCommitted: false,
          draftRetained: false,
        },
      );
    }
    if (value.composerEmpty) return;

    composerLength =
      typeof value.composerLength === "number" && Number.isFinite(value.composerLength)
        ? Math.max(0, Math.floor(value.composerLength))
        : 0;
    if (Date.now() >= deadline) break;
    await delay(Math.min(PREEXISTING_COMPOSER_POLL_MS, Math.max(0, deadline - Date.now())));
  }

  diagnostic.composerLengthBeforeDispatch = composerLength;
  diagnostic.composerCleared = false;
  diagnostic.draftRetained = true;
  diagnostic.finalCommitClassification = "preexisting-composer-content";
  throw new BrowserAutomationError(
    "The ChatGPT composer already contains text that Oracle cannot prove it owns; refusing to append, clear, or submit it.",
    {
      stage: "submit-prompt",
      code: "preexisting-composer-content",
      submissionCommitted: false,
      draftRetained: true,
      composerLengthBeforeDispatch: composerLength,
      composerSettleTimeoutMs: PREEXISTING_COMPOSER_SETTLE_MS,
    },
  );
}

async function cleanupOwnedDraftAfterAttachmentReadinessFailure({
  deps,
  prompt,
  diagnostic,
  error,
}: {
  deps: SubmitPromptDependencies;
  prompt: string;
  diagnostic: SubmissionDiagnostic;
  error: unknown;
}): Promise<unknown> {
  if (
    !(error instanceof BrowserAutomationError) ||
    error.details?.code !== "attachment-send-not-ready"
  ) {
    return error;
  }

  diagnostic.finalCommitClassification = "pre-dispatch-attachment-readiness-failed";
  const canAttemptCleanup =
    !diagnostic.potentiallySubmittingEventEmitted &&
    diagnostic.targetActivationVerified &&
    diagnostic.ownershipVerified &&
    diagnostic.composerMatchedPromptBeforeDispatch &&
    Array.isArray(deps.attachmentNames) &&
    deps.attachmentNames.length > 0 &&
    typeof deps.isSubmissionOwner === "function";

  if (!canAttemptCleanup) {
    diagnostic.retryEligible = false;
    diagnostic.retryBlockedReason = diagnostic.potentiallySubmittingEventEmitted
      ? "potentially-submitting-event-emitted"
      : "owned-pre-dispatch-cleanup-not-provable";
    return new BrowserAutomationError(
      `${error.message} Oracle could not prove a complete pre-dispatch cleanup, so the exact tab was retained for recovery.`,
      {
        ...error.details,
        submissionCommitted: false,
        draftRetained: diagnostic.draftRetained !== false,
        retrySafe: false,
        recoverable: true,
        cleanupVerified: false,
      },
      error,
    );
  }

  try {
    if (!(await deps.isSubmissionOwner?.())) {
      throw new Error("submission target ownership changed before cleanup");
    }

    if (!(await matchesExactOwnedPromptComposer(deps.runtime, prompt))) {
      throw new Error("exact owned prompt changed before attachment cleanup");
    }
    if (!(await verifyExactOwnedAttachmentSet(deps.runtime, deps.attachmentNames ?? []))) {
      throw new Error("exact owned attachment set changed before cleanup");
    }
    diagnostic.ownedAttachmentSetVerified = true;

    diagnostic.ownedAttachmentCleanupAttempted = true;
    await clearExactOwnedAttachmentSet(deps.runtime, deps.attachmentNames ?? []);
    diagnostic.ownedAttachmentCleanupSucceeded = true;

    if (!(await deps.isSubmissionOwner?.())) {
      throw new Error("submission target ownership changed during cleanup");
    }

    diagnostic.ownedDraftCleanupAttempted = true;
    const draftCleared = await clearExactOwnedPromptComposer(deps.runtime, prompt);
    if (!draftCleared) {
      throw new Error("exact owned prompt was not present and empty after cleanup");
    }
    diagnostic.ownedDraftCleanupSucceeded = true;
    if (!(await deps.isSubmissionOwner?.())) {
      throw new Error("submission target ownership changed after cleanup");
    }
    if (!(await verifyComposerCleanupComplete(deps.runtime))) {
      throw new Error("composer state changed during final cleanup verification");
    }
    diagnostic.composerCleared = true;
    diagnostic.draftRetained = false;
    diagnostic.retryEligible = true;
    diagnostic.retryBlockedReason = null;
    diagnostic.finalCommitClassification = "safe-pre-dispatch-cleanup";
    return new BrowserAutomationError(
      `${error.message} Oracle verified that no submitting event was emitted and cleared only this attempt's exact prompt and attachments; an explicit new attempt is safe.`,
      {
        ...error.details,
        submissionCommitted: false,
        dispatchAttempted: false,
        potentiallySubmittingEventEmitted: false,
        draftRetained: false,
        retrySafe: true,
        recoverable: false,
        cleanupVerified: true,
      },
      error,
    );
  } catch (cleanupError) {
    diagnostic.retryEligible = false;
    diagnostic.retryBlockedReason = "owned-pre-dispatch-cleanup-unverified";
    return new BrowserAutomationError(
      `${error.message} Oracle could not verify a complete pre-dispatch cleanup, so the exact tab was retained for recovery.`,
      {
        ...error.details,
        submissionCommitted: false,
        draftRetained: diagnostic.draftRetained !== false,
        retrySafe: false,
        recoverable: true,
        cleanupVerified: false,
        cleanupFailure: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      },
      error,
    );
  }
}

async function matchesExactOwnedPromptComposer(
  Runtime: ChromeClient["Runtime"],
  expectedPrompt: string,
): Promise<boolean> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // oracle-owned-draft-cleanup-precheck
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      const normalizeComposer = (value) => String(value ?? '')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/\\u00a0/g, ' ');
      const expected = normalizeComposer(${JSON.stringify(expectedPrompt)});
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const nodes = Array.from(new Set(inputSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)))));
      const active = nodes.find((node) => isVisible(node)) || nodes[0] || null;
      const nonEmptyNodes = nodes.filter((node) =>
        normalizeComposer(readComposerValue(node)).trim().length > 0);
      return {
        matches:
          Boolean(active) &&
          normalizeComposer(readComposerValue(active)) === expected &&
          nonEmptyNodes.length > 0 &&
          nonEmptyNodes.every((node) => normalizeComposer(readComposerValue(node)) === expected),
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value?.matches === true;
}

async function readExactOwnedPromptComposer(
  Runtime: ChromeClient["Runtime"],
): Promise<string | null> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // oracle-owned-draft-read
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      const normalizeComposer = (value) => String(value ?? '')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/\\u00a0/g, ' ');
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const nodes = Array.from(new Set(inputSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)))));
      const active = nodes.find((node) => isVisible(node)) || nodes[0] || null;
      const observed = readComposerValue(active);
      const normalizedObserved = normalizeComposer(observed);
      const nonEmptyNodes = nodes.filter((node) =>
        normalizeComposer(readComposerValue(node)).trim().length > 0);
      return {
        exact:
          Boolean(active) &&
          normalizedObserved.trim().length > 0 &&
          nonEmptyNodes.length > 0 &&
          nonEmptyNodes.every((node) =>
            normalizeComposer(readComposerValue(node)) === normalizedObserved),
        observed,
      };
    })()`,
    returnByValue: true,
  });
  const value = result.result?.value as { exact?: boolean; observed?: string } | undefined;
  return value?.exact === true && typeof value.observed === "string" ? value.observed : null;
}

async function verifyExactOwnedAttachmentSet(
  Runtime: ChromeClient["Runtime"],
  attachmentNames: AttachmentReadyInput[],
): Promise<boolean> {
  if (attachmentNames.length === 0) return false;
  const result = await Runtime.evaluate({
    expression: buildAttachmentReadyExpression(attachmentNames, true),
    returnByValue: true,
  });
  return result.result?.value === true;
}

async function clearExactOwnedAttachmentSet(
  Runtime: ChromeClient["Runtime"],
  attachmentNames: AttachmentReadyInput[],
): Promise<void> {
  if (attachmentNames.length === 0) {
    throw new Error("exact owned attachment set is empty");
  }
  const marker = `oracle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await Runtime.evaluate({
    expression: buildAttachmentReadyExpression(attachmentNames, true, marker),
    returnByValue: true,
  });
  const value = result.result?.value as
    | { exactSetMatched?: boolean; removeClicks?: number }
    | undefined;
  if (value?.exactSetMatched !== true || value.removeClicks !== attachmentNames.length) {
    throw new Error("exact owned attachment snapshot changed before targeted cleanup");
  }

  await delay(OWNED_DRAFT_CLEAR_SETTLE_MS);
  const verification = await Runtime.evaluate({
    expression: `document.querySelectorAll(${JSON.stringify(
      `[data-oracle-owned-attachment-cleanup="${marker}"]`,
    )}).length`,
    returnByValue: true,
  });
  if (verification.result?.value !== 0) {
    throw new Error("targeted attachment controls did not detach after cleanup");
  }
  if (!(await verifyComposerAttachmentSetEmpty(Runtime))) {
    throw new Error("composer attachment set was not empty after targeted cleanup");
  }
}

async function verifyComposerAttachmentSetEmpty(
  Runtime: ChromeClient["Runtime"],
): Promise<boolean> {
  const result = await Runtime.evaluate({
    expression: buildAttachmentReadyExpression([], true),
    returnByValue: true,
  });
  return result.result?.value === true;
}

async function verifyComposerCleanupComplete(Runtime: ChromeClient["Runtime"]): Promise<boolean> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // oracle-owned-draft-cleanup-final-verify
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      const nodes = Array.from(new Set(inputSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)))));
      const attachmentSetEmpty = ${buildAttachmentReadyExpression([], true)};
      return {
        composerFound: nodes.length > 0,
        composerEmpty: nodes.every((node) => String(readComposerValue(node)).trim().length === 0),
        attachmentSetEmpty,
      };
    })()`,
    returnByValue: true,
  });
  return (
    result.result?.value?.composerFound === true &&
    result.result?.value?.composerEmpty === true &&
    result.result?.value?.attachmentSetEmpty === true
  );
}

async function clearExactOwnedPromptComposer(
  Runtime: ChromeClient["Runtime"],
  expectedPrompt: string,
): Promise<boolean> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // oracle-owned-draft-cleanup
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      const normalizeComposer = (value) => String(value ?? '')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/\\u00a0/g, ' ');
      const expected = normalizeComposer(${JSON.stringify(expectedPrompt)});
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const nodes = Array.from(new Set(inputSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)))));
      const active = nodes.find((node) => isVisible(node)) || nodes[0] || null;
      const nonEmptyNodes = nodes.filter((node) =>
        normalizeComposer(readComposerValue(node)).trim().length > 0);
      if (
        !active ||
        normalizeComposer(readComposerValue(active)) !== expected ||
        nonEmptyNodes.length === 0 ||
        nonEmptyNodes.some((node) => normalizeComposer(readComposerValue(node)) !== expected)
      ) {
        return { cleared: false };
      }
      for (const node of nonEmptyNodes) {
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
          node.value = '';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (node instanceof HTMLElement) {
          node.textContent = '';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
        }
      }
      return { cleared: true };
    })()`,
    returnByValue: true,
  });
  if (result.result?.value?.cleared !== true) return false;

  await delay(OWNED_DRAFT_CLEAR_SETTLE_MS);
  const verification = await Runtime.evaluate({
    expression: `(() => {
      // oracle-owned-draft-cleanup-verify
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      const nodes = Array.from(new Set(inputSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)))));
      return {
        composerFound: nodes.length > 0,
        empty: nodes.every((node) => String(readComposerValue(node)).trim().length === 0),
      };
    })()`,
    returnByValue: true,
  });
  return (
    verification.result?.value?.composerFound === true && verification.result?.value?.empty === true
  );
}

async function dispatchEnterKey(
  Input: ChromeClient["Input"],
  onPotentiallySubmittingEvent?: () => Promise<void> | void,
): Promise<void> {
  await onPotentiallySubmittingEvent?.();
  await Input.dispatchKeyEvent({
    type: "keyDown",
    ...ENTER_KEY_EVENT,
    text: ENTER_KEY_TEXT,
    unmodifiedText: ENTER_KEY_TEXT,
  });
  await Input.dispatchKeyEvent({
    type: "keyUp",
    ...ENTER_KEY_EVENT,
  });
}

async function activateExactSubmissionTarget({
  Page,
  isSubmissionOwner,
  diagnostic,
}: {
  Page?: ChromeClient["Page"];
  isSubmissionOwner?: () => Promise<boolean> | boolean;
  diagnostic: SubmissionDiagnostic;
}): Promise<void> {
  if (!Page || typeof Page.bringToFront !== "function") return;
  diagnostic.targetActivationAttempted = true;

  const ownershipCode = "ownership-changed-before-send";
  const verifyOwner = async (): Promise<boolean> => {
    if (typeof isSubmissionOwner !== "function") return false;
    try {
      return (await isSubmissionOwner()) === true;
    } catch {
      return false;
    }
  };
  if (!(await verifyOwner())) {
    diagnostic.ownershipVerified = false;
    throw new BrowserAutomationError(
      "The exact Oracle-owned browser target could not be verified before dispatch.",
      {
        stage: "submit-prompt",
        code: ownershipCode,
        submissionCommitted: false,
        draftRetained: true,
      },
    );
  }
  diagnostic.ownershipVerified = true;

  try {
    await Page.bringToFront();
  } catch (error) {
    throw new BrowserAutomationError(
      "The exact Oracle-owned browser target could not be activated before dispatch.",
      {
        stage: "submit-prompt",
        code: "target-activation-failed",
        submissionCommitted: false,
        draftRetained: true,
      },
      error,
    );
  }
  await delay(TARGET_COMPOSITING_SETTLE_MS);

  if (!(await verifyOwner())) {
    diagnostic.ownershipVerified = false;
    throw new BrowserAutomationError(
      "The exact Oracle-owned browser target changed during activation; refusing to dispatch.",
      {
        stage: "submit-prompt",
        code: ownershipCode,
        submissionCommitted: false,
        draftRetained: true,
      },
    );
  }
  diagnostic.ownershipVerified = true;
  diagnostic.targetActivationVerified = true;
}

export async function clearPromptComposer(Runtime: ChromeClient["Runtime"], logger: BrowserLogger) {
  const primarySelectorLiteral = JSON.stringify(PROMPT_PRIMARY_SELECTOR);
  const fallbackSelectorLiteral = JSON.stringify(PROMPT_FALLBACK_SELECTOR);
  const inputSelectorsLiteral = JSON.stringify(INPUT_SELECTORS);
  const result = await Runtime.evaluate({
    expression: `(() => {
      const SELECTORS = ${inputSelectorsLiteral};
      const fallback = document.querySelector(${fallbackSelectorLiteral});
      const editor = document.querySelector(${primarySelectorLiteral});
      const readValue = (node) => {
        if (!node) return '';
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value ?? '';
        return node.innerText ?? node.textContent ?? '';
      };
      const dispatchClearEvents = (node) => {
        try {
          node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: null, inputType: 'deleteContentBackward' }));
        } catch {}
        try {
          node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteByCut' }));
        } catch {
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const clearEditable = (node) => {
        if (!node) return false;
        try {
          node.focus?.();
        } catch {}
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
          node.value = '';
          dispatchClearEvents(node);
          return true;
        }
        if (node.isContentEditable || node.getAttribute('contenteditable') === 'true') {
          try {
            const selection = node.ownerDocument?.getSelection?.();
            const range = node.ownerDocument?.createRange?.();
            if (selection && range) {
              range.selectNodeContents(node);
              selection.removeAllRanges();
              selection.addRange(range);
              node.ownerDocument?.execCommand?.('delete', false);
            }
          } catch {}
          node.textContent = '';
          dispatchClearEvents(node);
          return true;
        }
        return false;
      };
      let cleared = false;
      const nodes = SELECTORS
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      for (const node of Array.from(new Set([fallback, editor, ...nodes])).filter(Boolean)) {
        cleared = clearEditable(node) || cleared;
      }
      const remaining = Array.from(new Set([fallback, editor, ...nodes]))
        .filter(Boolean)
        .map((node) => readValue(node).trim())
        .filter(Boolean);
      return { cleared, remaining };
    })()`,
    returnByValue: true,
  });
  const value = result.result?.value as { cleared?: boolean; remaining?: string[] } | undefined;
  if (!value?.cleared || (value.remaining?.length ?? 0) > 0) {
    await logDomFailure(Runtime, logger, "clear-composer");
    throw new Error("Failed to clear prompt composer");
  }
  await delay(250);
}

async function waitForDomReady(
  Runtime: ChromeClient["Runtime"],
  logger?: BrowserLogger,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({
      expression: `(() => {
        const ready = document.readyState === 'complete';
        const composer = document.querySelector('[data-testid*="composer"]') || document.querySelector('form');
        const fileInput = document.querySelector('input[type="file"]');
        return { ready, composer: Boolean(composer), fileInput: Boolean(fileInput) };
      })()`,
      returnByValue: true,
    });
    const value = result?.value as
      | { ready?: boolean; composer?: boolean; fileInput?: boolean }
      | undefined;
    if (value?.ready && value.composer) {
      return;
    }
    await delay(150);
  }
  logger?.(`Page did not reach ready/composer state within ${timeoutMs}ms; continuing cautiously.`);
}

function buildAttachmentReadyExpression(
  attachmentNames: AttachmentReadyInput[],
  requireExactSet = false,
  cleanupMarker?: string,
): string {
  const attachmentExpectations = attachmentNames.map((attachment) => {
    const name = typeof attachment === "string" ? attachment : attachment.name;
    const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
    return {
      name: normalized,
      stem: normalized.replace(/\.[a-z0-9]{1,10}$/i, ""),
      extension: normalized.match(/(\.[a-z0-9]{1,10})$/i)?.[1] ?? "",
      generatedBundle: typeof attachment === "object" && attachment.generatedBundle === true,
    };
  });
  const namesLiteral = JSON.stringify(attachmentExpectations);
  return `(() => {
    const expected = ${namesLiteral};
    const requireExactSet = ${JSON.stringify(requireExactSet)};
    const cleanupMode = ${JSON.stringify(Boolean(cleanupMarker))};
    const cleanupMarker = ${JSON.stringify(cleanupMarker ?? null)};
    const sendSelectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
    const normalize = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const hasNameBoundary = (text, name) => {
      if (!name) return false;
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(name, from);
        if (index === -1) return false;
        const previous = text[index - 1] || '';
        const next = text[index + name.length] || '';
        const previousOk = !previous || !/[a-z0-9._-]/.test(previous);
        const nextOk = !next || !/[a-z0-9._-]/.test(next);
        if (previousOk && nextOk) return true;
        from = index + name.length;
      }
      return false;
    };
    const hasStemFileBoundary = (text, stem) => {
      if (!stem) return false;
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(stem, from);
        if (index === -1) return false;
        const previous = text[index - 1] || '';
        const next = text[index + stem.length] || '';
        const previousOk = !previous || !/[a-z0-9._-]/.test(previous);
        const nextOk = !next || !/[a-z0-9._-]/.test(next);
        if (previousOk && nextOk) return true;
        from = index + stem.length;
      }
      return false;
    };
    const hasBareStemBoundary = (text, stem) => {
      if (!stem) return false;
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(stem, from);
        if (index === -1) return false;
        const previous = text[index - 1] || '';
        const next = text[index + stem.length] || '';
        const previousOk = !previous || !/[a-z0-9._-]/.test(previous);
        const nextOk = !next || !/[a-z0-9._(-]/.test(next);
        if (previousOk && nextOk) return true;
        from = index + stem.length;
      }
      return false;
    };
    const hasExtensionBoundary = (text, extension) => {
      if (!extension) return false;
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(extension, from);
        if (index === -1) return false;
        const next = text[index + extension.length] || '';
        if (!next || !/[a-z0-9]/.test(next)) return true;
        from = index + extension.length;
      }
      return false;
    };
    const matchesExpected = (value, item) => {
      const text = normalize(value);
      if (!text) return false;
      if (hasNameBoundary(text, item.name)) return true;
      if (item.generatedBundle && hasBareStemBoundary(text, item.stem)) return true;
      if (
        item.stem &&
        item.stem.length >= 4 &&
        item.extension &&
        text.includes(item.stem + '(') &&
        hasExtensionBoundary(text, item.extension)
      ) {
        return true;
      }
      if (text.includes('…') || text.includes('...')) {
        const marker = text.includes('…') ? '…' : '...';
        const [prefixRaw, suffixRaw] = text.split(marker);
        const prefix = normalize(prefixRaw);
        const suffix = normalize(suffixRaw);
        const prefixParts = prefix.split(' ').filter(Boolean);
        const suffixParts = suffix.split(' ').filter(Boolean);
        const prefixCandidates = prefixParts.map((_, index) => prefixParts.slice(index).join(' '));
        const suffixCandidates = suffixParts.map((_, index) =>
          suffixParts.slice(0, suffixParts.length - index).join(' '),
        );
        if (prefixCandidates.length === 0 || suffixCandidates.length === 0) return false;
        const targets = [item.name, item.stem && item.stem.length >= 4 ? item.stem : ''].filter(Boolean);
        return targets.some((target) => {
          return prefixCandidates.some((prefixPart) =>
            suffixCandidates.some((suffixPart) => {
              const strongEnough =
                suffixPart.length >= 2 &&
                (prefixPart.length >= 3 || (prefixPart.length >= 2 && suffixPart.length >= 4));
              return strongEnough && target.startsWith(prefixPart) && target.endsWith(suffixPart);
            }),
          );
        });
      }
      return false;
    };
    // Restrict to attachment affordances; never scan generic div/span nodes (prompt text can contain the file name).
    const attachmentSelectors = [
      // Current ChatGPT file tiles expose the filename through a role-group aria label.
      '[role="group"][aria-label]',
      '[data-testid*="chip"]',
      '[data-testid*="attachment"]',
      '[data-testid*="upload"]',
      '[data-testid*="file"]',
      '[aria-label*="Remove file"]',
      'button[aria-label*="Remove file"]',
      '[aria-label*="remove file"]',
      'button[aria-label*="remove file"]',
      '[aria-label*="Remove attachment"]',
      'button[aria-label*="Remove attachment"]',
      '[aria-label*="remove attachment"]',
      'button[aria-label*="remove attachment"]',
    ];
    const sendButton = sendSelectors
      .map((selector) => document.querySelector(selector))
      .find(Boolean);
    const isUsableComposerRoot = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (String(node.tagName || '').toLowerCase() === 'button') return false;
      const testId = String(node.getAttribute?.('data-testid') || '').toLowerCase();
      if (!testId.includes('composer')) return false;
      return !(
        testId.includes('footer') ||
        testId.includes('action') ||
        testId.includes('plus') ||
        testId.includes('send')
      );
    };
    const closestComposerRoot = (node) => {
      let current = node instanceof HTMLElement ? node : null;
      while (current) {
        if (isUsableComposerRoot(current)) return current;
        current = current.parentElement;
      }
      return null;
    };
    const firstComposerRoot = () =>
      Array.from(document.querySelectorAll('[data-testid*="composer"]')).find(isUsableComposerRoot) || null;
    const composer =
      closestComposerRoot(sendButton) ||
      sendButton?.closest?.('form') ||
      firstComposerRoot() ||
      document.querySelector('form') ||
      document.body ||
      document;
    // Walk node + ancestors (up to grandparent) + descendants to gather every textual hint.
    // ChatGPT's current chip DOM nests the filename inside truncated child spans, so checking
    // only the node's own textContent/aria/title misses the match.
    const collectOwnLabelHaystack = (node) => {
      if (!node) return '';
      const pieces = [];
      const pushAttrs = (el) => {
        if (!el || typeof el.getAttribute !== 'function') return;
        for (const attr of ['aria-label', 'title', 'data-testid', 'data-tooltip', 'data-tooltip-content']) {
          const v = el.getAttribute(attr);
          if (v) pieces.push(v);
        }
      };
      const pushText = (el) => {
        if (!el) return;
        const text = (el.innerText ?? el.textContent ?? '').trim();
        if (text) pieces.push(text);
      };
      pushAttrs(node);
      pushText(node);
      return pieces.join(' ').toLowerCase();
    };
    const collectLabelHaystack = (node) => {
      if (!node) return '';
      const pieces = [collectOwnLabelHaystack(node)];
      const push = (el) => {
        const text = collectOwnLabelHaystack(el);
        if (text) pieces.push(text);
      };
      const parent = node.parentElement;
      push(parent);
      const grandparent = parent?.parentElement;
      push(grandparent);
      return pieces.join(' ').toLowerCase();
    };
    const attachmentRoots = Array.from(new Set([composer])).filter(Boolean);
    const collectChipNodes = () => {
      const seen = new Set();
      const collected = [];
      for (const root of attachmentRoots) {
        for (const node of Array.from(root.querySelectorAll(attachmentSelectors.join(',')))) {
          if (!(node instanceof HTMLElement)) continue;
          // Skip elements clearly inside the editable input (composer textarea may contain
          // filename text in the user's prompt — avoid mistaking that for a chip).
          if (node.closest('textarea,[contenteditable="true"]')) continue;
          if (seen.has(node)) continue;
          seen.add(node);
          collected.push(node);
        }
      }
      return collected;
    };
    const chipNodes = collectChipNodes();
    const chipLabels = chipNodes.map((node) => collectLabelHaystack(node));
    const chipOwnLabels = chipNodes.map((node) => collectOwnLabelHaystack(node));
    const hasEllipsisSuffix = (label) => {
      const marker = label.includes('…') ? '…' : label.includes('...') ? '...' : '';
      if (!marker) return false;
      return normalize(label.split(marker)[1] || '').length > 0;
    };
    const chipOwnLabelsWithVisibleNames = chipOwnLabels.filter((label) =>
      /\\.[a-z][a-z0-9]{0,9}(?:\\b|$)/i.test(label) ||
      hasEllipsisSuffix(label),
    );
    const visibleExtensionLabelsMatchExpected = chipOwnLabelsWithVisibleNames.every((label) =>
      expected.some((item) => matchesExpected(label, item)),
    );
    const visibleStemOnlyMismatch = chipOwnLabels.some((label) =>
      expected.some(
        (item) =>
          !item.generatedBundle &&
          item.stem &&
          hasStemFileBoundary(label, item.stem) &&
          !matchesExpected(label, item),
      ),
    );

    const chipsReady = (() => {
      const used = new Set();
      return expected.every((item) => {
        const index = chipLabels.findIndex((label, candidateIndex) =>
          !used.has(candidateIndex) && matchesExpected(label, item),
        );
        if (index === -1) return false;
        used.add(index);
        return true;
      });
    })();
    const inputsReady = expected.every((item) =>
      attachmentRoots.some((root) =>
        Array.from(root.querySelectorAll('input[type="file"]')).some((el) =>
          Array.from((el instanceof HTMLInputElement ? el.files : []) || []).some((file) =>
            matchesExpected(file?.name, item),
          ),
        ),
      ),
    );
    // Count-based fallback: if we cannot match names individually (ChatGPT may strip
    // the filename out of attribute-readable text into a deeply nested span), but we
    // do see at least as many distinct "Remove" affordances as attachments we
    // uploaded, trust the upload without double-counting nested chip/remove nodes.
    const removeAffordances = [];
    const removeSeen = new Set();
    for (const root of attachmentRoots) {
      for (const node of Array.from(root.querySelectorAll(
        '[aria-label*="Remove" i], [aria-label*="remove" i], button[aria-label*="Remove" i], button[aria-label*="remove" i]',
      ))) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.closest('textarea,[contenteditable="true"]')) continue;
        const aria = (node.getAttribute?.('aria-label') ?? '').toLowerCase();
        const fileSpecific = aria.includes('remove file') || aria.includes('remove attachment');
        const attachmentOwner = node.closest(
          '[data-testid*="chip"], [data-testid*="attachment"], [data-testid*="upload"], [data-testid*="file"]',
        );
        if (!fileSpecific && !attachmentOwner) continue;
        if (removeSeen.has(node)) continue;
        removeSeen.add(node);
        removeAffordances.push(node);
      }
    }
    const countReady =
      !visibleStemOnlyMismatch &&
      visibleExtensionLabelsMatchExpected &&
      removeAffordances.length >= expected.length;

    const exactDistinctIndexes = (labels) => {
      if (labels.length !== expected.length) return null;
      const used = new Set();
      const indexes = [];
      for (const item of expected) {
        const index = labels.findIndex((label, candidateIndex) =>
          !used.has(candidateIndex) && matchesExpected(label, item),
        );
        if (index === -1) return null;
        used.add(index);
        indexes.push(index);
      }
      return indexes;
    };
    const removeLabels = removeAffordances.map((node) => collectLabelHaystack(node));
    const fileInputs = Array.from(new Set(attachmentRoots.flatMap((root) =>
      Array.from(root.querySelectorAll('input[type="file"]')),
    ))).filter((input) => input instanceof HTMLInputElement);
    const readInputNames = (input) =>
      Array.from(input.files || []).map((file) => normalize(file?.name));
    const inputNames = fileInputs.flatMap(readInputNames);
    const exactRemoveIndexes = exactDistinctIndexes(removeLabels);
    const exactInputIndexes = exactDistinctIndexes(inputNames);
    const exactSetReady = expected.length === 0
      ? exactRemoveIndexes !== null && exactInputIndexes !== null
      : exactRemoveIndexes !== null || exactInputIndexes !== null;

    if (cleanupMode) {
      if (!(chipsReady || inputsReady || countReady) || exactRemoveIndexes === null) {
        return { exactSetMatched: false, removeClicks: 0 };
      }
      const capturedButtons = exactRemoveIndexes.map((index) => removeAffordances[index]);
      const capturedInputs = exactInputIndexes === null
        ? []
        : fileInputs
            .map((input) => ({ input, signature: readInputNames(input).sort().join('\0') }))
            .filter(({ signature }) => Boolean(signature));
      for (const button of capturedButtons) {
        button.setAttribute('data-oracle-owned-attachment-cleanup', cleanupMarker);
      }
      for (const button of capturedButtons) {
        try {
          if (button instanceof HTMLButtonElement) button.type = 'button';
          button.click();
        } catch {}
      }
      // ChatGPT can detach the owned attachment chip while leaving the selected
      // FileList on its hidden input. Clear only an input set that independently
      // matches this attempt exactly, otherwise the stale DOM value makes a
      // successful targeted removal look incomplete and strands the owned draft.
      for (const { input, signature } of capturedInputs) {
        const currentSignature = readInputNames(input).sort().join('\0');
        if (!currentSignature || currentSignature !== signature) continue;
        try {
          input.value = '';
        } catch {}
      }
      return { exactSetMatched: true, removeClicks: capturedButtons.length };
    }

    return (chipsReady || inputsReady || countReady) && (!requireExactSet || exactSetReady);
  })()`;
}

export function buildAttachmentReadyExpressionForTest(
  attachmentNames: AttachmentReadyInput[],
  requireExactSet = false,
  cleanupMarker?: string,
) {
  return buildAttachmentReadyExpression(attachmentNames, requireExactSet, cleanupMarker);
}

async function attemptSendButton(
  Runtime: ChromeClient["Runtime"],
  Input: ChromeClient["Input"],
  _logger?: BrowserLogger,
  attachmentNames?: AttachmentReadyInput[],
  attachmentTimeoutMs?: number | null,
  expectedPrompt?: string,
  onPotentiallySubmittingEvent?: () => Promise<void> | void,
  persistDispatchIntent?: () => Promise<void> | void,
  revalidateAfterDispatchIntent?: () => Promise<void> | void,
  composerBindingKey?: string | null,
): Promise<boolean> {
  const needAttachment = Array.isArray(attachmentNames) && attachmentNames.length > 0;
  const expectedPromptLiteral = JSON.stringify(expectedPrompt ?? null);
  const script = `(() => {
    ${buildClickDispatcher()}
    const selectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
    const expectedPrompt = ${expectedPromptLiteral};
    const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
    ${COMPOSER_VALUE_READER_SOURCE}
    const normalizeComposer = (value) => String(value ?? '')
      .replace(/\\r\\n?/g, '\\n')
      .replace(/\\u00a0/g, ' ');
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const isEnabled = (node) => {
      const ariaDisabled = node.getAttribute('aria-disabled');
      const dataDisabled = node.getAttribute('data-disabled');
      const style = window.getComputedStyle(node);
      return !(
        node.hasAttribute('disabled') ||
        ariaDisabled === 'true' ||
        dataDisabled === 'true' ||
        style.pointerEvents === 'none' ||
        style.display === 'none'
      );
    };
    if (expectedPrompt !== null) {
      ${buildComposerBindingResolverSource(composerBindingKey ?? null)}
      const inputs = inputSelectors
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      const active = inputs.find((node) => isVisible(node)) || inputs[0] || null;
      // With an attempt binding the identity decision comes from the exact node
      // Oracle typed into; a detached or replaced node reads empty and fails
      // closed. Only the legacy inner caller without a binding keeps the
      // first-visible read.
      const observed = readComposerValue(
        composerBindingKey ? boundComposerNode : active,
      );
      if (normalizeComposer(observed) !== normalizeComposer(expectedPrompt)) {
        return { status: 'mutated', observedLength: observed.length };
      }
    }
    const candidates = [];
    for (const selector of selectors) {
      candidates.push(...Array.from(document.querySelectorAll(selector)));
    }
    const button = candidates.find((node) => isVisible(node) && isEnabled(node)) || null;
    if (!button) return { status: 'missing' };
    const rect = button.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : 0;
      const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      const outsideViewport =
        viewportWidth > 0 && viewportHeight > 0 &&
        (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight);
      const canHitTest = typeof document.elementFromPoint === 'function';
      const hit = outsideViewport || !canHitTest ? null : document.elementFromPoint(x, y);
      if (
        outsideViewport ||
        !canHitTest ||
        !hit ||
        (hit !== button && !button.contains?.(hit))
      ) {
        button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        return { status: 'settling' };
      }
      return { status: 'point', x, y };
    }
    return { status: 'settling' };
  })()`;

  // Give attachment-bearing submissions more headroom. ChatGPT's chip render can
  // settle slowly for multi-file uploads, but plain text sends should keep the
  // shorter historical deadline.
  const timeoutMs = sendButtonTimeoutMs(attachmentNames, attachmentTimeoutMs);
  type SendButtonProbe = {
    status?: "missing" | "mutated" | "point" | "settling" | "attachments-not-ready";
    x?: number;
    y?: number;
    observedLength?: number;
  };
  const readSendButtonProbe = async (): Promise<SendButtonProbe> => {
    if (needAttachment) {
      const ready = await Runtime.evaluate({
        expression: buildAttachmentReadyExpression(attachmentNames, true),
        returnByValue: true,
      });
      if (!ready?.result?.value) {
        return { status: "attachments-not-ready" };
      }
    }
    const { result } = await Runtime.evaluate({ expression: script, returnByValue: true });
    const value = result.value as
      | {
          status?: "missing" | "mutated" | "point" | "settling";
          x?: number;
          y?: number;
          observedLength?: number;
        }
      | string
      | undefined;
    const status = (typeof value === "string" ? value : value?.status) as SendButtonProbe["status"];
    if (status === "mutated") {
      throwComposerMutationError(
        expectedPrompt ?? "",
        typeof value === "object" && typeof value.observedLength === "number"
          ? value.observedLength
          : 0,
      );
    }
    return typeof value === "object" && value !== null ? value : { status };
  };

  const deadline = Date.now() + timeoutMs;
  let dispatchIntentPrepared = false;
  while (Date.now() < deadline) {
    let value = await readSendButtonProbe();
    let status = value.status;
    if (status === "attachments-not-ready") {
      await delay(150);
      continue;
    }
    if (status === "point" && typeof value.x === "number" && typeof value.y === "number") {
      if (persistDispatchIntent || revalidateAfterDispatchIntent) {
        if (!dispatchIntentPrepared) {
          await persistDispatchIntent?.();
          dispatchIntentPrepared = true;
        }
        await revalidateAfterDispatchIntent?.();
        value = await readSendButtonProbe();
        status = value.status;
        if (status === "attachments-not-ready" || status === "settling") {
          await delay(TARGET_COMPOSITING_SETTLE_MS);
          continue;
        }
        if (status === "missing") {
          if (needAttachment) {
            await delay(150);
            continue;
          }
          break;
        }
        if (status !== "point" || typeof value.x !== "number" || typeof value.y !== "number") {
          await delay(100);
          continue;
        }
      }
      if (!Input || typeof Input.dispatchMouseEvent !== "function") break;
      await Input.dispatchMouseEvent({ type: "mouseMoved", x: value.x, y: value.y });
      await revalidateAfterDispatchIntent?.();
      value = await readSendButtonProbe();
      status = value.status;
      if (status === "attachments-not-ready" || status === "settling") {
        await delay(TARGET_COMPOSITING_SETTLE_MS);
        continue;
      }
      if (status === "missing") {
        if (needAttachment) {
          await delay(150);
          continue;
        }
        break;
      }
      if (status !== "point" || typeof value.x !== "number" || typeof value.y !== "number") {
        await delay(100);
        continue;
      }
      if (await clickTrustedPoint(Input, value.x, value.y, onPotentiallySubmittingEvent)) {
        return true;
      }
      break;
    }
    if (status === "missing") {
      if (needAttachment) {
        await delay(150);
        continue;
      }
      break;
    }
    await delay(status === "settling" ? TARGET_COMPOSITING_SETTLE_MS : 100);
  }
  if (Array.isArray(attachmentNames) && attachmentNames.length > 0) {
    throw new BrowserAutomationError(
      `Attachments never reached a clickable send button after ${Math.ceil(
        timeoutMs / 1000,
      )}s; tune --browser-attachment-timeout.`,
      {
        stage: "submit-prompt",
        code: "attachment-send-not-ready",
        attachmentNames,
        timeoutMs,
      },
    );
  }
  return false;
}

async function assertComposerUnchanged(
  Runtime: ChromeClient["Runtime"],
  expectedPrompt: string,
  composerBindingKey?: string | null,
): Promise<void> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // oracle-composer-unchanged-check
      const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
      ${COMPOSER_VALUE_READER_SOURCE}
      ${buildComposerBindingResolverSource(composerBindingKey ?? null)}
      const isVisible = (node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const normalizeComposer = (value) => String(value ?? '')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/\\u00a0/g, ' ');
      const inputs = inputSelectors
        .map((selector) => document.querySelector(selector))
        .filter((node) => Boolean(node));
      const active = inputs.find((node) => isVisible(node)) || inputs[0] || null;
      const observed = readComposerValue(
        composerBindingKey ? boundComposerNode : active,
      );
      return {
        unchanged: normalizeComposer(observed) === normalizeComposer(${JSON.stringify(expectedPrompt)}),
        observedLength: observed.length,
      };
    })()`,
    returnByValue: true,
  });
  const value = result.result?.value as
    | { unchanged?: boolean; observedLength?: number }
    | undefined;
  if (!value?.unchanged) {
    throwComposerMutationError(expectedPrompt, value?.observedLength ?? 0);
  }
}

function throwComposerMutationError(expectedPrompt: string, observedLength: number): never {
  throw new BrowserAutomationError(
    "Prompt composer changed after Oracle populated it; refusing to send.",
    {
      stage: "submit-prompt",
      code: "composer-mutated-before-send",
      submissionCommitted: false,
      draftRetained: observedLength > 0,
      expectedLength: expectedPrompt.length,
      observedLength,
    },
  );
}

async function clickTrustedPoint(
  Input: ChromeClient["Input"],
  x: number,
  y: number,
  onPotentiallySubmittingEvent?: () => Promise<void> | void,
): Promise<boolean> {
  if (!Input || typeof Input.dispatchMouseEvent !== "function") return false;
  await onPotentiallySubmittingEvent?.();
  await Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return true;
}

function sendButtonTimeoutMs(
  attachmentNames?: AttachmentReadyInput[],
  attachmentTimeoutMs?: number | null,
): number {
  if (!Array.isArray(attachmentNames) || attachmentNames.length === 0) {
    return 20_000;
  }
  return typeof attachmentTimeoutMs === "number" && Number.isFinite(attachmentTimeoutMs)
    ? Math.max(1_000, attachmentTimeoutMs)
    : 45_000;
}

function buildIndeterminateCommitError({
  prompt,
  diagnostic,
  timeoutMs,
  probe,
  cause,
}: {
  prompt: string;
  diagnostic: SubmissionDiagnostic;
  timeoutMs?: number;
  probe?: CommitProbeState;
  cause?: unknown;
}): BrowserAutomationError {
  const draftRetained = probe?.composerCleared === false || diagnostic.draftRetained === true;
  return new BrowserAutomationError(
    "Oracle emitted one potentially submitting input event but could not verify the exact committed user turn. The exact tab remains recoverable and automatic redispatch is disabled.",
    {
      stage: "submit-prompt",
      code: "commit-indeterminate-after-dispatch",
      outcome: "indeterminate",
      submissionCommitted: false,
      commitVerification: "indeterminate",
      dispatchAttempted: true,
      potentiallySubmittingEventEmitted: true,
      potentiallySubmittingEvent: diagnostic.potentiallySubmittingEvent,
      retrySafe: false,
      recoverable: true,
      draftRetained,
      promptLength: prompt.trim().length,
      timeoutMs,
      commitProbe: probe ? summarizeCommitProbe(probe) : undefined,
    },
    cause,
  );
}

async function verifyPromptCommitted(
  Runtime: ChromeClient["Runtime"],
  prompt: string,
  timeoutMs: number,
  logger?: BrowserLogger,
  baselineTurns?: number,
  onCommitPending?: () => Promise<void> | void,
  diagnostic: SubmissionDiagnostic = createSubmissionDiagnostic(baselineTurns),
): Promise<{ turnsCount: number | null; userTurnIndex: number | null }> {
  const deadline = Date.now() + timeoutMs;
  const encodedPrompt = JSON.stringify(prompt.trim());
  const primarySelectorLiteral = JSON.stringify(PROMPT_PRIMARY_SELECTOR);
  const fallbackSelectorLiteral = JSON.stringify(PROMPT_FALLBACK_SELECTOR);
  const inputSelectorsLiteral = JSON.stringify(INPUT_SELECTORS);
  const stopSelectorLiteral = JSON.stringify(STOP_BUTTON_SELECTOR);
  const assistantSelectorLiteral = JSON.stringify(ASSISTANT_ROLE_SELECTOR);
  let baseline: number | null =
    typeof baselineTurns === "number" && Number.isFinite(baselineTurns) && baselineTurns >= 0
      ? Math.floor(baselineTurns)
      : null;
  if (baseline === null) {
    try {
      const { result } = await Runtime.evaluate({
        expression: buildConversationTurnCountExpression(),
        returnByValue: true,
      });
      const raw = typeof result?.value === "number" ? result.value : Number(result?.value);
      if (Number.isFinite(raw)) {
        baseline = Math.max(0, Math.floor(raw));
      }
    } catch {
      // ignore; baseline stays unknown
    }
  }
  const baselineLiteral = baseline ?? -1;
  // Read the semantic user-message node so attachment labels and turn controls
  // do not contaminate the prompt identity check. Exact identity prevents a
  // prompt plus stray operator keystrokes from being accepted as committed.
  const script = `(() => {
		    const editor = document.querySelector(${primarySelectorLiteral});
		    const fallback = document.querySelector(${fallbackSelectorLiteral});
		    const inputSelectors = ${inputSelectorsLiteral};
	    const normalize = (value) => {
	      let text = value?.toLowerCase?.() ?? '';
	      // Strip markdown *markers* but keep content (ChatGPT renders fence markers differently).
	      text = text.replace(/\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\`/g, ' $1 ');
	      text = text.replace(/\`\`\`/g, ' ');
	      text = text.replace(/\`([^\`]*)\`/g, '$1');
	      return text.replace(/\\s+/g, ' ').trim();
		    };
		    const normalizedPrompt = normalize(${encodedPrompt});
		    const articles = ${buildConversationTurnListExpression()};
		    const normalizedTurns = articles.map((node) => normalize(node?.innerText));
		    const userTurns = articles.map((node, index) => {
		      const role = String(
		        node?.getAttribute?.('data-message-author-role') ||
		        node?.getAttribute?.('data-turn') ||
		        node?.dataset?.turn ||
		        '',
		      ).toLowerCase();
		      const isUser = role === 'user' || Boolean(
		        node?.querySelector?.('[data-message-author-role="user"], [data-turn="user"]'),
		      );
		      if (!isUser) return null;
		      const roleNode = role === 'user'
		        ? node
		        : node?.querySelector?.('[data-message-author-role="user"], [data-turn="user"]');
		      const messageNode = roleNode?.querySelector?.('.whitespace-pre-wrap') || roleNode;
		      return {
		        index,
		        text: normalize(messageNode?.innerText || messageNode?.textContent || ''),
		      };
		    }).filter((entry) => entry && entry.text);
		    const userTurnTexts = userTurns.map((entry) => entry.text);
	    const readValue = (node) => {
	      if (!node) return '';
	      if (node instanceof HTMLTextAreaElement) return node.value ?? '';
	      return node.innerText ?? '';
	    };
	    const isVisible = (node) => {
	      if (!node || typeof node.getBoundingClientRect !== 'function') return false;
	      const rect = node.getBoundingClientRect();
	      return rect.width > 0 && rect.height > 0;
	    };
	    const inputs = inputSelectors
	      .map((selector) => document.querySelector(selector))
	      .filter((node) => Boolean(node));
	    const visibleInputs = inputs.filter((node) => isVisible(node));
	    const activeInputs = visibleInputs.length > 0 ? visibleInputs : inputs;
		    const userMatched =
		      normalizedPrompt.length > 0 && userTurnTexts.some((text) => text === normalizedPrompt);
		    const matchedUserTurn = [...userTurns]
		      .reverse()
		      .find((entry) => entry.text === normalizedPrompt) || null;
			    const lastTurn = userTurnTexts[userTurnTexts.length - 1] ?? '';
			    const lastMatched =
			      normalizedPrompt.length > 0 && lastTurn === normalizedPrompt;
		    const baseline = ${baselineLiteral};
		    const hasNewTurn = baseline < 0 ? false : normalizedTurns.length > baseline;
		    const newUserTurns = baseline < 0
		      ? []
		      : userTurns.filter((entry) => entry.index >= baseline);
		    const matchingNewUserTurns = newUserTurns.filter(
		      (entry) => entry.text === normalizedPrompt,
		    );
		    const stopVisible = Boolean(document.querySelector(${stopSelectorLiteral}));
        const assistantVisible = baseline < 0
          ? false
          : articles.slice(baseline).some((node) => {
              const role = String(
                node?.getAttribute?.('data-message-author-role') ||
                node?.getAttribute?.('data-turn') ||
                node?.dataset?.turn ||
                '',
              ).toLowerCase();
              return role === 'assistant' || Boolean(
                node?.querySelector?.(${assistantSelectorLiteral}) ||
                node?.querySelector?.('[data-testid*="assistant"]'),
              );
            });
	    // Learned: composer clearing + stop button or assistant presence is a reliable fallback signal.
      const editorValue = editor?.innerText ?? '';
      const fallbackValue = fallback?.value ?? '';
      const activeEmpty =
        activeInputs.length === 0 ? null : activeInputs.every((node) => !String(readValue(node)).trim());
      const composerCleared = activeEmpty ?? !(String(editorValue).trim() || String(fallbackValue).trim());
      const href = typeof location === 'object' && location.href ? location.href : '';
      const inConversation = /\\/c\\//.test(href);
		    return {
        baseline,
	      userMatched,
	      newUserTurnCount: newUserTurns.length,
	      matchingUserTurnCount: matchingNewUserTurns.length,
	      matchedUserTurnIndex: matchedUserTurn?.index ?? null,
	      lastMatched,
	      lastUserTurnAvailable: userTurnTexts.length > 0,
	      hasNewTurn,
      stopVisible,
      assistantVisible,
      composerCleared,
      inConversation,
      href,
      fallbackValue,
      editorValue,
      lastTurn,
      turnsCount: normalizedTurns.length,
    };
  })()`;

  let lastProbe: CommitProbeState | undefined;
  let nextPendingCheckAt = 0;
  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({ expression: script, returnByValue: true });
    const info = result.value as CommitProbeState | undefined;
    if (info && typeof info === "object") {
      lastProbe = info;
      updateSubmissionDiagnosticFromProbe(diagnostic, info);
    }
    const turnsCount = (result.value as { turnsCount?: number } | undefined)?.turnsCount;
    const matchesPrompt = Boolean(info?.lastMatched);
    const newUserTurnCount =
      typeof info?.newUserTurnCount === "number"
        ? info.newUserTurnCount
        : matchesPrompt && info?.hasNewTurn
          ? 1
          : 0;
    const matchingUserTurnCount =
      typeof info?.matchingUserTurnCount === "number"
        ? info.matchingUserTurnCount
        : matchesPrompt && info?.hasNewTurn
          ? 1
          : 0;
    if (info && (newUserTurnCount > 1 || matchingUserTurnCount > 1)) {
      diagnostic.finalCommitClassification = "ambiguous-multiple-user-turns";
      throw new BrowserAutomationError(
        "More than one new user turn appeared after dispatch; Oracle cannot certify an exactly-once submission.",
        {
          stage: "submit-prompt",
          code: "commit-ambiguous-multiple-user-turns",
          outcome: "indeterminate",
          submissionCommitted: false,
          commitVerification: "indeterminate",
          dispatchAttempted: diagnostic.potentiallySubmittingEventEmitted,
          retrySafe: false,
          recoverable: true,
          draftRetained: info?.composerCleared === false,
          commitProbe: summarizeCommitProbe(info),
        },
      );
    }
    if (
      matchesPrompt &&
      info?.hasNewTurn &&
      newUserTurnCount === 1 &&
      matchingUserTurnCount === 1
    ) {
      const userTurnIndex = info?.matchedUserTurnIndex;
      diagnostic.finalCommitClassification = "verified-single-user-turn";
      return {
        turnsCount:
          typeof turnsCount === "number" && Number.isFinite(turnsCount) ? turnsCount : null,
        userTurnIndex:
          typeof userTurnIndex === "number" && Number.isSafeInteger(userTurnIndex)
            ? userTurnIndex
            : null,
      };
    }
    if (onCommitPending && Date.now() >= nextPendingCheckAt) {
      nextPendingCheckAt = Date.now() + 500;
      await onCommitPending();
    }
    await delay(100);
  }
  await onCommitPending?.();
  const finalProbe = await Runtime.evaluate({ expression: script, returnByValue: true })
    .then((res) => res?.result?.value as CommitProbeState | undefined)
    .catch(() => undefined);
  const probe = finalProbe && typeof finalProbe === "object" ? finalProbe : lastProbe;
  if (probe) updateSubmissionDiagnosticFromProbe(diagnostic, probe);
  if (logger) {
    logger(
      `Prompt commit check failed; latest state: ${
        probe ? JSON.stringify(summarizeCommitProbe(probe)) : "unavailable"
      }`,
    );
    await logDomFailure(Runtime, logger, "prompt-commit");
  }
  if (prompt.trim().length >= 50_000) {
    throw new BrowserAutomationError(
      "Prompt did not appear in conversation before timeout (likely too large).",
      {
        stage: "submit-prompt",
        code: "prompt-too-large",
        promptLength: prompt.trim().length,
        timeoutMs,
      },
    );
  }
  const draftRetained = Boolean(
    probe &&
    probe.composerCleared === false &&
    ((typeof probe.editorValue === "string" && probe.editorValue.trim().length > 0) ||
      (typeof probe.fallbackValue === "string" && probe.fallbackValue.trim().length > 0)),
  );
  diagnostic.draftRetained = draftRetained;
  diagnostic.composerCleared = probe?.composerCleared ?? null;
  if (diagnostic.potentiallySubmittingEventEmitted) {
    diagnostic.finalCommitClassification = "commit-indeterminate-after-dispatch";
    throw buildIndeterminateCommitError({
      prompt,
      diagnostic,
      timeoutMs,
      probe,
    });
  }
  const failureCode = classifyFinalCommitFailure(diagnostic, draftRetained);
  diagnostic.finalCommitClassification = failureCode;
  throw new BrowserAutomationError(
    draftRetained
      ? "The exact prompt remains in the composer after the bounded dispatch path; Oracle did not certify a committed user turn."
      : "The composer cleared but the exact user turn did not become observable; commit remains ambiguous and Oracle will not resend.",
    {
      stage: "submit-prompt",
      code: failureCode,
      submissionCommitted: false,
      draftRetained,
      promptLength: prompt.trim().length,
      timeoutMs,
      commitProbe: probe ? summarizeCommitProbe(probe) : undefined,
    },
  );
}

interface CommitProbeState {
  baseline?: number;
  userMatched?: boolean;
  newUserTurnCount?: number;
  matchingUserTurnCount?: number;
  matchedUserTurnIndex?: number | null;
  lastMatched?: boolean;
  lastUserTurnAvailable?: boolean;
  hasNewTurn?: boolean;
  stopVisible?: boolean;
  assistantVisible?: boolean;
  composerCleared?: boolean;
  inConversation?: boolean;
  turnsCount?: number;
  href?: string;
  editorValue?: string;
  fallbackValue?: string;
  lastTurn?: string;
}

function updateSubmissionDiagnosticFromProbe(
  diagnostic: SubmissionDiagnostic,
  probe: CommitProbeState,
): void {
  diagnostic.composerCleared = probe.composerCleared ?? diagnostic.composerCleared;
  diagnostic.draftRetained =
    typeof probe.composerCleared === "boolean" ? !probe.composerCleared : diagnostic.draftRetained;
  diagnostic.newUserTurnObserved =
    diagnostic.newUserTurnObserved ||
    probe.hasNewTurn === true ||
    (probe.newUserTurnCount ?? 0) > 0;
  diagnostic.matchingUserTurnObserved =
    diagnostic.matchingUserTurnObserved ||
    probe.userMatched === true ||
    (probe.matchingUserTurnCount ?? 0) > 0;
  diagnostic.assistantObserved = diagnostic.assistantObserved || probe.assistantVisible === true;
  diagnostic.generationControlObserved =
    diagnostic.generationControlObserved || probe.stopVisible === true;
}

function classifyFinalCommitFailure(
  diagnostic: SubmissionDiagnostic,
  draftRetained: boolean,
): string {
  if (diagnostic.potentiallySubmittingEventEmitted) {
    return "commit-indeterminate-after-dispatch";
  }
  if (!draftRetained) return "commit-ambiguous-composer-cleared";
  return diagnostic.initialDispatchMethod === "trusted-click" ? "trusted-click-noop" : "enter-noop";
}

// Keep booleans/counts but replace free text with lengths so session metadata stays lean.
function summarizeCommitProbe(probe: CommitProbeState): Record<string, unknown> {
  return {
    baseline: probe.baseline,
    turnsCount: probe.turnsCount,
    userMatched: probe.userMatched,
    newUserTurnCount: probe.newUserTurnCount,
    matchingUserTurnCount: probe.matchingUserTurnCount,
    matchedUserTurnIndex: probe.matchedUserTurnIndex,
    lastMatched: probe.lastMatched,
    lastUserTurnAvailable: probe.lastUserTurnAvailable,
    hasNewTurn: probe.hasNewTurn,
    stopVisible: probe.stopVisible,
    assistantVisible: probe.assistantVisible,
    composerCleared: probe.composerCleared,
    inConversation: probe.inConversation,
    editorLength: typeof probe.editorValue === "string" ? probe.editorValue.length : undefined,
    lastTurnLength: typeof probe.lastTurn === "string" ? probe.lastTurn.length : undefined,
  };
}

function normalizeComposerText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\u00a0/gu, " ");
}

function composerSha256(value: string): string {
  return createHash("sha256").update(normalizeComposerText(value), "utf8").digest("hex");
}

// biome-ignore lint/style/useNamingConvention: test-only export used in vitest suite
export const __test__ = {
  attemptSendButton,
  composerValueReaderSource: COMPOSER_VALUE_READER_SOURCE,
  sendButtonTimeoutMs,
  verifyPromptCommitted,
};
