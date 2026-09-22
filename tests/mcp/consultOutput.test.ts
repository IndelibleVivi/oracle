import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { setOracleHomeDirOverrideForTest } from "../../src/oracleHome.js";
import { sessionStore } from "../../src/sessionStore.js";
import { runConsultTool } from "../../src/mcp/tools/consult.js";

const answer = `Opening finding survives in storage.\n${"review detail ".repeat(450)}Closing finding.\n`;

vi.mock("../../src/cli/sessionRunner.js", () => ({
  performSessionRun: async ({ log }: { log: (line: string) => void }) => {
    log(answer);
  },
}));

let home: string | undefined;

afterEach(() => {
  setOracleHomeDirOverrideForTest(null);
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

test("MCP consult labels its preview and exposes the complete persisted log", async () => {
  home = mkdtempSync(path.join(tmpdir(), "oracle-mcp-output-"));
  setOracleHomeDirOverrideForTest(home);
  const result = await runConsultTool(
    { prompt: "Review the synthetic change", files: [], engine: "api", model: "gpt-5.5-pro" },
    { server: { sendLoggingMessage: async () => undefined } },
  );
  expect(result.isError).toBeUndefined();
  const data = result.structuredContent as {
    sessionId: string;
    output: string;
    outputTruncated: boolean;
    logBytes: number;
    logResourceUri: string;
  };
  expect(data.outputTruncated).toBe(true);
  expect(data.logBytes).toBeGreaterThan(Buffer.byteLength(data.output, "utf8"));
  expect(data.logResourceUri).toBe(`oracle-session://${data.sessionId}/log`);
  expect(result.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("Log preview truncated"),
  });
  const stored = await sessionStore.readLog(data.sessionId);
  expect(stored).toContain("Opening finding survives in storage.");
  expect(stored).toContain("Closing finding.");
});
