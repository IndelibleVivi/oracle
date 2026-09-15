import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  __test__ as promptComposer,
  assertPromptComposerEmptyBeforeAttachmentMutation,
  clearOwnedPromptAndAttachmentsForFallback,
  clearPromptComposer,
  submitPrompt,
} from "../../src/browser/actions/promptComposer.js";
import {
  CONVERSATION_TURN_CONTAINER_SELECTOR,
  CONVERSATION_TURN_SELECTOR,
} from "../../src/browser/constants.js";

function createSubmitDispatchScenario({
  method,
  commitAtMs,
}: {
  method: "trusted-click" | "enter";
  commitAtMs: number | null;
}) {
  let dispatchCount = 0;
  const runtime = {
    evaluate: vi.fn(async ({ expression }: { expression: string }) => {
      if (expression.includes("document.readyState")) {
        return { result: { value: { ready: true, composer: true, fileInput: false } } };
      }
      if (expression.includes("oracle-preexisting-composer-check")) {
        return { result: { value: { composerLength: 0, composerEmpty: true } } };
      }
      if (expression.includes("focused: true")) {
        return { result: { value: { focused: true, bound: true } } };
      }
      if (expression.includes("editorText")) {
        return {
          result: {
            value: {
              boundFound: true,
              editorText: "hello",
              fallbackValue: "",
              activeValue: "hello",
            },
          },
        };
      }
      if (expression.includes("oracle-composer-unchanged-check")) {
        return { result: { value: { unchanged: true, observedLength: 5 } } };
      }
      if (expression.includes("button.scrollIntoView")) {
        return {
          result: {
            value:
              method === "trusted-click"
                ? { status: "point", x: 10, y: 20 }
                : { status: "missing" },
          },
        };
      }
      const committed = commitAtMs !== null && Date.now() >= commitAtMs;
      return {
        result: {
          value: {
            baseline: 0,
            turnsCount: committed ? 1 : 0,
            newUserTurnCount: committed ? 1 : 0,
            matchingUserTurnCount: committed ? 1 : 0,
            userMatched: committed,
            matchedUserTurnIndex: committed ? 0 : null,
            lastMatched: committed,
            hasNewTurn: committed,
            stopVisible: committed,
            assistantVisible: false,
            composerCleared: committed,
            inConversation: committed,
            editorValue: committed ? "" : "hello",
          },
        },
      };
    }),
  };
  const input = {
    insertText: vi.fn(),
    dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
      if (type === "mousePressed") dispatchCount += 1;
    }),
    dispatchKeyEvent: vi.fn(async ({ type }: { type: string }) => {
      if (type === "keyDown") dispatchCount += 1;
    }),
  };
  return {
    runtime,
    input,
    page: { bringToFront: vi.fn() },
    isSubmissionOwner: vi.fn(() => true),
    dispatchCount: () => dispatchCount,
  };
}

describe("promptComposer", () => {
  test("reconstructs exact multiline text from ProseMirror blocks", () => {
    class FakeNode {
      static TEXT_NODE = 3;

      nodeType = 1;
      nodeValue: string | null = null;
    }
    class FakeText extends FakeNode {
      override nodeType = FakeNode.TEXT_NODE;

      constructor(override nodeValue: string) {
        super();
      }
    }
    class FakeElement extends FakeNode {
      isContentEditable = false;

      constructor(
        readonly tagName: string,
        readonly childNodes: FakeNode[] = [],
        readonly classNames: string[] = [],
      ) {
        super();
      }

      get children() {
        return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
      }

      get classList() {
        return { contains: (name: string) => this.classNames.includes(name) };
      }

      getAttribute(name: string) {
        return name === "contenteditable" && this.isContentEditable ? "true" : null;
      }
    }
    class FakeTextArea extends FakeElement {
      value = "";

      constructor() {
        super("TEXTAREA");
      }
    }

    const paragraph = (text: string) => new FakeElement("P", [new FakeText(text)]);
    const blankParagraph = new FakeElement("P", [
      new FakeElement("BR", [], ["ProseMirror-trailingBreak"]),
    ]);
    const hardBreakParagraph = new FakeElement("P", [
      new FakeText("line 3"),
      new FakeElement("BR"),
      new FakeText("continued"),
    ]);
    const editor = new FakeElement("DIV", [
      paragraph("line 1"),
      blankParagraph,
      paragraph("line 2"),
      hardBreakParagraph,
    ]);
    editor.isContentEditable = true;

    const readComposerValue = Function(
      "node",
      "Node",
      "HTMLElement",
      "HTMLTextAreaElement",
      `${promptComposer.composerValueReaderSource}\nreturn readComposerValue(node);`,
    ) as (
      node: FakeElement,
      nodeClass: typeof FakeNode,
      elementClass: typeof FakeElement,
      textareaClass: typeof FakeTextArea,
    ) => string;

    expect(readComposerValue(editor, FakeNode, FakeElement, FakeTextArea)).toBe(
      "line 1\n\nline 2\nline 3\ncontinued",
    );
  });

  test("keeps textarea values byte-for-byte apart from newline normalization", () => {
    class FakeNode {
      static TEXT_NODE = 3;
    }
    class FakeElement {}
    class FakeTextArea extends FakeElement {
      constructor(readonly value: string) {
        super();
      }
    }
    const textarea = new FakeTextArea("first\r\nsecond");
    const readComposerValue = Function(
      "node",
      "Node",
      "HTMLElement",
      "HTMLTextAreaElement",
      `${promptComposer.composerValueReaderSource}\nreturn readComposerValue(node);`,
    ) as (
      node: FakeTextArea,
      nodeClass: typeof FakeNode,
      elementClass: typeof FakeElement,
      textareaClass: typeof FakeTextArea,
    ) => string;

    expect(readComposerValue(textarea, FakeNode, FakeElement, FakeTextArea)).toBe(
      "first\r\nsecond",
    );
  });

  test("fails composer clearing when stale text remains", async () => {
    const runtime = {
      evaluate: vi.fn().mockResolvedValue({
        result: { value: { cleared: true, remaining: ["old draft"] } },
      }),
    } as unknown as {
      evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
    };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await expect(clearPromptComposer(runtime as never, logger as never)).rejects.toThrow(
      /Failed to clear prompt composer/,
    );
  });

  test("does not treat historical assistant content as committed without a new turn", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi
          .fn()
          // Baseline read (turn count)
          .mockResolvedValueOnce({ result: { value: 10 } })
          // Polls (repeat)
          .mockResolvedValue({
            result: {
              value: {
                baseline: 10,
                turnsCount: 10,
                userMatched: false,
                prefixMatched: false,
                lastMatched: false,
                hasNewTurn: false,
                stopVisible: true,
                assistantVisible: true,
                composerCleared: true,
                inConversation: false,
              },
            },
          }),
      } as unknown as {
        evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
      };

      const promise = promptComposer.verifyPromptCommitted(runtime as never, "hello", 150);
      // Attach the rejection handler before timers advance to avoid unhandled-rejection warnings.
      const assertion = expect(promise).rejects.toThrow(/commit remains ambiguous/i);
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not count nested broad-selector matches as new turns in a reused conversation", async () => {
    vi.useFakeTimers();
    try {
      const topLevelTurns = [{ innerText: "old user" }, { innerText: "old assistant" }];
      const nestedMatches = [
        topLevelTurns[0],
        { innerText: "old user" },
        topLevelTurns[1],
        { innerText: "old assistant" },
      ];
      const document = {
        querySelector: () => null,
        querySelectorAll: (selector: string) => {
          if (selector === CONVERSATION_TURN_CONTAINER_SELECTOR) return topLevelTurns;
          if (selector === CONVERSATION_TURN_SELECTOR) return nestedMatches;
          return [];
        },
      };
      class FakeTextArea {}
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => ({
          result: {
            value: Function(
              "document",
              "HTMLTextAreaElement",
              "location",
              `return ${expression};`,
            )(document, FakeTextArea, { href: "https://chatgpt.com/c/reused" }),
          },
        })),
      } as unknown as {
        evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
      };

      const promise = promptComposer.verifyPromptCommitted(
        runtime as never,
        "new prompt",
        150,
        undefined,
        2,
      );
      const assertion = expect(promise).rejects.toThrow(/commit remains ambiguous/i);
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not accept a committed user turn with stray appended input", async () => {
    vi.useFakeTimers();
    try {
      const content = { innerText: "hello x", textContent: "hello x" };
      const userTurn = {
        innerText: "hello x",
        dataset: { turn: "user" },
        getAttribute: (name: string) => (name === "data-message-author-role" ? "user" : null),
        querySelector: (selector: string) => (selector === ".whitespace-pre-wrap" ? content : null),
      };
      const document = {
        querySelector: (selector: string) =>
          selector === '[data-testid="stop-button"]' ? {} : null,
        querySelectorAll: (selector: string) =>
          selector === CONVERSATION_TURN_CONTAINER_SELECTOR ? [userTurn] : [],
      };
      class FakeTextArea {}
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => ({
          result: {
            value: Function(
              "document",
              "HTMLTextAreaElement",
              "location",
              `return ${expression};`,
            )(document, FakeTextArea, { href: "https://chatgpt.com/c/mutated" }),
          },
        })),
      };

      const promise = promptComposer.verifyPromptCommitted(
        runtime as never,
        "hello",
        150,
        undefined,
        0,
      );
      const assertion = expect(promise).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "commit-ambiguous-composer-cleared",
          commitProbe: expect.objectContaining({
            lastMatched: false,
            lastUserTurnAvailable: true,
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("commit timeout throws a structured error with probe diagnostics", async () => {
    vi.useFakeTimers();
    try {
      const probe = {
        baseline: 10,
        turnsCount: 10,
        userMatched: false,
        prefixMatched: false,
        lastMatched: false,
        hasNewTurn: false,
        stopVisible: false,
        assistantVisible: false,
        composerCleared: true,
        inConversation: false,
        editorValue: "",
        lastTurn: "previous turn text",
      };
      const runtime = {
        evaluate: vi
          .fn()
          // Baseline read (turn count)
          .mockResolvedValueOnce({ result: { value: 10 } })
          // Polls + final diagnostic probe
          .mockResolvedValue({ result: { value: probe } }),
      } as unknown as {
        evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
      };

      const promise = promptComposer.verifyPromptCommitted(runtime as never, "hello", 150);
      const assertion = promise.then(
        () => {
          throw new Error("expected verifyPromptCommitted to reject");
        },
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(250);
      const error = (await assertion) as {
        name?: string;
        details?: Record<string, unknown>;
        message?: string;
      };
      expect(error.message).toMatch(/commit remains ambiguous/i);
      expect(error.name).toBe("BrowserAutomationError");
      expect(error.details).toMatchObject({
        stage: "submit-prompt",
        code: "commit-ambiguous-composer-cleared",
        commitProbe: expect.objectContaining({
          hasNewTurn: false,
          composerCleared: true,
          turnsCount: 10,
          lastTurnLength: "previous turn text".length,
        }),
      });
      // Free text must not leak into the structured details.
      const commitProbe = error.details?.commitProbe as Record<string, unknown>;
      expect(commitProbe).not.toHaveProperty("lastTurn");
      expect(commitProbe).not.toHaveProperty("editorValue");
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects a matching historical turn when baseline turn count cannot be read", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi
          .fn()
          // Baseline read fails
          .mockRejectedValueOnce(new Error("turn read failed"))
          // Polls show only a historical prompt match (baseline unknown)
          .mockResolvedValue({
            result: {
              value: {
                baseline: -1,
                turnsCount: 1,
                userMatched: true,
                prefixMatched: false,
                lastMatched: true,
                hasNewTurn: false,
                stopVisible: false,
                assistantVisible: false,
                composerCleared: false,
                inConversation: true,
              },
            },
          }),
      } as unknown as {
        evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
      };

      const promise = promptComposer.verifyPromptCommitted(runtime as never, "hello", 150);
      const assertion = expect(promise).rejects.toThrow(/commit remains ambiguous/i);
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not infer a commit when no semantic user turn is available", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn().mockResolvedValue({
          result: {
            value: {
              baseline: 0,
              turnsCount: 1,
              userMatched: false,
              lastMatched: false,
              lastUserTurnAvailable: false,
              hasNewTurn: true,
              stopVisible: true,
              assistantVisible: true,
              composerCleared: true,
              inConversation: true,
            },
          },
        }),
      };

      const promise = promptComposer.verifyPromptCommitted(
        runtime as never,
        "hello",
        150,
        undefined,
        0,
      );
      const assertion = expect(promise).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "commit-ambiguous-composer-cleared",
          commitProbe: expect.objectContaining({
            lastMatched: false,
            lastUserTurnAvailable: false,
            hasNewTurn: true,
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports a retained composer draft as an uncommitted submission", async () => {
    vi.useFakeTimers();
    try {
      const probe = {
        baseline: 0,
        turnsCount: 0,
        userMatched: false,
        prefixMatched: false,
        lastMatched: false,
        hasNewTurn: false,
        stopVisible: false,
        assistantVisible: false,
        composerCleared: false,
        inConversation: false,
        editorValue: "unsent prompt",
        lastTurn: "",
      };
      const runtime = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce({ result: { value: 0 } })
          .mockResolvedValue({ result: { value: probe } }),
      };

      const promise = promptComposer.verifyPromptCommitted(runtime as never, "unsent prompt", 150);
      const assertion = expect(promise).rejects.toMatchObject({
        message: expect.stringMatching(/exact prompt remains in the composer/i),
        details: expect.objectContaining({
          code: "enter-noop",
          submissionCommitted: false,
          draftRetained: true,
        }),
      });
      await vi.advanceTimersByTimeAsync(250);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("attachment sends time out instead of allowing Enter fallback", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("dispatchClickSequence")) {
            return { result: { value: { status: "disabled" } } };
          }
          return { result: { value: true } };
        }),
      } as unknown as {
        evaluate: (args: { expression: string; returnByValue?: boolean }) => Promise<unknown>;
      };

      const promise = promptComposer.attemptSendButton(
        runtime as never,
        (() => undefined) as never,
        undefined,
        ["oracle-attach-verify.txt"],
      );
      const assertion = expect(promise).rejects.toThrow(/after 45s/i);
      await vi.advanceTimersByTimeAsync(46_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("only attachment sends get the longer send-button deadline", () => {
    expect(promptComposer.sendButtonTimeoutMs()).toBe(20_000);
    expect(promptComposer.sendButtonTimeoutMs([])).toBe(20_000);
    expect(promptComposer.sendButtonTimeoutMs(["oracle-attach-verify.txt"])).toBe(45_000);
    expect(promptComposer.sendButtonTimeoutMs(["oracle-attach-verify.txt"], 120_000)).toBe(120_000);
  });

  test("records dispatch before marking a verified prompt commit", async () => {
    const callbacks: string[] = [];
    const onPromptDispatched = vi.fn(() => {
      callbacks.push("dispatched");
    });
    const onPromptCommitted = vi.fn(() => {
      callbacks.push("committed");
    });
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "point", x: 10, y: 20 } } };
        }
        return {
          result: {
            value: {
              baseline: 0,
              turnsCount: 2,
              userMatched: true,
              matchedUserTurnIndex: 0,
              prefixMatched: false,
              lastMatched: true,
              hasNewTurn: true,
              stopVisible: true,
              assistantVisible: false,
              composerCleared: true,
              inConversation: true,
            },
          },
        };
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(),
    };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await submitPrompt(
      {
        runtime: runtime as never,
        input: input as never,
        baselineTurns: 0,
        onPromptDispatched,
        onPromptCommitted,
      },
      "hello",
      logger as never,
    );

    expect(onPromptDispatched).toHaveBeenCalledTimes(1);
    expect(onPromptCommitted).toHaveBeenCalledTimes(1);
    expect(onPromptCommitted).toHaveBeenCalledWith(2, 0);
    expect(callbacks).toEqual(["dispatched", "committed"]);
  });

  test("rejects pre-existing composer content before inserting a new prompt", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: false } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: {
                value: { composerLength: 19, composerEmpty: false },
              },
            };
          }
          throw new Error("typing must not start while the old draft remains");
        }),
      };
      const input = { insertText: vi.fn(), dispatchKeyEvent: vi.fn() };
      const logger = Object.assign(vi.fn(), { verbose: false });

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
        },
        "new prompt",
        logger as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "preexisting-composer-content",
          submissionCommitted: false,
          draftRetained: true,
          composerLengthBeforeDispatch: 19,
          composerSettleTimeoutMs: 5_000,
        }),
      });
      await vi.advanceTimersByTimeAsync(5_500);
      await assertion;

      expect(input.insertText).not.toHaveBeenCalled();
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("blocks attachment mutation while pre-existing composer content remains", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: {
                value: { composerFound: true, composerLength: 19, composerEmpty: false },
              },
            };
          }
          throw new Error("attachment mutation must not begin before the composer guard");
        }),
      };

      const result = assertPromptComposerEmptyBeforeAttachmentMutation(runtime as never);
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "preexisting-composer-content",
          submissionCommitted: false,
          draftRetained: true,
          retrySafe: false,
          submissionDiagnostic: expect.objectContaining({
            potentiallySubmittingEventEmitted: false,
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(5_500);
      await assertion;

      expect(runtime.evaluate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("blocks attachment mutation for an attachment-only pre-existing draft", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("oracle-preexisting-composer-check")) {
          return {
            result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
          };
        }
        if (expression.includes("const expected = []")) {
          return { result: { value: false } };
        }
        throw new Error("unexpected composer attachment probe");
      }),
    };

    await expect(
      assertPromptComposerEmptyBeforeAttachmentMutation(runtime as never),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "preexisting-composer-attachments",
        submissionCommitted: false,
        draftRetained: true,
        potentiallySubmittingEventEmitted: false,
        retrySafe: false,
      }),
    });
    expect(runtime.evaluate).toHaveBeenCalledTimes(2);
  });

  test("clears the exact owned attachment set before an inline file fallback", async () => {
    let exactSetChecks = 0;
    let targetedRemoveClicks = 0;
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("oracle-owned-draft-cleanup-final-verify")) {
          return {
            result: {
              value: { composerFound: true, composerEmpty: true, attachmentSetEmpty: true },
            },
          };
        }
        if (expression.startsWith("document.querySelectorAll")) {
          return { result: { value: 0 } };
        }
        if (expression.includes("const cleanupMode = true")) {
          targetedRemoveClicks += 1;
          return { result: { value: { exactSetMatched: true, removeClicks: 1 } } };
        }
        if (expression.includes("oracle-owned-draft-read")) {
          return { result: { value: { exact: true, observed: "owned prompt" } } };
        }
        if (expression.includes("oracle-owned-draft-cleanup-verify")) {
          return { result: { value: { composerFound: true, empty: true } } };
        }
        if (expression.includes("oracle-owned-draft-cleanup")) {
          return { result: { value: { cleared: true } } };
        }
        if (expression.includes("evidence.bin")) {
          exactSetChecks += 1;
          return { result: { value: true } };
        }
        if (expression.includes("const expected = []")) {
          return { result: { value: true } };
        }
        throw new Error("unexpected fallback cleanup probe");
      }),
    };

    await clearOwnedPromptAndAttachmentsForFallback(runtime as never, "owned prompt", [
      { name: "evidence.bin" },
    ]);

    expect(exactSetChecks).toBe(1);
    expect(targetedRemoveClicks).toBe(1);
    expect(
      runtime.evaluate.mock.calls.some(([call]) =>
        call.expression.includes("const dispatchClearEvents"),
      ),
    ).toBe(false);
  });

  test("retains fallback state when the prior attachment set is no longer exact", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("oracle-owned-draft-read")) {
          return { result: { value: { exact: true, observed: "owned prompt" } } };
        }
        if (expression.includes("evidence.bin")) {
          return { result: { value: false } };
        }
        throw new Error("fallback cleanup must not mutate an unverified attachment set");
      }),
    };

    await expect(
      clearOwnedPromptAndAttachmentsForFallback(runtime as never, "owned prompt", [
        { name: "evidence.bin" },
      ]),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "fallback-cleanup-unverified",
        submissionCommitted: false,
        potentiallySubmittingEventEmitted: false,
        draftRetained: true,
        retrySafe: false,
        recoverable: true,
        cleanupVerified: false,
      }),
    });
    expect(runtime.evaluate).toHaveBeenCalledTimes(2);
  });

  test("retains fallback state when the exact owned prompt changed", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        expect(expression).toContain("oracle-owned-draft-read");
        return { result: { value: { exact: true, observed: "changed prompt" } } };
      }),
    };

    await expect(
      clearOwnedPromptAndAttachmentsForFallback(runtime as never, "owned prompt", [
        { name: "evidence.bin" },
      ]),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "fallback-cleanup-unverified",
        potentiallySubmittingEventEmitted: false,
        retrySafe: false,
      }),
    });
    expect(runtime.evaluate).toHaveBeenCalledTimes(1);
  });

  test("clears an exact digest-owned truncated draft for file fallback", async () => {
    const truncatedPrompt = "owned truncated prompt";
    const observedDraftSha256 = createHash("sha256").update(truncatedPrompt).digest("hex");
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("oracle-owned-draft-cleanup-final-verify")) {
          return {
            result: {
              value: { composerFound: true, composerEmpty: true, attachmentSetEmpty: true },
            },
          };
        }
        if (expression.includes("oracle-owned-draft-read")) {
          return { result: { value: { exact: true, observed: truncatedPrompt } } };
        }
        if (expression.includes("oracle-owned-draft-cleanup-verify")) {
          return { result: { value: { composerFound: true, empty: true } } };
        }
        if (expression.includes("oracle-owned-draft-cleanup")) {
          expect(expression).toContain(JSON.stringify(truncatedPrompt));
          return { result: { value: { cleared: true } } };
        }
        if (expression.includes("const expected = []")) {
          return { result: { value: true } };
        }
        throw new Error("unexpected truncated fallback cleanup probe");
      }),
    };

    await expect(
      clearOwnedPromptAndAttachmentsForFallback(
        runtime as never,
        `${truncatedPrompt} plus unavailable tail`,
        [],
        observedDraftSha256,
      ),
    ).resolves.toBeUndefined();
  });

  test("retains a truncated fallback draft when its observed digest changed", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        expect(expression).toContain("oracle-owned-draft-read");
        return { result: { value: { exact: true, observed: "changed truncated prompt" } } };
      }),
    };

    await expect(
      clearOwnedPromptAndAttachmentsForFallback(
        runtime as never,
        "full prompt with unavailable tail",
        [],
        createHash("sha256").update("original truncated prompt").digest("hex"),
      ),
    ).rejects.toMatchObject({
      details: {
        code: "fallback-cleanup-unverified",
        draftRetained: true,
        retrySafe: false,
        cleanupVerified: false,
      },
    });

    expect(runtime.evaluate).toHaveBeenCalledTimes(1);
  });

  test("waits for transient restored composer content to settle empty before typing", async () => {
    vi.useFakeTimers();
    try {
      let composerChecks = 0;
      let dispatchCount = 0;
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: false } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            composerChecks += 1;
            return {
              result: {
                value:
                  composerChecks < 3
                    ? { composerFound: true, composerLength: 19, composerEmpty: false }
                    : { composerFound: true, composerLength: 0, composerEmpty: true },
              },
            };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "new prompt",
                  fallbackValue: "",
                  activeValue: "new prompt",
                },
              },
            };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "point", x: 10, y: 20 } } };
          }
          return {
            result: {
              value: {
                baseline: 0,
                turnsCount: 1,
                newUserTurnCount: 1,
                matchingUserTurnCount: 1,
                userMatched: true,
                matchedUserTurnIndex: 0,
                lastMatched: true,
                hasNewTurn: true,
                stopVisible: true,
                assistantVisible: false,
                composerCleared: true,
                inConversation: true,
                editorValue: "",
              },
            },
          };
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
          if (type === "mousePressed") dispatchCount += 1;
        }),
        dispatchKeyEvent: vi.fn(),
      };
      const logger = Object.assign(vi.fn(), { verbose: false });

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
        },
        "new prompt",
        logger as never,
      );
      const assertion = expect(result).resolves.toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;

      expect(composerChecks).toBe(3);
      expect(input.insertText).toHaveBeenCalledTimes(1);
      expect(dispatchCount).toBe(1);
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("fails closed when the active composer cannot be identified", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return {
            result: {
              value: { composerFound: false, composerLength: 0, composerEmpty: true },
            },
          };
        }
        throw new Error("typing must not start without an identified composer");
      }),
    };
    const input = { insertText: vi.fn(), dispatchKeyEvent: vi.fn() };
    const logger = Object.assign(vi.fn(), { verbose: false });

    let caught: unknown;
    try {
      await submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
        },
        "new prompt",
        logger as never,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      details: expect.objectContaining({
        code: "composer-state-unavailable",
        submissionCommitted: false,
        draftRetained: false,
        retrySafe: true,
        submissionDiagnostic: expect.objectContaining({
          potentiallySubmittingEventEmitted: false,
          retryEligible: true,
          retryBlockedReason: null,
          finalCommitClassification: "safe-pre-dispatch-failure",
        }),
      }),
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/an explicit retry is safe/i);
    expect((caught as Error).message).not.toContain("oracle session <session-id> --render");
    expect(input.insertText).not.toHaveBeenCalled();
  });

  test("marks a truncated large pre-dispatch prompt as retained", async () => {
    const prompt = "x".repeat(50_000);
    const truncatedPrompt = prompt.slice(0, 1_000);
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return {
            result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
          };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: truncatedPrompt,
                fallbackValue: "",
                activeValue: truncatedPrompt,
              },
            },
          };
        }
        throw new Error("send must not be attempted for a truncated prompt");
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchMouseEvent: vi.fn(),
      dispatchKeyEvent: vi.fn(),
    };

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
        },
        prompt,
        Object.assign(vi.fn(), { verbose: false }) as never,
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "prompt-too-large",
        submissionCommitted: false,
        draftRetained: true,
        potentiallySubmittingEventEmitted: false,
        retrySafe: false,
        observedDraftSha256: createHash("sha256").update(truncatedPrompt).digest("hex"),
      }),
    });

    expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
  });

  test("activates the exact owned target before final composer identity and point measurement", async () => {
    const actions: string[] = [];
    let activated = false;
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          if (activated) {
            actions.push("final-composer-read");
          }
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
                href: "https://chatgpt.com/",
                documentTokenStored: true,
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          actions.push(`measure-${activated ? "active" : "inactive"}`);
          return {
            result: {
              value: { status: "point", x: activated ? 30 : 10, y: activated ? 40 : 20 },
            },
          };
        }
        return {
          result: {
            value: {
              baseline: 0,
              turnsCount: 1,
              newUserTurnCount: 1,
              matchingUserTurnCount: 1,
              userMatched: true,
              matchedUserTurnIndex: 0,
              lastMatched: true,
              hasNewTurn: true,
              stopVisible: true,
              assistantVisible: false,
              composerCleared: true,
              inConversation: true,
            },
          },
        };
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(async ({ type, x, y }: { type: string; x: number; y: number }) => {
        if (type === "mousePressed") actions.push(`press-${x}-${y}`);
      }),
    };
    const page = {
      bringToFront: vi.fn(async () => {
        activated = true;
        actions.push("activate");
      }),
    };
    const isSubmissionOwner = vi.fn(() => true);
    const logger = Object.assign(vi.fn(), { verbose: false });

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: page as never,
          baselineTurns: 0,
          isSubmissionOwner,
        },
        "hello",
        logger as never,
      ),
    ).resolves.toBe(1);

    expect(page.bringToFront).toHaveBeenCalledTimes(3);
    expect(actions.indexOf("activate")).toBeLessThan(actions.indexOf("final-composer-read"));
    expect(actions).toContain("measure-active");
    expect(actions).toContain("press-30-40");
    expect(actions).not.toContain("measure-inactive");
  });

  type ExactNodeComposerRead = {
    boundFound: boolean;
    editorText: string;
    anyCandidateHasContent?: boolean;
  };

  function createExactNodeComposerScenario({
    prompt,
    reads,
    inferredValue,
    method = "trusted-click",
    insertText,
  }: {
    prompt: string;
    reads: ExactNodeComposerRead[];
    /** What a fresh first-visible candidate reads (the divergent wrapper). */
    inferredValue?: string;
    method?: "trusted-click" | "enter";
    insertText?: () => Promise<void>;
  }) {
    const expressions: string[] = [];
    const exactReads: ExactNodeComposerRead[] = [];
    let readIndex = 0;
    let dispatchCount = 0;
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        expressions.push(expression);
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return {
            result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
          };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("oracle-composer-binding-release")) {
          return { result: { value: true } };
        }
        if (expression.includes("oracle-composer-binding-read")) {
          const read = reads[Math.min(readIndex, reads.length - 1)];
          readIndex += 1;
          exactReads.push(read);
          return { result: { value: read } };
        }
        if (expression.includes("oracle-composer-unchanged-check")) {
          return { result: { value: { unchanged: true, observedLength: prompt.length } } };
        }
        if (expression.includes("button.scrollIntoView")) {
          return {
            result: {
              value: method === "enter" ? { status: "missing" } : { status: "point", x: 10, y: 20 },
            },
          };
        }
        if (expression.includes("editorText")) {
          // Legacy first-visible inference: the divergent structural wrapper.
          const value = inferredValue ?? prompt;
          return {
            result: {
              value: { boundFound: true, editorText: value, fallbackValue: "", activeValue: value },
            },
          };
        }
        return {
          result: {
            value: {
              baseline: 0,
              turnsCount: 1,
              newUserTurnCount: 1,
              matchingUserTurnCount: 1,
              userMatched: true,
              matchedUserTurnIndex: 0,
              lastMatched: true,
              hasNewTurn: true,
              stopVisible: true,
              assistantVisible: false,
              composerCleared: true,
              inConversation: true,
            },
          },
        };
      }),
    };
    const input = {
      insertText: vi.fn(insertText ?? (async () => {})),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
        if (type === "mousePressed") dispatchCount += 1;
      }),
    };
    return {
      runtime,
      input,
      page: { bringToFront: vi.fn() },
      exactReads: () => exactReads,
      dispatchCount: () => dispatchCount,
      expressions: () => expressions,
      releasedBinding: () =>
        expressions.some((expression) => expression.includes("oracle-composer-binding-release")),
    };
  }

  const submitExactNodeScenario = (
    scenario: ReturnType<typeof createExactNodeComposerScenario>,
    prompt: string,
  ) =>
    submitPrompt(
      {
        runtime: scenario.runtime as never,
        input: scenario.input as never,
        page: scenario.page as never,
        baselineTurns: 0,
        isSubmissionOwner: async () => true,
      },
      prompt,
      Object.assign(vi.fn(), { verbose: false }) as never,
    );

  test("verifies the exact populated node instead of a divergent first-visible wrapper", async () => {
    // Regression for the retained-draft emergency: the exact node Oracle typed
    // into still holds the prompt, while a sibling structural candidate reads
    // five extra DOM-structural characters. Oracle must verify the node it
    // populated and keep exactly one trusted dispatch.
    const prompt = "Retained draft regression: exactly one trusted dispatch.";
    const wrapperValue = `${prompt}\n\n\n\n\n`;
    expect(wrapperValue.length).toBe(prompt.length + 5);
    const scenario = createExactNodeComposerScenario({
      prompt,
      reads: [{ boundFound: true, editorText: prompt, anyCandidateHasContent: true }],
      inferredValue: wrapperValue,
    });

    await expect(submitExactNodeScenario(scenario, prompt)).resolves.toBe(1);

    expect(scenario.exactReads()).toHaveLength(1);
    expect(scenario.input.insertText).toHaveBeenCalledWith({ text: prompt });
    expect(scenario.dispatchCount()).toBe(1);
    expect(scenario.input.dispatchKeyEvent).not.toHaveBeenCalled();
    expect(scenario.releasedBinding()).toBe(true);
  });

  test("settles a transient exact-node structural readback before the one dispatch", async () => {
    vi.useFakeTimers();
    try {
      // Same failure family: the exact populated node itself transiently renders
      // five extra structural newlines after target activation and then settles
      // back to the populated prompt. Oracle re-reads only that same node and
      // dispatches exactly once after it matches.
      const prompt = "Transient exact-node readback settles before Send.";
      const transientValue = `${prompt}\n\n\n\n\n`;
      expect(transientValue.length).toBe(prompt.length + 5);
      const scenario = createExactNodeComposerScenario({
        prompt,
        reads: [
          { boundFound: true, editorText: transientValue, anyCandidateHasContent: true },
          { boundFound: true, editorText: prompt, anyCandidateHasContent: true },
        ],
        inferredValue: transientValue,
      });

      const result = submitExactNodeScenario(scenario, prompt);
      const assertion = expect(result).resolves.toBe(1);
      await vi.advanceTimersByTimeAsync(3_000);
      await assertion;

      expect(scenario.exactReads()).toHaveLength(2);
      expect(scenario.input.insertText).toHaveBeenCalledWith({ text: prompt });
      expect(scenario.dispatchCount()).toBe(1);
      expect(scenario.input.dispatchKeyEvent).not.toHaveBeenCalled();
      expect(scenario.releasedBinding()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("fails closed on a persistent exact-node mutation without dispatching", async () => {
    vi.useFakeTimers();
    try {
      const prompt = "Persistent exact-node mutation fails closed.";
      const mutatedValue = `${prompt}!`;
      const scenario = createExactNodeComposerScenario({
        prompt,
        reads: [
          {
            boundFound: true,
            editorText: mutatedValue,
            anyCandidateHasContent: true,
          },
        ],
        // A first-visible candidate still renders the exact prompt; Oracle must
        // never adopt it as proof that this attempt's node is unchanged.
        inferredValue: prompt,
      });

      const result = submitExactNodeScenario(scenario, prompt);
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "composer-mutated-before-send",
          submissionCommitted: false,
          dispatchAttempted: false,
          retrySafe: false,
          draftRetained: true,
          expectedLength: prompt.length,
          observedLength: mutatedValue.length,
          submissionDiagnostic: expect.objectContaining({
            composerMatchedPromptBeforeDispatch: false,
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(3_500);
      await assertion;

      // Bounded: the settle window re-reads the same node and stops.
      expect(scenario.exactReads().length).toBeGreaterThanOrEqual(2);
      expect(scenario.exactReads().length).toBeLessThanOrEqual(21);
      expect(scenario.dispatchCount()).toBe(0);
      expect(scenario.input.dispatchKeyEvent).not.toHaveBeenCalled();
      expect(scenario.releasedBinding()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("fails closed when the exact populated composer node is detached or replaced", async () => {
    // A different candidate still renders the prompt text, but the exact node
    // Oracle populated is gone, so Oracle must not adopt the replacement.
    const prompt = "Detached exact node fails closed.";
    const scenario = createExactNodeComposerScenario({
      prompt,
      reads: [
        {
          boundFound: false,
          editorText: "",
          anyCandidateHasContent: true,
        },
      ],
      inferredValue: prompt,
    });

    await expect(submitExactNodeScenario(scenario, prompt)).rejects.toMatchObject({
      message: expect.stringMatching(/do not immediately rerun the prompt/i),
      details: expect.objectContaining({
        code: "composer-mutated-before-send",
        submissionCommitted: false,
        dispatchAttempted: false,
        potentiallySubmittingEventEmitted: false,
        retrySafe: false,
        draftRetained: true,
        expectedLength: prompt.length,
        observedLength: 0,
        submissionDiagnostic: expect.objectContaining({
          composerMatchedPromptBeforeDispatch: false,
        }),
      }),
    });

    // An unavailable binding stops the wait immediately instead of polling, and
    // it never dispatches.
    expect(scenario.exactReads()).toHaveLength(1);
    expect(scenario.dispatchCount()).toBe(0);
    expect(scenario.input.dispatchKeyEvent).not.toHaveBeenCalled();
    expect(scenario.releasedBinding()).toBe(true);
  });

  test("fails closed before typing when the exact-node binding cannot be stamped", async () => {
    const prompt = "Unbound composer fails before typing.";
    const expressions: string[] = [];
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        expressions.push(expression);
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return {
            result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
          };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: false } } };
        }
        if (expression.includes("oracle-composer-binding-release")) {
          return { result: { value: true } };
        }
        throw new Error("typing must not start without an exact-node binding");
      }),
    };
    const input = { insertText: vi.fn(), dispatchKeyEvent: vi.fn() };

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
        },
        prompt,
        Object.assign(vi.fn(), { verbose: false }) as never,
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "composer-state-unavailable",
        submissionCommitted: false,
        draftRetained: false,
        retrySafe: true,
      }),
    });

    expect(input.insertText).not.toHaveBeenCalled();
    expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    expect(
      expressions.some((expression) => expression.includes("oracle-composer-binding-release")),
    ).toBe(true);
  });

  test("releases the exact-node binding when a post-stamp step throws", async () => {
    const prompt = "Failed insertText still releases the binding.";
    const scenario = createExactNodeComposerScenario({
      prompt,
      reads: [{ boundFound: true, editorText: prompt, anyCandidateHasContent: true }],
      insertText: async () => {
        throw new Error("Input.insertText failed");
      },
    });

    await expect(submitExactNodeScenario(scenario, prompt)).rejects.toThrow(
      "Input.insertText failed",
    );

    expect(scenario.dispatchCount()).toBe(0);
    expect(scenario.exactReads()).toHaveLength(0);
    expect(scenario.releasedBinding()).toBe(true);
  });

  test.each(["trusted-click", "enter"] as const)(
    "emits only parseable exact-node expressions for %s dispatch",
    async (method) => {
      const scenario = createSubmitDispatchScenario({ method, commitAtMs: 0 });

      await expect(
        submitPrompt(
          {
            runtime: scenario.runtime as never,
            input: scenario.input as never,
            page: scenario.page as never,
            baselineTurns: 0,
            isSubmissionOwner: scenario.isSubmissionOwner,
          },
          "hello",
          Object.assign(vi.fn(), { verbose: false }) as never,
        ),
      ).resolves.toBe(1);

      const expressions = scenario.runtime.evaluate.mock.calls.map(([call]) =>
        String((call as { expression: string }).expression),
      );
      // The mocked runtime never executes page-side code, so parse every
      // generated expression: a broken exact-node binding must not reach a
      // runtime as invalid JavaScript.
      for (const expression of expressions) {
        expect(() => new Function(expression)).not.toThrow();
      }
      const usesBinding = (marker: string) =>
        expressions.some(
          (expression) => expression.includes(marker) && expression.includes("__oracleComposer_"),
        );
      expect(usesBinding("focused: true")).toBe(true);
      expect(usesBinding("oracle-composer-binding-read")).toBe(true);
      expect(usesBinding("button.scrollIntoView")).toBe(true);
      if (method === "enter") {
        expect(usesBinding("oracle-composer-unchanged-check")).toBe(true);
      }
      expect(
        expressions.some((expression) => expression.includes("oracle-composer-binding-release")),
      ).toBe(true);
    },
  );

  test("waits for one delayed first commit without alternate dispatch", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const scenario = createSubmitDispatchScenario({
        method: "trusted-click",
        commitAtMs: 3_500,
      });
      const onPromptDispatched = vi.fn();
      const onPromptDispatchEvent = vi.fn();

      const result = submitPrompt(
        {
          runtime: scenario.runtime as never,
          input: scenario.input as never,
          page: scenario.page as never,
          baselineTurns: 0,
          isSubmissionOwner: scenario.isSubmissionOwner,
          onPromptDispatched,
          onPromptDispatchEvent,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).resolves.toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      expect(scenario.dispatchCount()).toBe(1);
      expect(onPromptDispatched).toHaveBeenCalledTimes(1);
      expect(onPromptDispatchEvent).toHaveBeenCalledTimes(1);
      expect(
        scenario.input.dispatchMouseEvent.mock.calls.filter(
          ([event]) => event.type === "mousePressed",
        ),
      ).toHaveLength(1);
      expect(
        scenario.input.dispatchKeyEvent.mock.calls.filter(([event]) => event.type === "keyDown"),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(["trusted-click", "enter"] as const)(
    "emits no submitting event when %s dispatch-boundary persistence fails",
    async (method) => {
      vi.useFakeTimers();
      try {
        const scenario = createSubmitDispatchScenario({ method, commitAtMs: null });
        const onPromptDispatched = vi.fn(async () => {
          throw new Error("runtime hint persistence failed");
        });

        const result = submitPrompt(
          {
            runtime: scenario.runtime as never,
            input: scenario.input as never,
            page: scenario.page as never,
            baselineTurns: 0,
            isSubmissionOwner: scenario.isSubmissionOwner,
            onPromptDispatched,
          },
          "hello",
          Object.assign(vi.fn(), { verbose: false }) as never,
        );
        const assertion = expect(result).rejects.toThrow("runtime hint persistence failed");
        await vi.advanceTimersByTimeAsync(2_000);
        await assertion;

        expect(onPromptDispatched).toHaveBeenCalledTimes(1);
        expect(scenario.dispatchCount()).toBe(0);
        expect(
          scenario.input.dispatchMouseEvent.mock.calls.filter(
            ([event]) => event.type === "mousePressed",
          ),
        ).toHaveLength(0);
        expect(
          scenario.input.dispatchKeyEvent.mock.calls.filter(([event]) => event.type === "keyDown"),
        ).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test.each(["trusted-click", "enter"] as const)(
    "revalidates target ownership after persisting %s dispatch intent",
    async (method) => {
      vi.useFakeTimers();
      try {
        const scenario = createSubmitDispatchScenario({ method, commitAtMs: null });
        const onPromptDispatched = vi.fn(async () => {
          scenario.isSubmissionOwner.mockReturnValue(false);
        });

        const result = submitPrompt(
          {
            runtime: scenario.runtime as never,
            input: scenario.input as never,
            page: scenario.page as never,
            baselineTurns: 0,
            isSubmissionOwner: scenario.isSubmissionOwner,
            onPromptDispatched,
          },
          "hello",
          Object.assign(vi.fn(), { verbose: false }) as never,
        );
        const assertion = expect(result).rejects.toMatchObject({
          details: expect.objectContaining({
            code: "ownership-changed-before-send",
            submissionCommitted: false,
            potentiallySubmittingEventEmitted: false,
            retrySafe: false,
          }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await assertion;

        expect(onPromptDispatched).toHaveBeenCalledTimes(1);
        expect(scenario.dispatchCount()).toBe(0);
        expect(
          scenario.input.dispatchMouseEvent.mock.calls.filter(
            ([event]) => event.type === "mousePressed",
          ),
        ).toHaveLength(0);
        expect(
          scenario.input.dispatchKeyEvent.mock.calls.filter(([event]) => event.type === "keyDown"),
        ).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("does not dispatch when the composer changes while dispatch intent is persisting", async () => {
    let intentPersisted = false;
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          return {
            result: {
              value: intentPersisted
                ? { status: "mutated", observedLength: 6 }
                : { status: "point", x: 10, y: 20 },
            },
          };
        }
        throw new Error("commit verification must not run without a dispatch");
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchMouseEvent: vi.fn(),
      dispatchKeyEvent: vi.fn(),
    };
    const onPromptDispatched = vi.fn(async () => {
      intentPersisted = true;
    });

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
          onPromptDispatched,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "composer-mutated-before-send",
        submissionCommitted: false,
        potentiallySubmittingEventEmitted: false,
        retrySafe: false,
      }),
    });
    expect(onPromptDispatched).toHaveBeenCalledTimes(1);
    expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
  });

  test("keeps a permanently retained draft after click indeterminate with one dispatch", async () => {
    vi.useFakeTimers();
    try {
      const scenario = createSubmitDispatchScenario({
        method: "trusted-click",
        commitAtMs: null,
      });

      const result = submitPrompt(
        {
          runtime: scenario.runtime as never,
          input: scenario.input as never,
          page: scenario.page as never,
          baselineTurns: 0,
          isSubmissionOwner: scenario.isSubmissionOwner,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "commit-indeterminate-after-dispatch",
          outcome: "indeterminate",
          submissionCommitted: false,
          commitVerification: "indeterminate",
          dispatchAttempted: true,
          potentiallySubmittingEventEmitted: true,
          potentiallySubmittingEvent: "mousePressed",
          retrySafe: false,
          recoverable: true,
          draftRetained: true,
          submissionDiagnostic: expect.objectContaining({
            initialDispatchMethod: "trusted-click",
            retryEligible: false,
            retryBlockedReason: "potentially-submitting-event-emitted",
            alternateDispatchAttempted: false,
            alternateDispatchMethod: null,
            finalCommitClassification: "commit-indeterminate-after-dispatch",
            potentiallySubmittingEventEmitted: true,
            potentiallySubmittingEvent: "mousePressed",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(62_000);
      await assertion;

      expect(scenario.dispatchCount()).toBe(1);
      expect(
        scenario.input.dispatchMouseEvent.mock.calls.filter(
          ([event]) => event.type === "mousePressed",
        ),
      ).toHaveLength(1);
      expect(
        scenario.input.dispatchKeyEvent.mock.calls.filter(([event]) => event.type === "keyDown"),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps a permanently retained draft after Enter indeterminate with one dispatch", async () => {
    vi.useFakeTimers();
    try {
      const scenario = createSubmitDispatchScenario({
        method: "enter",
        commitAtMs: null,
      });
      const onPromptDispatchEvent = vi.fn();

      const result = submitPrompt(
        {
          runtime: scenario.runtime as never,
          input: scenario.input as never,
          page: scenario.page as never,
          baselineTurns: 0,
          isSubmissionOwner: scenario.isSubmissionOwner,
          onPromptDispatchEvent,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "commit-indeterminate-after-dispatch",
          outcome: "indeterminate",
          submissionCommitted: false,
          commitVerification: "indeterminate",
          dispatchAttempted: true,
          potentiallySubmittingEventEmitted: true,
          potentiallySubmittingEvent: "enterKeyDown",
          retrySafe: false,
          recoverable: true,
          draftRetained: true,
          submissionDiagnostic: expect.objectContaining({
            initialDispatchMethod: "enter",
            retryEligible: false,
            retryBlockedReason: "potentially-submitting-event-emitted",
            alternateDispatchAttempted: false,
            alternateDispatchMethod: null,
            finalCommitClassification: "commit-indeterminate-after-dispatch",
            potentiallySubmittingEventEmitted: true,
            potentiallySubmittingEvent: "enterKeyDown",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(62_000);
      await assertion;

      expect(scenario.dispatchCount()).toBe(1);
      expect(onPromptDispatchEvent).toHaveBeenCalledTimes(1);
      expect(
        scenario.input.dispatchKeyEvent.mock.calls.filter(([event]) => event.type === "keyDown"),
      ).toHaveLength(1);
      expect(
        scenario.input.dispatchMouseEvent.mock.calls.filter(
          ([event]) => event.type === "mousePressed",
        ),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("remeasures the send point after scrolling invalidates the first rectangle", async () => {
    vi.useFakeTimers();
    try {
      const evaluate = vi
        .fn()
        .mockResolvedValueOnce({ result: { value: { status: "settling" } } })
        .mockResolvedValueOnce({ result: { value: { status: "point", x: 30, y: 40 } } })
        .mockResolvedValueOnce({ result: { value: { status: "point", x: 30, y: 40 } } });
      const input = { dispatchMouseEvent: vi.fn() };

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        undefined,
        undefined,
        "hello",
      );
      const assertion = expect(result).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(200);
      await assertion;

      expect(evaluate).toHaveBeenCalledTimes(3);
      expect(input.dispatchMouseEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: "mousePressed", x: 30, y: 40 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("remeasures the trusted send point after dispatch intent persistence", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ result: { value: { status: "point", x: 10, y: 20 } } })
      .mockResolvedValueOnce({ result: { value: { status: "point", x: 30, y: 40 } } })
      .mockResolvedValueOnce({ result: { value: { status: "point", x: 50, y: 60 } } });
    const input = { dispatchMouseEvent: vi.fn() };
    const persistDispatchIntent = vi.fn();
    const revalidateAfterDispatchIntent = vi.fn();

    await expect(
      promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        undefined,
        undefined,
        "hello",
        undefined,
        persistDispatchIntent,
        revalidateAfterDispatchIntent,
      ),
    ).resolves.toBe(true);

    expect(persistDispatchIntent).toHaveBeenCalledTimes(1);
    expect(revalidateAfterDispatchIntent).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(input.dispatchMouseEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "mousePressed", x: 50, y: 60 }),
    );
  });

  test("records the dispatch event after a transient post-intent attachment wait", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      let sendProbeCount = 0;
      const timeline: Array<{ event: string; at: number }> = [];
      const evaluate = vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("const expected =")) {
          return { result: { value: true } };
        }
        if (expression.includes("button.scrollIntoView")) {
          sendProbeCount += 1;
          return {
            result: {
              value:
                sendProbeCount === 2 ? { status: "missing" } : { status: "point", x: 10, y: 20 },
            },
          };
        }
        throw new Error("unexpected attachment dispatch probe");
      });
      const input = {
        dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
          if (type === "mousePressed") timeline.push({ event: "mousePressed", at: Date.now() });
        }),
      };
      const persistDispatchIntent = vi.fn(async () => {
        timeline.push({ event: "intent", at: Date.now() });
      });
      const recordDispatchEvent = vi.fn(async () => {
        timeline.push({ event: "dispatch-event", at: Date.now() });
      });

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        ["oracle-owned.txt"],
        1_000,
        "hello",
        recordDispatchEvent,
        persistDispatchIntent,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(500);

      await expect(result).resolves.toBe(true);
      expect(persistDispatchIntent).toHaveBeenCalledTimes(1);
      expect(recordDispatchEvent).toHaveBeenCalledTimes(1);
      expect(timeline).toEqual([
        { event: "intent", at: 0 },
        { event: "dispatch-event", at: 150 },
        { event: "mousePressed", at: 150 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("waits through a transient missing send button while an attachment finishes", async () => {
    vi.useFakeTimers();
    try {
      let sendProbeCount = 0;
      let dispatchCount = 0;
      const evaluate = vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("const expected =")) {
          return { result: { value: true } };
        }
        if (expression.includes("button.scrollIntoView")) {
          sendProbeCount += 1;
          return {
            result: {
              value:
                sendProbeCount === 1 ? { status: "missing" } : { status: "point", x: 10, y: 20 },
            },
          };
        }
        throw new Error("unexpected attachment send probe");
      });
      const input = {
        dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
          if (type === "mousePressed") dispatchCount += 1;
        }),
      };

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        ["oracle-owned.txt"],
        1_000,
        "hello",
      );
      await vi.advanceTimersByTimeAsync(500);

      await expect(result).resolves.toBe(true);
      expect(sendProbeCount).toBeGreaterThanOrEqual(3);
      expect(dispatchCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not press when the composer changes during pointer movement", async () => {
    let pointerMoved = false;
    const evaluate = vi.fn(async () => ({
      result: {
        value: pointerMoved
          ? { status: "mutated", observedLength: 6 }
          : { status: "point", x: 10, y: 20 },
      },
    }));
    const input = {
      dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
        if (type === "mouseMoved") pointerMoved = true;
      }),
    };

    await expect(
      promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        undefined,
        undefined,
        "hello",
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "composer-mutated-before-send",
      }),
    });

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(input.dispatchMouseEvent).toHaveBeenCalledTimes(1);
    expect(input.dispatchMouseEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "mouseMoved", x: 10, y: 20 }),
    );
  });

  test("does not press when the attachment set changes during pointer movement", async () => {
    vi.useFakeTimers();
    try {
      let pointerMoved = false;
      const evaluate = vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("const expected =")) {
          expect(expression).toContain("const requireExactSet = true");
          return { result: { value: !pointerMoved } };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "point", x: 10, y: 20 } } };
        }
        throw new Error("unexpected attachment dispatch probe");
      });
      const input = {
        dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
          if (type === "mouseMoved") pointerMoved = true;
        }),
      };

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        ["oracle-owned.txt"],
        1_000,
        "hello",
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({ code: "attachment-send-not-ready" }),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;

      expect(input.dispatchMouseEvent).toHaveBeenCalledTimes(1);
      expect(input.dispatchMouseEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "mouseMoved", x: 10, y: 20 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("requires the exact attachment set after dispatch intent persistence", async () => {
    vi.useFakeTimers();
    try {
      let intentPersisted = false;
      const evaluate = vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("const expected =")) {
          expect(expression).toContain("const requireExactSet = true");
          return { result: { value: !intentPersisted } };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "point", x: 10, y: 20 } } };
        }
        throw new Error("unexpected attachment dispatch probe");
      });
      const input = { dispatchMouseEvent: vi.fn() };
      const persistDispatchIntent = vi.fn(async () => {
        intentPersisted = true;
      });

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        ["oracle-owned.txt"],
        1_000,
        "hello",
        undefined,
        persistDispatchIntent,
        vi.fn(),
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({ code: "attachment-send-not-ready" }),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;

      expect(persistDispatchIntent).toHaveBeenCalledTimes(1);
      expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not replace an unavailable trusted point dispatch with a synthetic DOM click", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      result: { value: { status: "point", x: 30, y: 40 } },
    });

    await expect(
      promptComposer.attemptSendButton(
        { evaluate } as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        "hello",
      ),
    ).resolves.toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  test("keeps an attachment-bearing click indeterminate without alternate dispatch", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: true } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return { result: { value: { composerLength: 0, composerEmpty: true } } };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                  href: "https://chatgpt.com/",
                  documentTokenStored: true,
                },
              },
            };
          }
          if (expression.includes("const expected =")) {
            return { result: { value: true } };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "point", x: 10, y: 20 } } };
          }
          return {
            result: {
              value: {
                baseline: 0,
                turnsCount: 0,
                newUserTurnCount: 0,
                matchingUserTurnCount: 0,
                userMatched: false,
                matchedUserTurnIndex: null,
                lastMatched: false,
                hasNewTurn: false,
                stopVisible: false,
                assistantVisible: false,
                composerCleared: false,
                inConversation: false,
                editorValue: "hello",
              },
            },
          };
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(),
        dispatchKeyEvent: vi.fn(),
      };
      const page = { bringToFront: vi.fn() };
      const logger = Object.assign(vi.fn(), { verbose: false });
      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: page as never,
          attachmentNames: ["evidence.txt"],
          baselineTurns: 0,
          isSubmissionOwner: () => true,
        },
        "hello",
        logger as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "commit-indeterminate-after-dispatch",
          outcome: "indeterminate",
          retrySafe: false,
          draftRetained: true,
          submissionDiagnostic: expect.objectContaining({
            initialDispatchMethod: "trusted-click",
            targetActivationAttempted: true,
            targetActivationVerified: true,
            preDispatchBaseline: 0,
            composerLengthBeforeDispatch: 5,
            composerCleared: false,
            draftRetained: true,
            newUserTurnObserved: false,
            matchingUserTurnObserved: false,
            assistantObserved: false,
            generationControlObserved: false,
            retryEligible: false,
            retryBlockedReason: "potentially-submitting-event-emitted",
            alternateDispatchAttempted: false,
            alternateDispatchMethod: null,
            finalCommitClassification: "commit-indeterminate-after-dispatch",
            ownershipVerified: true,
            potentiallySubmittingEventEmitted: true,
            potentiallySubmittingEvent: "mousePressed",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(61_000);
      await assertion;

      expect(input.dispatchMouseEvent).toHaveBeenCalledTimes(3);
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears only the exact owned pre-dispatch draft after attachment readiness fails", async () => {
    vi.useFakeTimers();
    try {
      const isSubmissionOwner = vi.fn(async () => true);
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: true } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
            };
          }
          if (expression.includes("oracle-owned-draft-cleanup-precheck")) {
            return { result: { value: { matches: true } } };
          }
          if (expression.includes("const cleanupMode = true")) {
            return { result: { value: { exactSetMatched: true, removeClicks: 1 } } };
          }
          if (expression.includes("oracle-owned-draft-cleanup-final-verify")) {
            return {
              result: {
                value: { composerFound: true, composerEmpty: true, attachmentSetEmpty: true },
              },
            };
          }
          if (expression.includes("const expected = []")) {
            return { result: { value: true } };
          }
          if (expression.startsWith("document.querySelectorAll")) {
            return { result: { value: 0 } };
          }
          if (expression.includes("oracle-owned-draft-cleanup-verify")) {
            return { result: { value: { composerFound: true, empty: true } } };
          }
          if (expression.includes("oracle-owned-draft-cleanup")) {
            return { result: { value: { cleared: true } } };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                },
              },
            };
          }
          if (expression.includes("const expected =")) {
            return { result: { value: true } };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "settling" } } };
          }
          throw new Error("commit verification must not run without a dispatch");
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(),
        dispatchKeyEvent: vi.fn(),
      };
      const page = { bringToFront: vi.fn() };

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: page as never,
          attachmentNames: ["evidence.txt"],
          attachmentTimeoutMs: 1_000,
          baselineTurns: 0,
          isSubmissionOwner,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "attachment-send-not-ready",
          submissionCommitted: false,
          dispatchAttempted: false,
          potentiallySubmittingEventEmitted: false,
          draftRetained: false,
          retrySafe: true,
          recoverable: false,
          cleanupVerified: true,
          submissionDiagnostic: expect.objectContaining({
            composerMatchedPromptBeforeDispatch: true,
            ownedAttachmentCleanupAttempted: true,
            ownedAttachmentSetVerified: true,
            ownedAttachmentCleanupSucceeded: true,
            ownedDraftCleanupAttempted: true,
            ownedDraftCleanupSucceeded: true,
            potentiallySubmittingEventEmitted: false,
            retryEligible: true,
            retryBlockedReason: null,
            finalCommitClassification: "safe-pre-dispatch-cleanup",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await assertion;

      expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retains the exact tab when the pre-dispatch draft no longer exactly matches", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: true } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
            };
          }
          if (expression.includes("oracle-owned-draft-cleanup-precheck")) {
            return { result: { value: { matches: false } } };
          }
          if (expression.includes("oracle-owned-draft-cleanup")) {
            return { result: { value: { cleared: false } } };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                },
              },
            };
          }
          if (expression.includes("const expected =")) {
            return { result: { value: true } };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "settling" } } };
          }
          throw new Error("commit verification must not run without a dispatch");
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(),
        dispatchKeyEvent: vi.fn(),
      };

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          attachmentNames: ["evidence.txt"],
          attachmentTimeoutMs: 1_000,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "attachment-send-not-ready",
          submissionCommitted: false,
          draftRetained: true,
          retrySafe: false,
          recoverable: true,
          cleanupVerified: false,
          submissionDiagnostic: expect.objectContaining({
            ownedAttachmentCleanupAttempted: false,
            ownedAttachmentSetVerified: false,
            ownedAttachmentCleanupSucceeded: false,
            ownedDraftCleanupAttempted: false,
            ownedDraftCleanupSucceeded: false,
            potentiallySubmittingEventEmitted: false,
            retryEligible: false,
            retryBlockedReason: "owned-pre-dispatch-cleanup-unverified",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;

      expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retains the exact draft when an attachment remains after targeted cleanup", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: true } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
            };
          }
          if (expression.includes("oracle-owned-draft-cleanup-precheck")) {
            return { result: { value: { matches: true } } };
          }
          if (expression.includes("const cleanupMode = true")) {
            return { result: { value: { exactSetMatched: true, removeClicks: 1 } } };
          }
          if (expression.includes("const expected = []")) {
            return { result: { value: false } };
          }
          if (expression.startsWith("document.querySelectorAll")) {
            return { result: { value: 0 } };
          }
          if (expression.includes("oracle-owned-draft-cleanup")) {
            throw new Error("draft cleanup must not run while an attachment remains");
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                },
              },
            };
          }
          if (expression.includes("const expected =")) {
            return { result: { value: true } };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "settling" } } };
          }
          throw new Error("commit verification must not run without a dispatch");
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(),
        dispatchKeyEvent: vi.fn(),
      };

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          attachmentNames: ["evidence.txt"],
          attachmentTimeoutMs: 1_000,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "attachment-send-not-ready",
          submissionCommitted: false,
          draftRetained: true,
          retrySafe: false,
          recoverable: true,
          cleanupVerified: false,
          cleanupFailure: "composer attachment set was not empty after targeted cleanup",
          submissionDiagnostic: expect.objectContaining({
            ownedAttachmentCleanupAttempted: true,
            ownedAttachmentCleanupSucceeded: false,
            ownedDraftCleanupAttempted: false,
            potentiallySubmittingEventEmitted: false,
            retryEligible: false,
            retryBlockedReason: "owned-pre-dispatch-cleanup-unverified",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;

      expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retains the exact tab when an attachment appears during prompt cleanup", async () => {
    vi.useFakeTimers();
    try {
      let emptyAttachmentChecks = 0;
      let finalCleanupChecks = 0;
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: true } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return {
              result: { value: { composerFound: true, composerLength: 0, composerEmpty: true } },
            };
          }
          if (expression.includes("oracle-owned-draft-cleanup-precheck")) {
            return { result: { value: { matches: true } } };
          }
          if (expression.includes("const cleanupMode = true")) {
            return { result: { value: { exactSetMatched: true, removeClicks: 1 } } };
          }
          if (expression.includes("oracle-owned-draft-cleanup-final-verify")) {
            finalCleanupChecks += 1;
            return {
              result: {
                value: { composerFound: true, composerEmpty: true, attachmentSetEmpty: false },
              },
            };
          }
          if (expression.includes("const expected = []")) {
            emptyAttachmentChecks += 1;
            return { result: { value: true } };
          }
          if (expression.startsWith("document.querySelectorAll")) {
            return { result: { value: 0 } };
          }
          if (expression.includes("oracle-owned-draft-cleanup-verify")) {
            return { result: { value: { composerFound: true, empty: true } } };
          }
          if (expression.includes("oracle-owned-draft-cleanup")) {
            return { result: { value: { cleared: true } } };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                },
              },
            };
          }
          if (expression.includes("const expected =")) {
            return { result: { value: true } };
          }
          if (expression.includes("button.scrollIntoView")) {
            return { result: { value: { status: "settling" } } };
          }
          throw new Error("commit verification must not run without a dispatch");
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchMouseEvent: vi.fn(),
        dispatchKeyEvent: vi.fn(),
      };

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          page: { bringToFront: vi.fn() } as never,
          attachmentNames: ["evidence.txt"],
          attachmentTimeoutMs: 1_000,
          baselineTurns: 0,
          isSubmissionOwner: async () => true,
        },
        "hello",
        Object.assign(vi.fn(), { verbose: false }) as never,
      );
      const assertion = expect(result).rejects.toMatchObject({
        details: expect.objectContaining({
          code: "attachment-send-not-ready",
          submissionCommitted: false,
          draftRetained: true,
          retrySafe: false,
          recoverable: true,
          cleanupVerified: false,
          cleanupFailure: "composer state changed during final cleanup verification",
          submissionDiagnostic: expect.objectContaining({
            ownedAttachmentCleanupAttempted: true,
            ownedAttachmentCleanupSucceeded: true,
            ownedDraftCleanupAttempted: true,
            ownedDraftCleanupSucceeded: true,
            potentiallySubmittingEventEmitted: false,
            retryEligible: false,
            retryBlockedReason: "owned-pre-dispatch-cleanup-unverified",
          }),
        }),
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await assertion;

      expect(emptyAttachmentChecks).toBe(1);
      expect(finalCleanupChecks).toBe(1);
      expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("sends without activating the ChatGPT page", async () => {
    const actions: string[] = [];
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "point", x: 10, y: 20 } } };
        }
        return {
          result: {
            value: {
              baseline: 0,
              turnsCount: 1,
              userMatched: true,
              prefixMatched: false,
              lastMatched: true,
              hasNewTurn: true,
              stopVisible: true,
              assistantVisible: false,
              composerCleared: true,
              inConversation: true,
            },
          },
        };
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
        if (type === "mousePressed") actions.push("send-click");
      }),
    };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await submitPrompt(
      {
        runtime: runtime as never,
        input: input as never,
        baselineTurns: 0,
      },
      "hello",
      logger as never,
    );

    expect(actions).toEqual(["send-click"]);
  });

  test("uses a fallback baseline without creating a second dispatch", async () => {
    vi.useFakeTimers();
    try {
      let commitProbes = 0;
      let fallbackCountReads = 0;
      let sendDispatched = false;
      const isSubmissionOwner = vi.fn(() => true);
      const runtime = {
        evaluate: vi.fn(async ({ expression }: { expression: string }) => {
          if (expression.includes("document.readyState")) {
            return { result: { value: { ready: true, composer: true, fileInput: false } } };
          }
          if (expression.includes("oracle-preexisting-composer-check")) {
            return { result: { value: { composerLength: 0, composerEmpty: true } } };
          }
          if (expression.includes("focused: true")) {
            return { result: { value: { focused: true, bound: true } } };
          }
          if (expression.includes("editorText")) {
            return {
              result: {
                value: {
                  boundFound: true,
                  editorText: "hello",
                  fallbackValue: "",
                  activeValue: "hello",
                  href: "https://chatgpt.com/",
                  documentTokenStored: true,
                },
              },
            };
          }
          if (expression.includes("button.scrollIntoView")) {
            sendDispatched = true;
            return { result: { value: { status: "point", x: 10, y: 20 } } };
          }
          if (expression.trimEnd().endsWith(").length")) {
            fallbackCountReads += 1;
            return { result: { value: 1 } };
          }
          commitProbes += 1;
          const committed = commitProbes >= 25;
          return {
            result: {
              value: {
                baseline: 1,
                turnsCount: committed ? 2 : 1,
                userMatched: committed,
                matchedUserTurnIndex: committed ? 1 : null,
                lastMatched: committed,
                hasNewTurn: committed,
                stopVisible: committed,
                assistantVisible: false,
                composerCleared: committed,
                inConversation: committed,
                editorValue: committed ? "" : "hello",
              },
            },
          };
        }),
      };
      const input = {
        insertText: vi.fn(),
        dispatchKeyEvent: vi.fn(),
        dispatchMouseEvent: vi.fn(),
      };
      const logger = Object.assign(vi.fn(), { verbose: false });

      const result = submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: null,
          isSubmissionOwner,
        },
        "hello",
        logger as never,
      );
      const assertion = expect(result).resolves.toBe(2);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      expect(sendDispatched).toBe(true);
      expect(fallbackCountReads).toBe(1);
      expect(isSubmissionOwner).not.toHaveBeenCalled();
      expect(
        input.dispatchMouseEvent.mock.calls.filter(([event]) => event.type === "mousePressed"),
      ).toHaveLength(1);
      expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("refuses to send when external input mutates the composer", async () => {
    let composerRead = 0;
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          composerRead += 1;
          const value = composerRead === 1 ? "hello" : "hellox";
          return {
            result: {
              value: { boundFound: true, editorText: value, fallbackValue: "", activeValue: value },
            },
          };
        }
        throw new Error("send must not be attempted after composer mutation");
      }),
    };
    const input = { insertText: vi.fn(), dispatchKeyEvent: vi.fn() };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
        },
        "hello",
        logger as never,
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Prompt composer changed after Oracle populated it/i),
      details: {
        code: "composer-mutated-before-send",
        submissionCommitted: false,
        draftRetained: true,
        expectedLength: 5,
        observedLength: 6,
      },
    });
    expect(runtime.evaluate).not.toHaveBeenCalledWith(
      expect.objectContaining({ expression: expect.stringContaining("button.scrollIntoView") }),
    );
  });

  test("refuses a mutation that arrives while the send button is settling", async () => {
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "mutated", observedLength: 6 } } };
        }
        return { result: { value: true } };
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(),
    };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
        },
        "hello",
        logger as never,
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "composer-mutated-before-send",
        submissionCommitted: false,
        expectedLength: 5,
        observedLength: 6,
      }),
    });
    expect(input.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
  });

  test("keeps a post-dispatch page gate indeterminate", async () => {
    const onPromptDispatched = vi.fn();
    const onPromptCommitted = vi.fn();
    const gateError = new Error("request frequency gate");
    const runtime = {
      evaluate: vi.fn(async ({ expression }: { expression: string }) => {
        if (expression.includes("document.readyState")) {
          return { result: { value: { ready: true, composer: true, fileInput: false } } };
        }
        if (expression.includes("oracle-preexisting-composer-check")) {
          return { result: { value: { composerLength: 0, composerEmpty: true } } };
        }
        if (expression.includes("focused: true")) {
          return { result: { value: { focused: true, bound: true } } };
        }
        if (expression.includes("editorText")) {
          return {
            result: {
              value: {
                boundFound: true,
                editorText: "hello",
                fallbackValue: "",
                activeValue: "hello",
              },
            },
          };
        }
        if (expression.includes("button.scrollIntoView")) {
          return { result: { value: { status: "point", x: 10, y: 20 } } };
        }
        return {
          result: {
            value: {
              baseline: 0,
              turnsCount: 0,
              userMatched: false,
              prefixMatched: false,
              lastMatched: false,
              hasNewTurn: false,
              stopVisible: false,
              assistantVisible: false,
              composerCleared: false,
              inConversation: false,
            },
          },
        };
      }),
    };
    const input = {
      insertText: vi.fn(),
      dispatchKeyEvent: vi.fn(),
      dispatchMouseEvent: vi.fn(),
    };
    const logger = Object.assign(vi.fn(), { verbose: false });

    await expect(
      submitPrompt(
        {
          runtime: runtime as never,
          input: input as never,
          baselineTurns: 0,
          onPromptDispatched,
          onPromptCommitted,
          onPromptCommitPending: () => {
            throw gateError;
          },
        },
        "hello",
        logger as never,
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        code: "commit-indeterminate-after-dispatch",
        outcome: "indeterminate",
        retrySafe: false,
      }),
    });

    expect(onPromptDispatched).toHaveBeenCalledTimes(1);
    expect(onPromptCommitted).not.toHaveBeenCalled();
    expect(
      input.dispatchMouseEvent.mock.calls.filter(([event]) => event.type === "mousePressed"),
    ).toHaveLength(1);
    expect(input.dispatchKeyEvent).not.toHaveBeenCalled();
  });

  test("waits for a delayed trusted click without issuing a second send", async () => {
    vi.useFakeTimers();
    try {
      const evaluate = vi.fn().mockResolvedValue({
        result: { value: { status: "point", x: 10, y: 20 } },
      });
      const input = {
        dispatchMouseEvent: vi.fn(async ({ type }: { type: string }) => {
          if (type === "mouseReleased") {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        }),
      };

      const result = promptComposer.attemptSendButton(
        { evaluate } as never,
        input as never,
        undefined,
        undefined,
      );
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBe(true);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(input.dispatchMouseEvent).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
