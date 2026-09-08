import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readFiles } from "../src/oracle/files.js";
import { createFsAdapter } from "../src/oracle/fsAdapter.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function source(bytes: Buffer) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-source-bytes-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "source.txt"), bytes);
  return root;
}

const malformed = [
  ["invalid leading bytes", Buffer.from([0xff, 0xfe, 0x41])],
  ["truncated multibyte sequence", Buffer.from([0xe2, 0x82])],
  ["encoded surrogate", Buffer.from([0xed, 0xa0, 0x80])],
  ["binary NUL", Buffer.from([0x61, 0, 0x62])],
] as const;

describe("shared source reader byte validation", () => {
  for (const adapted of [false, true]) {
    test.each(malformed)(
      `rejects %s before lossy decoding (adapter=${adapted})`,
      async (_name, bytes) => {
        const cwd = await source(bytes);
        await expect(
          readFiles(["source.txt"], { cwd, ...(adapted ? { fsModule: createFsAdapter(fs) } : {}) }),
        ).rejects.toThrow(/UTF-8|NUL/u);
      },
    );
  }

  test.each([
    "中文 / naïve / 🌱\r\n",
    "\ufeffBOM stays intact\n",
    "a real replacement character: \ufffd\n",
    "",
  ])("preserves valid source text %#", async (content) => {
    const cwd = await source(Buffer.from(content));
    const files = await readFiles(["source.txt"], { cwd });
    expect(files[0].content).toBe(content);
  });

  test("metadata-only selection does not decode raw uploads", async () => {
    const cwd = await source(Buffer.from([0xff, 0, 0xfe]));
    const files = await readFiles(["source.txt"], { cwd, readContents: false });
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("");
  });
  test("checks actual bytes if a source grows after stat", async () => {
    const cwd = await source(Buffer.from("old"));
    const adapter = createFsAdapter(fs);
    adapter.readFileBytes = async (file) => {
      await fs.writeFile(file, "now exceeds the old stat and configured limit");
      return fs.readFile(file);
    };
    await expect(
      readFiles(["source.txt"], { cwd, fsModule: adapter, maxFileSizeBytes: 10 }),
    ).rejects.toThrow(/limit after reading/u);
  });
});
