import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readFiles } from "../src/oracle/files.js";

const roots: string[] = [];
const hasGit = spawnSync("git", ["--version"]).status === 0;
function gitEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(root, ".git-empty-config"),
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(entries: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-ignore-composition-"));
  roots.push(root);
  // Git for Windows cannot open Node's extended-length null-device path.
  // Use a real, private fixture file for empty config and global excludes.
  await fs.writeFile(path.join(root, ".git-empty-config"), "");
  for (const [name, content] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

async function select(root: string): Promise<string[]> {
  try {
    return (await readFiles(["**/*"], { cwd: root }))
      .map((file) => path.relative(root, file.path).split(path.sep).join("/"))
      .sort();
  } catch (error) {
    if (error instanceof Error && error.message.includes("No files matched")) return [];
    throw error;
  }
}

function gitSelection(root: string, files: string[]): string[] {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.ignoreCase=false",
      "-c",
      `core.excludesFile=${path.join(root, ".git-empty-config")}`,
      "check-ignore",
      "--no-index",
      "--stdin",
      "-z",
    ],
    { cwd: root, env: gitEnv(root), input: files.join("\0") + "\0", encoding: "utf8" },
  );
  expect([0, 1]).toContain(result.status);
  const excluded = new Set(result.stdout.split("\0").filter(Boolean));
  return files.filter((name) => !excluded.has(name)).sort();
}

const cases: Array<{
  name: string;
  rules: Record<string, string>;
  files: string[];
  wanted: string[];
}> = [
  {
    name: "reopened directory",
    rules: { ".gitignore": "cache/\n", "nested/.gitignore": "!cache/\n" },
    files: ["cache/private.ts", "nested/cache/public.ts"],
    wanted: ["nested/cache/public.ts"],
  },
  {
    name: "ancestor file rules still apply",
    rules: { ".gitignore": "cache/\n*.txt\n", "nested/.gitignore": "!cache/\n" },
    files: ["nested/cache/public.ts", "nested/cache/private.txt"],
    wanted: ["nested/cache/public.ts"],
  },
  {
    name: "literal pattern characters in directory names",
    rules: { ".gitignore": "cache/\n", "[scope] name/.gitignore": "!cache/\n" },
    files: ["[scope] name/cache/public.ts", "cache/private.ts"],
    wanted: ["[scope] name/cache/public.ts"],
  },
];

describe("composed ancestor and descendant ignore rules", () => {
  test.each(cases)("$name", async ({ rules, files, wanted }) => {
    const root = await fixture({
      ...rules,
      ...Object.fromEntries(files.map((file) => [file, "synthetic\n"])),
    });
    expect(await select(root)).toEqual(wanted);
    if (hasGit) {
      execFileSync("git", ["init", "--quiet", root], { env: gitEnv(root) });
      expect(await select(root)).toEqual(gitSelection(root, files));
    }
  });

  test.skipIf(process.platform === "win32")("rejects unrepresentable directory rules", async () => {
    const root = await fixture({ ".gitignore": "*.pem\n", "line\nbreak/source.ts": "synthetic\n" });
    await expect(readFiles(["line\nbreak"], { cwd: root })).rejects.toThrow(
      "directory contains a newline",
    );
  });

  test.skipIf(!hasGit)(
    "matches 200 deterministic nested-rule sets against Git",
    async () => {
      const files = [
        "root.txt",
        "keep.txt",
        "root.log",
        "README.md",
        "src/keep.txt",
        "src/private.txt",
        "src/public.ts",
        "src/cache/a.ts",
        "nested/keep.txt",
        "nested/file1.txt",
        "nested/docs/guide.md",
        "nested/cache/a.txt",
        "cache/public.txt",
        "cache/keep.txt",
      ];
      const rules = [
        "*.txt",
        "!keep.txt",
        "/root.log",
        "cache/",
        "!cache/",
        "src/*",
        "!src/",
        "src/**",
        "!src/**",
        "!src/keep.txt",
        "**/private*",
        "*.md",
        "/src/*.txt",
        "src/",
        "!public*",
        "*",
        "/nested/**",
        "**/*",
        "nested/",
        "!nested/",
        "**/keep.txt",
        "!**/keep.txt",
        "!**/*.md",
        "file?.txt",
        "private.txt",
        "!private.txt",
        "**/cache/",
        "!*.ts",
      ];
      const root = await fixture(Object.fromEntries(files.map((file) => [file, "synthetic\n"])));
      execFileSync("git", ["init", "--quiet", root], { env: gitEnv(root) });
      let seed = 20260909;
      const next = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return seed >>> 0;
      };
      for (let sample = 0; sample < 200; sample += 1) {
        const chosen: Record<string, string> = {};
        for (const directory of ["", "src", "nested", "cache"]) {
          const body =
            Array.from({ length: next() % 9 }, () => rules[next() % rules.length]).join("\n") +
            "\n";
          chosen[directory] = body;
          await fs.writeFile(path.join(root, directory, ".gitignore"), body);
        }
        expect(await select(root), JSON.stringify({ seed: 20260909, sample, chosen })).toEqual(
          gitSelection(root, files),
        );
      }
    },
    15_000,
  );
});
