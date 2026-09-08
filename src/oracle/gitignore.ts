import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { FileValidationError } from "./errors.js";
import { decodeSourceText } from "./sourceText.js";

interface RuleSet {
  directory: string;
  rules: Ignore;
}

/**
 * Apply worktree .gitignore rules to glob/directory candidates. No Git process,
 * index, global excludes, or worktree mutation is involved. An invocation in a
 * subdirectory inherits rules up to its nearest .git marker; without a marker,
 * cwd is the boundary. Exact literal file consent is handled by the caller.
 */
export async function createGitignoreFilter(
  cwd: string,
): Promise<(file: string) => Promise<boolean>> {
  const root = await findIgnoreRoot(path.resolve(cwd));
  const cache = new Map<string, Promise<RuleSet | undefined>>();
  const rulesAt = (directory: string): Promise<RuleSet | undefined> => {
    let pending = cache.get(directory);
    if (!pending) {
      pending = readRules(directory, cwd);
      cache.set(directory, pending);
    }
    return pending;
  };

  return async (file: string): Promise<boolean> => {
    const relative = path.relative(root, path.resolve(file));
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return false;
    }
    const parts = relative.split(path.sep);
    const active: RuleSet[] = [];
    let directory = root;
    for (let index = 0; index < parts.length; index += 1) {
      const local = await rulesAt(directory);
      if (local) active.push({ ...local });
      const target = path.join(directory, parts[index]);
      const isDirectory = index < parts.length - 1;
      let excluded = false;
      for (const entry of active) {
        const name = path.relative(entry.directory, target).split(path.sep).join("/");
        const result = entry.rules.test(isDirectory ? `${name}/` : name);
        if (result.ignored) excluded = true;
        else if (result.unignored) excluded = false;
      }
      // Git does not descend into excluded directories. A .gitignore inside
      // such a directory cannot re-include files or grant upload permission.
      if (excluded) return true;
      if (isDirectory) {
        // Each matcher recursively checks parents in its own rule scope. A
        // deeper .gitignore may have reopened a directory that an ancestor's
        // matcher still considers excluded. Carry the admitted directory into
        // every scope so that inherited exclusion cannot reappear when we test
        // its children. File rules remain intact. Never mutate cached rules.
        for (const entry of active) {
          const name = path.relative(entry.directory, target).split(path.sep).join("/");
          entry.rules = ignore({ ignorecase: false })
            .add(entry.rules)
            .add(`!/${escapeLiteralDirectory(name)}/`);
        }
      }
      directory = target;
    }
    return false;
  };
}

async function findIgnoreRoot(cwd: string): Promise<string> {
  let directory = cwd;
  while (true) {
    try {
      const marker = await fs.lstat(path.join(directory, ".git"));
      if (marker.isFile() || marker.isDirectory()) return directory;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return cwd;
    directory = parent;
  }
}

async function readRules(directory: string, cwd: string): Promise<RuleSet | undefined> {
  const file = path.join(directory, ".gitignore");
  try {
    const stats = await fs.lstat(file);
    // Git does not follow a symlink when accessing a worktree .gitignore.
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    const content = decodeSourceText(await fs.readFile(file), path.relative(cwd, file));
    return { directory, rules: ignore({ ignorecase: false }).add(content) };
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError(
      `Cannot read source-selection rules: ${path.relative(cwd, file)}`,
      { path: file, code: "gitignore-unreadable" },
      error,
    );
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function escapeLiteralDirectory(name: string): string {
  if (/[\r\n]/u.test(name)) {
    throw new FileValidationError(
      "Source directory contains a newline and cannot be matched safely.",
      {
        code: "invalid-ignore-directory",
      },
    );
  }
  return name.replace(/[\\*?[\] ]/gu, "\\$&");
}
