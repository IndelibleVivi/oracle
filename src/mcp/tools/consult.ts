import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { finished } from "node:stream/promises";
import { z } from "zod";
import { getCliVersion } from "../../version.js";
import {
  LoggingMessageNotificationParamsSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureBrowserAvailable, mapConsultToRunOptions } from "../utils.js";
import type { RunOracleOptions } from "../../oracle.js";
import type { EngineMode } from "../../cli/engine.js";
import type { BrowserSessionConfig, SessionArtifact, SessionModelRun } from "../../sessionStore.js";
import { sessionStore } from "../../sessionStore.js";
import { resolveRemoteServiceConfig } from "../../remote/remoteServiceConfig.js";
import { createRemoteBrowserExecutor } from "../../remote/client.js";
import type { BrowserSessionRunnerDeps } from "../../browser/sessionRunner.js";

export function projectConsultLog(log: string, sessionId: string, maxCharacters = 4000) {
  let output = log.length > maxCharacters ? log.slice(-maxCharacters) : log;
  // A UTF-16 slice may start halfway through an emoji or another astral character.
  if (output && /[\uDC00-\uDFFF]/u.test(output[0] ?? "")) output = output.slice(1);
  return {
    output,
    outputTruncated: output.length < log.length,
    logBytes: Buffer.byteLength(log, "utf8"),
    logResourceUri: `oracle-session://${encodeURIComponent(sessionId)}/log`,
  };
}
import { performSessionRun } from "../../cli/sessionRunner.js";
import { runDryRunSummary } from "../../cli/dryRun.js";
import { CHATGPT_URL } from "../../browser/constants.js";
import { CONSULT_PRESETS, browserThinkingTimeRawSchema, consultInputSchema } from "../types.js";
import { applyConsultPreset } from "../consultPresets.js";
import { loadUserConfig, type UserConfig } from "../../config.js";
import { resolveNotificationSettings } from "../../cli/notifier.js";
import { mapModelToBrowserLabel, resolveBrowserModelLabel } from "../../cli/browserConfig.js";
import type { BrowserModelStrategy } from "../../browser/types.js";
import { normalizeThinkingTimeLevel } from "../../oracle/thinkingTime.js";
import type { ThinkingTimeLevel } from "../../oracle/types.js";

// Use raw shapes so the MCP SDK (with its bundled Zod) wraps them and emits valid JSON Schema.
const consultInputShape = {
  preset: z
    .enum(CONSULT_PRESETS)
    .optional()
    .describe(
      'Optional MCP convenience preset. "chatgpt-pro-heavy" selects ChatGPT browser mode, the current Pro model alias, and Pro Extended thinking unless overridden.',
    ),
  prompt: z.string().min(1, "Prompt is required.").describe("User prompt to run."),
  files: z
    .array(z.string())
    .default([])
    .describe(
      "Optional file paths or glob patterns (like the CLI `--file`). Resolved relative to the MCP server working directory.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Single model name/label. If `engine` is omitted, Oracle follows CLI defaults: config/ORACLE_ENGINE first, then `api` when OPENAI_API_KEY is set, otherwise `browser`. Prefer setting `engine` explicitly to avoid default surprises.",
    ),
  models: z
    .array(z.string())
    .optional()
    .describe("Multi-model fan-out (API engine only). Cannot be combined with browser automation."),
  engine: z
    .enum(["api", "browser", "broker"])
    .optional()
    .describe(
      "Execution engine. `broker` is the opt-in Oracle v2 durable worker path; legacy `api` and `browser` defaults remain unchanged until G3.",
    ),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Stable logical key for broker retries; the same key and inputs return one job."),
  waitTimeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Broker-only MCP host wait budget. Expiry returns jobId + state while the worker continues.",
    ),
  browserModelLabel: z
    .string()
    .optional()
    .describe(
      'Browser-only: explicit ChatGPT UI label to select (overrides model mapping). Example: "GPT-5.2 Thinking".',
    ),
  browserAttachments: z
    .enum(["auto", "never", "always"])
    .optional()
    .describe(
      'Browser-only: how to deliver `files`. Use "always" for real ChatGPT file uploads (including images/PDFs). Use "never" to paste file contents inline. "auto" chooses based on prompt size.',
    ),
  browserBundleFiles: z
    .boolean()
    .optional()
    .describe("Browser-only: bundle many files into a single upload (helps with upload limits)."),
  browserBundleFormat: z
    .enum(["auto", "text", "zip"])
    .optional()
    .describe(
      'Browser-only: bundle upload format when browserBundleFiles is true or auto-bundling is needed. Defaults to "auto"; "auto" uses ZIP when bundled inputs include raw/binary files.',
    ),
  browserThinkingTime: browserThinkingTimeRawSchema
    .optional()
    .describe("Browser-only: set ChatGPT thinking time when supported by the chosen model."),
  browserModelStrategy: z
    .enum(["select", "current", "ignore"])
    .optional()
    .describe(
      "Browser-only: model picker strategy. Mirrors the CLI --browser-model-strategy flag.",
    ),
  browserResearchMode: z
    .enum(["deep"])
    .optional()
    .describe("Browser-only: activate ChatGPT Deep Research mode for broad web research."),
  browserFollowUps: z
    .array(z.string())
    .optional()
    .describe(
      "Browser-only: additional prompts to submit sequentially in the same ChatGPT conversation after the initial answer.",
    ),
  browserKeepBrowser: z
    .boolean()
    .optional()
    .describe("Browser-only: keep Chrome running after completion (useful for debugging)."),
  generateImage: z
    .string()
    .optional()
    .describe(
      "Browser-only: save generated image(s) to this file path. For ChatGPT browser mode this enables the image-aware wait/download path used by CLI --generate-image.",
    ),
  outputPath: z
    .string()
    .optional()
    .describe(
      "Browser-only image output fallback path, mirroring the CLI --output option for image operations.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "Preview the resolved Oracle run without creating a session or touching the browser.",
    ),
  search: z
    .boolean()
    .optional()
    .describe("API-only: enable/disable the provider search tool (browser engine ignores this)."),
  slug: z
    .string()
    .optional()
    .describe("Optional human-friendly session id (used for later `oracle sessions` lookups)."),
} satisfies z.ZodRawShape;

const consultModelSummaryShape = z.object({
  model: z.string(),
  status: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      reasoningTokens: z.number().optional(),
      totalTokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
  response: z
    .object({
      id: z.string().optional(),
      requestId: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      category: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  logPath: z.string().optional(),
});

const consultArtifactSummaryShape = z.object({
  kind: z.enum(["transcript", "deep-research-report", "image", "file"]),
  path: z.string(),
  label: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
});

const consultImageSummaryShape = consultArtifactSummaryShape.extend({
  kind: z.literal("image"),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fileId: z.string().optional(),
});

const consultDryRunResolvedShape = z.object({
  resolvedEngine: z.enum(["api", "browser"]),
  model: z.string(),
  models: z.array(z.string()).optional(),
  files: z.array(z.string()),
  followUpCount: z.number(),
  browser: z
    .object({
      desiredModel: z.string().nullable().optional(),
      thinkingTime: z.string().nullable().optional(),
      modelStrategy: z.string().nullable().optional(),
      researchMode: z.string().nullable().optional(),
      attachments: z.string().optional(),
      bundleFiles: z.boolean().optional(),
      bundleFormat: z.enum(["auto", "text", "zip"]).optional(),
      browserLifetime: z.enum(["ephemeral", "while-needed", "persistent"]).optional(),
      keepBrowser: z.boolean().optional(),
      manualLogin: z.boolean().optional(),
      profileDir: z.string().nullable().optional(),
      chatgptUrl: z.string().nullable().optional(),
      imageOutputPath: z.string().nullable().optional(),
    })
    .optional(),
  guidance: z.array(z.string()),
});

export const consultOutputShape = {
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  status: z.string(),
  state: z.string().optional(),
  output: z.string(),
  outputTruncated: z.boolean().optional(),
  logBytes: z.number().int().nonnegative().optional(),
  logResourceUri: z.string().optional(),
  dryRun: z.boolean().optional(),
  timedOut: z.boolean().optional(),
  resolved: consultDryRunResolvedShape.optional(),
  models: z.array(consultModelSummaryShape).optional(),
  artifacts: z.array(consultArtifactSummaryShape).optional(),
  images: z.array(consultImageSummaryShape).optional(),
} satisfies z.ZodRawShape;

export type ConsultModelSummary = z.infer<typeof consultModelSummaryShape>;
export type ConsultArtifactSummary = z.infer<typeof consultArtifactSummaryShape>;
export type ConsultImageSummary = z.infer<typeof consultImageSummaryShape>;
export type ConsultDryRunResolved = z.infer<typeof consultDryRunResolvedShape>;

export function summarizeModelRunsForConsult(
  runs?: SessionModelRun[] | null,
): ConsultModelSummary[] | undefined {
  if (!runs || runs.length === 0) {
    return undefined;
  }
  return runs.map((run) => {
    const response = run.response
      ? {
          id: run.response.id ?? undefined,
          requestId: run.response.requestId ?? undefined,
          status: run.response.status ?? undefined,
        }
      : undefined;
    const error = run.error
      ? {
          category: run.error.category,
          message: run.error.message,
        }
      : undefined;
    return {
      model: run.model,
      status: run.status ?? "unknown",
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      usage: run.usage,
      response,
      error,
      logPath: run.log?.path,
    };
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function summarizeArtifactsForConsult(
  artifacts?: SessionArtifact[] | null,
): ConsultArtifactSummary[] | undefined {
  if (!artifacts || artifacts.length === 0) {
    return undefined;
  }
  return artifacts.map((artifact) => ({
    kind: artifact.kind,
    path: artifact.path,
    label: artifact.label,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
  }));
}

export function summarizeImageArtifactsForConsult(
  artifacts?: SessionArtifact[] | null,
): ConsultImageSummary[] | undefined {
  const images = (artifacts ?? [])
    .filter((artifact) => artifact.kind === "image")
    .map((artifact) => {
      const image = artifact as SessionArtifact & Record<string, unknown>;
      return {
        kind: "image" as const,
        path: artifact.path,
        label: artifact.label,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        alt: optionalString(image.alt),
        width: optionalNumber(image.width),
        height: optionalNumber(image.height),
        fileId: optionalString(image.fileId),
      };
    });
  return images.length > 0 ? images : undefined;
}

export function buildConsultBrowserConfig({
  userConfig,
  env,
  runModel,
  inputModel,
  browserModelLabel,
  browserThinkingTime,
  browserModelStrategy,
  browserResearchMode,
  browserKeepBrowser,
}: {
  userConfig: UserConfig;
  env: Record<string, string | undefined>;
  runModel: string;
  inputModel?: string;
  browserModelLabel?: string;
  browserThinkingTime?: ThinkingTimeLevel;
  browserModelStrategy?: BrowserModelStrategy;
  browserResearchMode?: "deep";
  browserKeepBrowser?: boolean;
}): BrowserSessionConfig {
  const configuredBrowser = userConfig.browser ?? {};
  const envProfileDir = (env.ORACLE_BROWSER_PROFILE_DIR ?? "").trim();
  const hasProfileDir = envProfileDir.length > 0;
  const preferredLabel = (browserModelLabel ?? inputModel)?.trim();
  const isChatGptModel = runModel.startsWith("gpt-") && !runModel.includes("codex");
  const desiredModelLabel = isChatGptModel
    ? mapModelToBrowserLabel(runModel)
    : resolveBrowserModelLabel(preferredLabel, runModel);
  const configuredUrl = configuredBrowser.chatgptUrl ?? configuredBrowser.url ?? CHATGPT_URL;
  const transport = configuredBrowser.transport ?? "cdp";
  const manualLogin =
    transport === "cdp" ? (hasProfileDir ? true : (configuredBrowser.manualLogin ?? true)) : false;
  const configuredThinkingTime = normalizeThinkingTimeLevel(configuredBrowser.thinkingTime);

  return {
    ...configuredBrowser,
    url: configuredUrl,
    chatgptUrl: configuredUrl,
    cookieSync: !manualLogin,
    headless: configuredBrowser.headless ?? false,
    hideWindow: configuredBrowser.hideWindow ?? false,
    browserLifetime:
      browserKeepBrowser !== undefined
        ? browserKeepBrowser
          ? "persistent"
          : "ephemeral"
        : (configuredBrowser.browserLifetime ??
          (configuredBrowser.keepBrowser !== undefined
            ? configuredBrowser.keepBrowser
              ? "persistent"
              : "ephemeral"
            : manualLogin
              ? "while-needed"
              : "ephemeral")),
    keepBrowser: browserKeepBrowser ?? configuredBrowser.keepBrowser,
    manualLogin,
    manualLoginProfileDir: manualLogin
      ? ((envProfileDir || configuredBrowser.manualLoginProfileDir) ?? null)
      : null,
    thinkingTime: browserThinkingTime ?? configuredThinkingTime ?? undefined,
    modelStrategy: browserModelStrategy ?? configuredBrowser.modelStrategy,
    researchMode: browserResearchMode ?? configuredBrowser.researchMode,
    desiredModel: desiredModelLabel || mapModelToBrowserLabel(runModel),
  };
}

export function buildConsultDryRunResolved({
  resolvedEngine,
  runOptions,
  browserConfig,
}: {
  resolvedEngine: "api" | "browser";
  runOptions: ReturnType<typeof mapConsultToRunOptions>["runOptions"];
  browserConfig?: BrowserSessionConfig;
}): ConsultDryRunResolved {
  const guidance: string[] = [];
  const followUpCount = runOptions.browserFollowUps?.filter((entry) => entry.trim()).length ?? 0;
  if (resolvedEngine === "api") {
    guidance.push(
      'API engine requires provider credentials. If the operator has ChatGPT Pro but no API key, retry with engine:"browser" or preset:"chatgpt-pro-heavy".',
    );
  }
  if (resolvedEngine === "browser") {
    guidance.push(
      "Browser engine uses the signed-in ChatGPT profile; run dryRun:true before live use.",
    );
    if (browserConfig?.manualLogin) {
      const profile = browserConfig.manualLoginProfileDir ?? "~/.oracle/browser-profile";
      guidance.push(
        `Dedicated-profile browser mode uses Oracle's Chrome for Testing app and private Chrome profile at ${profile}, separate from your normal Chrome app and profile.`,
      );
      guidance.push(
        `First-time setup: run oracle browser install, then oracle browser setup --profile-dir ${JSON.stringify(profile)}, sign into ChatGPT in that window, close the entire browser, and run oracle browser smoke --profile-dir ${JSON.stringify(profile)} before retrying the consult. Neither command submits a prompt.`,
      );
      guidance.push(
        "If this profile is not signed in, non-setup MCP/browser runs fail fast instead of waiting for the full browser timeout.",
      );
    }
  }
  const desiredModel = browserConfig?.desiredModel ?? null;
  const thinkingTime = browserConfig?.thinkingTime ?? null;
  if (runOptions.model === "gpt-5.5-pro" && thinkingTime === "heavy") {
    guidance.push(
      'gpt-5.5-pro should normally use Pro Extended. Use model:"gpt-5.5" with browserThinkingTime:"heavy" only when you explicitly want Thinking Heavy.',
    );
  }
  const chatgptUrl = browserConfig?.chatgptUrl ?? browserConfig?.url ?? null;
  if (chatgptUrl?.includes("/project")) {
    guidance.push(
      "This ChatGPT project URL is persistent. Project Sources should be mutated only by the project_sources tool with confirmMutation:true.",
    );
  }
  if (followUpCount > 0) {
    guidance.push(
      "This is a multi-turn browser consult; all follow-ups stay in one ChatGPT conversation.",
    );
  }
  const imageOutputPath = runOptions.generateImage ?? runOptions.outputPath ?? null;
  if (resolvedEngine === "browser" && imageOutputPath) {
    guidance.push(
      "ChatGPT generated images will use the image-aware wait/download path and return saved files in structuredContent.images.",
    );
  }
  return {
    resolvedEngine,
    model: runOptions.model,
    models: runOptions.models,
    files: runOptions.file ?? [],
    followUpCount,
    browser:
      resolvedEngine === "browser"
        ? {
            desiredModel,
            thinkingTime,
            modelStrategy: browserConfig?.modelStrategy ?? null,
            researchMode: browserConfig?.researchMode ?? null,
            attachments: runOptions.browserAttachments,
            bundleFiles: runOptions.browserBundleFiles,
            bundleFormat: runOptions.browserBundleFormat,
            browserLifetime: browserConfig?.browserLifetime,
            keepBrowser: browserConfig?.keepBrowser,
            manualLogin: browserConfig?.manualLogin,
            profileDir: browserConfig?.manualLoginProfileDir ?? null,
            chatgptUrl,
            imageOutputPath,
          }
        : undefined,
    guidance,
  };
}

export function formatConsultDryRunResolved(details: ConsultDryRunResolved): string[] {
  const lines = [
    "[dry-run] MCP resolved request:",
    `  engine: ${details.resolvedEngine}`,
    `  model: ${details.model}`,
  ];
  if (details.models && details.models.length > 0) {
    lines.push(`  models: ${details.models.join(", ")}`);
  }
  lines.push(`  files: ${details.files.length}`);
  if (details.browser) {
    lines.push(`  browser desired model: ${details.browser.desiredModel ?? "(default)"}`);
    lines.push(`  browser thinking time: ${details.browser.thinkingTime ?? "(default)"}`);
    lines.push(`  browser model strategy: ${details.browser.modelStrategy ?? "(default)"}`);
    lines.push(`  browser research mode: ${details.browser.researchMode ?? "off"}`);
    lines.push(`  browser attachments: ${details.browser.attachments ?? "auto"}`);
    lines.push(`  browser bundle files: ${details.browser.bundleFiles ? "yes" : "no"}`);
    lines.push(`  browser bundle format: ${details.browser.bundleFormat ?? "auto"}`);
    lines.push(`  browser lifetime: ${details.browser.browserLifetime ?? "(default)"}`);
    lines.push(`  browser keep browser: ${details.browser.keepBrowser ? "yes" : "no"}`);
    lines.push(`  browser manual login: ${details.browser.manualLogin ? "yes" : "no"}`);
    if (details.browser.profileDir) {
      lines.push(`  browser profile: ${details.browser.profileDir}`);
    }
    if (details.browser.chatgptUrl) {
      lines.push(`  ChatGPT URL: ${details.browser.chatgptUrl}`);
    }
    if (details.browser.imageOutputPath) {
      lines.push(`  image output: ${details.browser.imageOutputPath}`);
    }
  }
  lines.push(`  follow-ups: ${details.followUpCount}`);
  for (const guidance of details.guidance) {
    lines.push(`  guidance: ${guidance}`);
  }
  return lines;
}

type McpLoggingServer = Pick<McpServer["server"], "sendLoggingMessage">;

export async function runConsultTool(
  input: unknown,
  { server }: { server: McpLoggingServer },
): Promise<CallToolResult> {
  const textContent = (text: string) => [{ type: "text" as const, text }];
  let parsedInput;
  try {
    parsedInput = applyConsultPreset(consultInputSchema.parse(input));
  } catch (error) {
    return {
      isError: true,
      content: textContent(error instanceof Error ? error.message : String(error)),
    };
  }
  const {
    prompt,
    files,
    model,
    models,
    engine,
    idempotencyKey,
    waitTimeoutMs,
    search,
    browserModelLabel,
    browserAttachments,
    browserBundleFiles,
    browserBundleFormat,
    browserThinkingTime,
    browserModelStrategy,
    browserResearchMode,
    browserFollowUps,
    browserKeepBrowser,
    generateImage,
    outputPath,
    dryRun,
    slug,
  } = parsedInput;
  const { config: userConfig } = await loadUserConfig();
  const brokerRequested =
    engine === "broker" ||
    (!engine && (process.env.ORACLE_ENGINE ?? "").trim().toLowerCase() === "broker");
  if (brokerRequested && models && models.length > 0) {
    return {
      isError: true,
      content: textContent("Oracle broker supports exactly one GPT-5.6 Sol / Pro route."),
    };
  }
  let runOptions: RunOracleOptions;
  let resolvedEngine: EngineMode;
  try {
    ({ runOptions, resolvedEngine } = mapConsultToRunOptions({
      prompt,
      files: files ?? [],
      model,
      models,
      engine,
      search,
      browserAttachments,
      browserBundleFiles,
      browserBundleFormat,
      browserFollowUps,
      generateImage,
      outputPath,
      userConfig,
      env: process.env,
    }));
  } catch (error) {
    return {
      isError: true,
      content: textContent(error instanceof Error ? error.message : String(error)),
    };
  }
  const cwd = process.cwd();
  const sendLog = (text: string, level: "info" | "debug" = "info") =>
    server
      .sendLoggingMessage(
        LoggingMessageNotificationParamsSchema.parse({
          level,
          data: { text, bytes: Buffer.byteLength(text, "utf8") },
        }),
      )
      .catch(() => {});

  if (resolvedEngine === "broker") {
    const browserOnlyInput =
      browserModelLabel !== undefined ||
      browserAttachments !== undefined ||
      browserBundleFiles !== undefined ||
      browserBundleFormat !== undefined ||
      browserThinkingTime !== undefined ||
      browserModelStrategy !== undefined ||
      browserResearchMode !== undefined ||
      (browserFollowUps?.length ?? 0) > 0 ||
      browserKeepBrowser !== undefined ||
      generateImage !== undefined ||
      outputPath !== undefined;
    if (browserOnlyInput || search !== undefined) {
      return {
        isError: true,
        content: textContent(
          "Oracle broker owns its fixed GPT-5.6 Sol / Pro route and sealed-bundle policy; browser/search overrides are unsupported.",
        ),
      };
    }
    if (models && models.length > 0) {
      return {
        isError: true,
        content: textContent("Oracle broker supports exactly one GPT-5.6 Sol / Pro route."),
      };
    }
    if (model && !["gpt-5.6-sol", "gpt-5.6", "gpt-5-pro"].includes(model.trim().toLowerCase())) {
      return {
        isError: true,
        content: textContent("Oracle broker requires GPT-5.6 Sol with Pro effort."),
      };
    }
    const { runBrokerMcpConsult } = await import("../brokerConsult.js");
    return runBrokerMcpConsult({
      prompt: runOptions.prompt,
      files: runOptions.file,
      maxFileSizeBytes: runOptions.maxFileSizeBytes,
      idempotencyKey,
      waitTimeoutMs,
      dryRun,
      cwd,
      sendLog,
    });
  }

  if (idempotencyKey !== undefined || waitTimeoutMs !== undefined) {
    return {
      isError: true,
      content: textContent(
        "idempotencyKey and waitTimeoutMs are broker-only; set engine to broker or remove them.",
      ),
    };
  }

  const resolvedRemote = resolveRemoteServiceConfig({ userConfig, env: process.env });
  const imageOutputPath = runOptions.generateImage ?? runOptions.outputPath;
  if (resolvedEngine === "browser" && resolvedRemote.host && imageOutputPath) {
    return {
      isError: true,
      content: textContent(
        "ChatGPT image output is not supported with a remote browser service: generated files are not transferred back to the MCP caller. Unset ORACLE_REMOTE_HOST to generate images locally, or omit generateImage/outputPath.",
      ),
    };
  }

  let browserConfig: BrowserSessionConfig | undefined;
  if (resolvedEngine === "browser") {
    browserConfig = buildConsultBrowserConfig({
      userConfig,
      env: process.env,
      runModel: runOptions.model,
      inputModel: model,
      browserModelLabel,
      browserThinkingTime,
      browserModelStrategy,
      browserResearchMode,
      browserKeepBrowser,
    });
  }

  if (dryRun) {
    const lines: string[] = [];
    const log = (line: string): void => {
      lines.push(line);
      sendLog(line);
    };
    const resolved = buildConsultDryRunResolved({
      resolvedEngine,
      runOptions,
      browserConfig,
    });
    await runDryRunSummary({
      engine: resolvedEngine,
      runOptions,
      cwd,
      version: getCliVersion(),
      log,
      browserConfig,
    });
    for (const line of formatConsultDryRunResolved(resolved)) {
      log(line);
    }
    const output = lines.join("\n").trim();
    return {
      content: textContent(output),
      structuredContent: {
        status: "dry-run",
        output,
        dryRun: true,
        resolved,
      },
    };
  }

  const browserGuard = ensureBrowserAvailable(resolvedEngine, {
    remoteHost: resolvedRemote.host,
  });
  if (resolvedEngine === "browser" && browserGuard) {
    return {
      isError: true,
      content: textContent(browserGuard),
    };
  }

  let browserDeps: BrowserSessionRunnerDeps | undefined;
  if (resolvedEngine === "browser" && resolvedRemote.host) {
    if (!resolvedRemote.token) {
      return {
        isError: true,
        content: textContent(
          `Remote host configured (${resolvedRemote.host}) but remote token is missing. Run \`oracle bridge client --connect <...>\` or set ORACLE_REMOTE_TOKEN.`,
        ),
      };
    }
    browserDeps = {
      executeBrowser: createRemoteBrowserExecutor({
        host: resolvedRemote.host,
        token: resolvedRemote.token,
      }),
    };
  }

  const notifications = resolveNotificationSettings({
    cliNotify: undefined,
    cliNotifySound: undefined,
    env: process.env,
    config: userConfig.notify,
  });

  const sessionMeta = await sessionStore.createSession(
    {
      ...runOptions,
      mode: resolvedEngine,
      slug,
      browserConfig,
      waitPreference: true,
    },
    cwd,
    notifications,
  );

  const logWriter = sessionStore.createLogWriter(sessionMeta.id);
  // Stream logs to both the session log and MCP logging notifications, but avoid buffering in memory
  const log = (line?: string): void => {
    logWriter.logLine(line);
    if (line !== undefined) {
      sendLog(line);
    }
  };
  const write = (chunk: string): boolean => {
    logWriter.writeChunk(chunk);
    sendLog(chunk, "debug");
    return true;
  };

  let logFlushFailed = false;
  try {
    await performSessionRun({
      sessionMeta,
      runOptions,
      mode: resolvedEngine,
      browserConfig,
      cwd,
      log,
      write,
      version: getCliVersion(),
      notifications,
      muteStdout: true,
      browserDeps,
    });
  } catch (error) {
    log(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isError: true,
      content: textContent(
        `Session ${sessionMeta.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  } finally {
    logWriter.stream.end();
    try {
      await finished(logWriter.stream);
    } catch {
      logFlushFailed = true;
    }
  }

  if (logFlushFailed) {
    return {
      isError: true,
      content: textContent(
        `Session ${sessionMeta.id} finished, but its log could not be fully persisted. Inspect the stored session before relying on the result.`,
      ),
    };
  }

  try {
    const finalMeta = (await sessionStore.readSession(sessionMeta.id)) ?? sessionMeta;
    const summary = `Session ${sessionMeta.id} (${finalMeta.status})`;
    const logPreview = projectConsultLog(
      await sessionStore.readLog(sessionMeta.id),
      sessionMeta.id,
    );
    const modelsSummary = summarizeModelRunsForConsult(finalMeta.models);
    const artifacts = summarizeArtifactsForConsult(finalMeta.artifacts);
    const images = summarizeImageArtifactsForConsult(finalMeta.artifacts);
    const previewNotice = logPreview.outputTruncated
      ? `Log preview truncated; read the full ${logPreview.logBytes}-byte log at ${logPreview.logResourceUri}`
      : "";
    return {
      content: textContent(
        [summary, previewNotice, logPreview.output || "(log empty)"].filter(Boolean).join("\n"),
      ),
      structuredContent: {
        sessionId: sessionMeta.id,
        status: finalMeta.status,
        ...logPreview,
        models: modelsSummary,
        artifacts,
        images,
      },
    };
  } catch (error) {
    return {
      isError: true,
      content: textContent(
        `Session completed but metadata fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
}

export function registerConsultTool(server: McpServer): void {
  server.registerTool(
    "consult",
    {
      title: "Run an oracle session",
      description:
        'Run an Oracle session (API or ChatGPT browser automation). Use `files` to attach project context. If `engine` is omitted, Oracle follows CLI defaults: config/ORACLE_ENGINE first, then API when OPENAI_API_KEY is set, otherwise browser. Browser Pro consults can take many minutes; use `dryRun:true` first when configuring an agent and inspect `sessions`/`oracle status` before retrying. The canonical browser lane uses direct loopback CDP with a Chrome for Testing app identity and private persistent profile, separate from the operator\'s normal Chrome app and profile. OpenCLI Browser Bridge remains an explicit alternative transport via browser.transport="opencli". Dry-run output includes first-time profile setup guidance. For browser-based image/file uploads, set `browserAttachments:"always"`. For ChatGPT image generation, set `generateImage` to enable the same image wait/download path as CLI --generate-image and read returned paths from `images`. Browser consults can include `browserFollowUps` for a multi-turn ChatGPT review in one conversation. Sessions are stored under `ORACLE_HOME_DIR` (shared with the CLI).',
      // Cast to any to satisfy SDK typings across differing Zod versions.
      inputSchema: consultInputShape,
      outputSchema: consultOutputShape,
    },
    async (input: unknown) => runConsultTool(input, { server: server.server }),
  );
}
