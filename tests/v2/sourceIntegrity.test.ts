import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FakeProvider, OracleWorker } from "../../apps/oracle-worker/src/index.js";
import { OracleClient } from "../../packages/oracle-client/src/index.js";
import { admitBrokerReview, prepareBrokerReview, waitForBrokerJob } from "../../src/v2/broker.js";
import { assembleBrowserPrompt, cleanupGeneratedBrowserBundles } from "../../src/browser/prompt.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(entries: Record<string, string | Buffer>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-input-integrity-"));
  roots.push(root);
  for (const [name, content] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

function paths(root: string) {
  return {
    rootDir: path.join(root, "worker"),
    sessionsDir: path.join(root, "sessions"),
    socketPath: path.join(root, "run", "oracle.sock"),
    intentDirectory: path.join(root, "intents"),
  };
}

describe("source integrity through consultation preparation and admission", () => {
  test("seals the selected contents and never packs ignored candidates", async () => {
    const cwd = await fixture({
      ".gitignore": "*.pem\n*.txt\n!keep.txt\n",
      "nested/private.pem": "SYNTHETIC-EXCLUDED-MARKER\n",
      "drop.txt": "SYNTHETIC-DROPPED-MARKER\n",
      "keep.txt": "中文 / kept\r\n",
      "code.ts": "export const value = 1;\n",
    });
    const prepared = await prepareBrokerReview({
      cwd,
      prompt: "Review selected sources.",
      files: ["**/*"],
    });
    expect(prepared.files.map((file) => file.path)).toEqual(["code.ts", "keep.txt"]);
    expect(prepared.bundleBytes?.toString("utf8")).not.toMatch(
      /SYNTHETIC-(EXCLUDED|DROPPED)-MARKER/u,
    );
    expect(prepared.bundleBytes?.toString("utf8")).toContain("中文 / kept\n");
    expect(prepared.files.find((file) => file.path === "keep.txt")).toMatchObject({
      sizeBytes: Buffer.byteLength("中文 / kept\n"),
      sha256: createHash("sha256").update("中文 / kept\n").digest("hex"),
    });
  });

  test.each([Buffer.from([0xff, 0xfe, 0x41]), Buffer.from([0x61, 0, 0x62])])(
    "rejects invalid text before client intent, upload, or worker admission %#",
    async (bytes) => {
      const cwd = await fixture({ "invalid.txt": bytes });
      const storePaths = paths(cwd);
      await expect(
        admitBrokerReview({
          cwd,
          prompt: "Review sources.",
          files: ["invalid.txt"],
          idempotencyKey: "reject-before-admission",
          paths: storePaths,
        }),
      ).rejects.toThrow(/UTF-8|NUL/u);
      // No worker exists. Reaching client admission would attempt this absent
      // socket and produce a transport error, not the source-validation error.
      for (const name of [
        storePaths.intentDirectory,
        storePaths.rootDir,
        storePaths.sessionsDir,
        path.dirname(storePaths.socketPath),
      ]) {
        await expect(fs.stat(name)).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );

  test("all-ignored selection fails before admission instead of becoming prompt-only", async () => {
    const cwd = await fixture({ ".gitignore": "*.pem\n", "nested/private.pem": "synthetic\n" });
    const storePaths = paths(cwd);
    await expect(
      admitBrokerReview({
        cwd,
        prompt: "Review sources.",
        files: ["**/*.pem"],
        idempotencyKey: "empty-selection",
        paths: storePaths,
      }),
    ).rejects.toThrow("No files matched");
    await expect(fs.stat(storePaths.intentDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("leaves small text inline under auto and uploads a bundle only when requested", async () => {
    const cwd = await fixture({
      ".gitignore": "*.pem\n",
      "nested/private.pem": "synthetic\n",
      "code.ts": "export const text = '中文';\n",
    });
    const input = { model: "gpt-5-pro", prompt: "Review sources.", file: ["**/*"] };
    const auto = await assembleBrowserPrompt(input, { cwd });
    const upload = await assembleBrowserPrompt(
      { ...input, browserAttachments: "always", browserBundleFiles: true },
      { cwd },
    );
    try {
      expect(auto.attachmentMode).toBe("inline");
      expect(auto.inlineFileCount).toBe(1);
      expect(auto.attachments).toEqual([]);
      expect(auto.composerText).toContain("export const text = '中文';");
      expect(auto.composerText).not.toContain("private.pem");
      expect(upload.attachmentMode).toBe("bundle");
      expect(upload.bundled?.originalCount).toBe(1);
      expect(upload.attachments).toHaveLength(1);
      expect(await fs.readFile(upload.attachments[0].path, "utf8")).toContain(
        "export const text = '中文';",
      );
    } finally {
      await cleanupGeneratedBrowserBundles(auto);
      await cleanupGeneratedBrowserBundles(upload);
    }
  });

  test("preserves raw browser uploads without trying to decode them as text", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff]);
    const cwd = await fixture({ "sample.pdf": bytes });
    const prepared = await assembleBrowserPrompt(
      { model: "gpt-5-pro", prompt: "Inspect the document.", file: ["sample.pdf"] },
      { cwd },
    );
    try {
      expect(prepared.attachments).toHaveLength(1);
      expect(await fs.readFile(prepared.attachments[0].path)).toEqual(bytes);
      expect(prepared.inlineFileCount).toBe(0);
    } finally {
      await cleanupGeneratedBrowserBundles(prepared);
    }
  });

  test.skipIf(process.platform === "win32")(
    "changed source bytes cannot reuse the same admitted consultation identity",
    async () => {
      const cwd = await fixture({ "code.ts": "export const version = 1;\n" });
      const storePaths = paths(cwd);
      const provider = new FakeProvider();
      const worker = new OracleWorker({ ...storePaths, provider });
      await worker.start();
      const client = new OracleClient({ socketPath: storePaths.socketPath });
      try {
        const input = {
          cwd,
          prompt: "Review sources.",
          files: ["code.ts"],
          idempotencyKey: "stable-source-review",
          paths: storePaths,
          client,
        };
        const first = await admitBrokerReview(input);
        const settled = await waitForBrokerJob(client, first.admission.job.id, {
          timeoutMs: 5_000,
        });
        expect(settled.result?.ready).toBe(true);
        await fs.writeFile(path.join(cwd, "code.ts"), "export const version = 2;\n");
        await expect(admitBrokerReview(input)).rejects.toThrow("intent identity mismatch");
        expect(provider.sendCount(first.admission.job.id)).toBe(1);
      } finally {
        client.close();
        await worker.stop();
      }
    },
  );
});
