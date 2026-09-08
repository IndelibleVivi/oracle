import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
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

async function fixture(entries: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-ignore-rules-"));
  roots.push(root);
  // Git for Windows cannot open Node's extended-length null-device path.
  // Use a real, private fixture file for empty config and global excludes.
  await fs.writeFile(path.join(root, ".git-empty-config"), "");
  for (const [name, content] of Object.entries({ "sentinel.ts": "keep\n", ...entries })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

function relative(root: string, files: Awaited<ReturnType<typeof readFiles>>): string[] {
  return files.map((file) => path.relative(root, file.path).split(path.sep).join("/")).sort();
}

const cases: Array<{
  name: string;
  rules: Record<string, string>;
  files: string[];
  ignored: string[];
}> = [
  {
    name: "basename at any depth",
    rules: { ".gitignore": "*.pem\n" },
    files: ["private.pem", "nested/private.pem", "nested/public.ts"],
    ignored: ["private.pem", "nested/private.pem"],
  },
  {
    name: "root anchor",
    rules: { ".gitignore": "/private.txt\n" },
    files: ["private.txt", "nested/private.txt"],
    ignored: ["private.txt"],
  },
  {
    name: "globstar includes zero directories",
    rules: { ".gitignore": "**/*.md\n" },
    files: ["README.md", "nested/guide.md", "nested/code.ts"],
    ignored: ["README.md", "nested/guide.md"],
  },
  {
    name: "last matching negation wins",
    rules: { ".gitignore": "*.txt\n!keep.txt\n" },
    files: ["keep.txt", "drop.txt", "nested/keep.txt"],
    ignored: ["drop.txt"],
  },
  {
    name: "later exclusion wins again",
    rules: { ".gitignore": "*.txt\n!keep.txt\nkeep.txt\n" },
    files: ["keep.txt", "drop.txt"],
    ignored: ["keep.txt", "drop.txt"],
  },
  {
    name: "directory basename at any depth",
    rules: { ".gitignore": "cache/\n" },
    files: ["cache/a.ts", "nested/cache/a.ts", "nested/caches/a.ts"],
    ignored: ["cache/a.ts", "nested/cache/a.ts"],
  },
  {
    name: "directory-only rule does not hide a file",
    rules: { ".gitignore": "cache/\n" },
    files: ["cache", "nested/cache"],
    ignored: [],
  },
  {
    name: "child file negation overrides parent file rule",
    rules: { ".gitignore": "*.txt\n", "nested/.gitignore": "!keep.txt\n" },
    files: ["keep.txt", "nested/keep.txt", "nested/drop.txt"],
    ignored: ["keep.txt", "nested/drop.txt"],
  },
  {
    name: "ignored parent cannot be resurrected by its child",
    rules: { ".gitignore": "private/\n", "private/.gitignore": "!keep.txt\n" },
    files: ["private/keep.txt", "private/nested/file.ts"],
    ignored: ["private/keep.txt", "private/nested/file.ts"],
  },
  {
    name: "parent directory can be explicitly reopened",
    rules: { ".gitignore": "*\n!sentinel.ts\n!nested/\n", "nested/.gitignore": "!keep.txt\n" },
    files: ["nested/keep.txt", "nested/drop.txt"],
    ignored: ["nested/drop.txt"],
  },
  {
    name: "nested slash anchor stays local",
    rules: { "nested/.gitignore": "/local.txt\n" },
    files: ["nested/local.txt", "nested/deeper/local.txt", "other/local.txt"],
    ignored: ["nested/local.txt"],
  },
  {
    name: "sibling directory names are not ancestors",
    rules: { "src/.gitignore": "*\n" },
    files: ["src/hidden.ts", "src-other/visible.ts"],
    ignored: ["src/hidden.ts"],
  },
  {
    name: "escaped comment and negation markers",
    rules: { ".gitignore": "\\#private.txt\n\\!private.txt\n# comment\n" },
    files: ["#private.txt", "!private.txt", "ordinary.txt"],
    ignored: ["#private.txt", "!private.txt"],
  },
  {
    name: "brackets and question marks",
    rules: { ".gitignore": "secret[0-9].txt\na?.log\n" },
    files: ["secret1.txt", "secreta.txt", "ab.log", "abc.log"],
    ignored: ["secret1.txt", "ab.log"],
  },
  {
    name: "slash in middle anchors to rule directory",
    rules: { ".gitignore": "docs/private.txt\n" },
    files: ["docs/private.txt", "nested/docs/private.txt"],
    ignored: ["docs/private.txt"],
  },
  {
    name: "escaped embedded space",
    rules: { ".gitignore": "secret\\ file.txt\n" },
    files: ["secret file.txt", "secret-file.txt"],
    ignored: ["secret file.txt"],
  },
  {
    name: "parent file rule without trailing slash also excludes directories",
    rules: { ".gitignore": "private\n" },
    files: ["private/keep.txt", "nested/private/keep.txt"],
    ignored: ["private/keep.txt", "nested/private/keep.txt"],
  },
];

describe("shared source selection: Git ignore semantics", () => {
  test.each(cases)("$name", async ({ rules, files, ignored }) => {
    const root = await fixture({
      ...rules,
      ...Object.fromEntries(files.map((name) => [name, "synthetic\n"])),
    });
    const selected = relative(root, await readFiles(["**/*"], { cwd: root }));
    expect(selected).toEqual(
      ["sentinel.ts", ...files.filter((name) => !ignored.includes(name))].sort(),
    );
  });

  test.skipIf(!hasGit).each(cases)("matches git check-ignore: $name", async ({ rules, files }) => {
    const root = await fixture({
      ...rules,
      ...Object.fromEntries(files.map((name) => [name, "synthetic\n"])),
    });
    execFileSync("git", ["init", "--quiet", root], { env: gitEnv(root) });
    const candidates = ["sentinel.ts", ...files];
    const checked = spawnSync(
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
      { cwd: root, env: gitEnv(root), input: candidates.join("\0") + "\0", encoding: "utf8" },
    );
    expect([0, 1]).toContain(checked.status);
    const ignored = new Set(checked.stdout.split("\0").filter(Boolean));
    expect(relative(root, await readFiles(["**/*"], { cwd: root }))).toEqual(
      candidates.filter((name) => !ignored.has(name)).sort(),
    );
  });

  test("keeps exact literal consent consistent when mixed with globs", async () => {
    const root = await fixture({
      ".gitignore": "private.txt\n",
      "private.txt": "explicit\n",
      "public.txt": "public\n",
    });
    expect(relative(root, await readFiles(["private.txt"], { cwd: root }))).toEqual([
      "private.txt",
    ]);
    expect(relative(root, await readFiles(["private.txt", "*.ts"], { cwd: root }))).toEqual([
      "private.txt",
      "sentinel.ts",
    ]);
    expect(
      relative(root, await readFiles(["private.txt", "*.ts", "!private.txt"], { cwd: root })),
    ).toEqual(["sentinel.ts"]);
  });

  test("uses ancestor rules for a nested cwd inside a worktree", async () => {
    const root = await fixture({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".gitignore": "*.txt\n",
      "sub/.gitignore": "!keep.txt\n",
      "sub/keep.txt": "keep\n",
      "sub/drop.txt": "drop\n",
      "sub/public.ts": "public\n",
    });
    expect(relative(root, await readFiles(["**/*"], { cwd: path.join(root, "sub") }))).toEqual([
      "sub/keep.txt",
      "sub/public.ts",
    ]);
  });

  test("stops inherited rules at a nested repository boundary", async () => {
    const root = await fixture({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".gitignore": "*.txt\n",
      "sub/.git": "gitdir: ../unused\n",
      "sub/keep.txt": "keep\n",
    });
    expect(relative(root, await readFiles(["**/*"], { cwd: path.join(root, "sub") }))).toEqual([
      "sub/keep.txt",
    ]);
  });

  test("does not consult ignore files outside cwd when no worktree is present", async () => {
    const root = await fixture({ ".gitignore": "*.txt\n", "sub/keep.txt": "keep\n" });
    expect(relative(root, await readFiles(["**/*"], { cwd: path.join(root, "sub") }))).toEqual([
      "sub/keep.txt",
    ]);
  });

  test("reports zero matches instead of silently submitting no files", async () => {
    const root = await fixture({ ".gitignore": "*.pem\n", "nested/private.pem": "synthetic\n" });
    await expect(readFiles(["**/*.pem"], { cwd: root })).rejects.toThrow("No files matched");
  });

  test("fails closed on an unreadable or invalid relevant rules file", async () => {
    const root = await fixture({ "public.txt": "keep\n" });
    await fs.writeFile(path.join(root, ".gitignore"), Buffer.from([0xff, 0xfe]));
    await expect(readFiles(["*.txt"], { cwd: root })).rejects.toThrow(/UTF-8/u);
  });
  test("does not read unrelated or excluded subdirectory rules", async () => {
    const root = await fixture({
      ".gitignore": "private/\n",
      "src/public.ts": "public\n",
      "private/file.ts": "excluded\n",
    });
    await fs.writeFile(path.join(root, "private/.gitignore"), Buffer.from([0xff]));
    await fs.mkdir(path.join(root, "unrelated"));
    await fs.writeFile(path.join(root, "unrelated/.gitignore"), Buffer.from([0xff]));
    expect(relative(root, await readFiles(["src/**", "private/**"], { cwd: root }))).toEqual([
      "src/public.ts",
    ]);
  });

  test("does not turn an I/O failure into permission to include files", async () => {
    const root = await fixture({ ".gitignore": "*.txt\n", "private.txt": "synthetic\n" });
    const read = vi
      .spyOn(fs, "readFile")
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
    try {
      await expect(readFiles(["**/*"], { cwd: root })).rejects.toThrow(
        "Cannot read source-selection rules",
      );
    } finally {
      read.mockRestore();
    }
  });

  test.skipIf(process.platform === "win32")("does not follow a symlinked .gitignore", async () => {
    const root = await fixture({ "rules.txt": "*.ts\n" });
    await fs.symlink(path.join(root, "rules.txt"), path.join(root, ".gitignore"));
    expect(relative(root, await readFiles(["*.ts"], { cwd: root }))).toEqual(["sentinel.ts"]);
  });
});
