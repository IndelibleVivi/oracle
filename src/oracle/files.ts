import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { FileContent, FileSection, MinimalFsModule, FsStats } from "./types.js";
import { FileValidationError } from "./errors.js";
import { createGitignoreFilter } from "./gitignore.js";
import { decodeSourceText } from "./sourceText.js";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
const DEFAULT_FS = fs as MinimalFsModule;
const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".turbo",
  ".next",
  "build",
  "tmp",
]);

interface PartitionedFiles {
  globPatterns: string[];
  excludePatterns: string[];
  literalFiles: string[];
  literalDirectories: string[];
}

export async function readFiles(
  filePaths: string[],
  {
    cwd = process.cwd(),
    fsModule = DEFAULT_FS,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
    readContents = true,
  }: {
    cwd?: string;
    fsModule?: MinimalFsModule;
    maxFileSizeBytes?: number;
    readContents?: boolean;
  } = {},
): Promise<FileContent[]> {
  if (!filePaths || filePaths.length === 0) {
    return [];
  }

  const partitioned = await partitionFileInputs(filePaths, cwd, fsModule);
  const useNativeFilesystem = fsModule === DEFAULT_FS || isNativeFsModule(fsModule);

  let candidatePaths: string[] = [];
  if (useNativeFilesystem) {
    if (
      partitioned.globPatterns.length === 0 &&
      partitioned.excludePatterns.length === 0 &&
      partitioned.literalDirectories.length === 0
    ) {
      candidatePaths = Array.from(new Set(partitioned.literalFiles));
    } else {
      candidatePaths = await expandWithNativeGlob(partitioned, cwd);
    }
  } else {
    if (partitioned.globPatterns.length > 0 || partitioned.excludePatterns.length > 0) {
      throw new Error("Glob patterns and exclusions are only supported for on-disk files.");
    }
    candidatePaths = await expandWithCustomFs(partitioned, fsModule);
  }

  const allowedLiteralDirs = partitioned.literalDirectories
    .map((dir) => path.resolve(dir))
    .filter((dir) => DEFAULT_IGNORED_DIRS.has(path.basename(dir)));
  const allowedLiteralFiles = partitioned.literalFiles.map((file) => path.resolve(file));
  const resolvedLiteralDirs = new Set(allowedLiteralDirs);
  const allowedPaths = new Set([...allowedLiteralDirs, ...allowedLiteralFiles]);
  const ignoredWhitelist = await buildIgnoredWhitelist(candidatePaths, cwd, fsModule);
  const ignoredLog = new Set<string>();
  const filteredCandidates = candidatePaths.filter((filePath) => {
    const ignoredDir = findIgnoredAncestor(
      filePath,
      cwd,
      resolvedLiteralDirs,
      allowedPaths,
      ignoredWhitelist,
    );
    if (!ignoredDir) {
      return true;
    }
    const displayFile = relativePath(filePath, cwd);
    const key = `${ignoredDir}|${displayFile}`;
    if (!ignoredLog.has(key)) {
      console.log(`Skipping default-ignored path: ${displayFile} (matches ${ignoredDir})`);
      ignoredLog.add(key);
    }
    return false;
  });

  if (filteredCandidates.length === 0) {
    throw new FileValidationError("No files matched the provided --file patterns.", {
      patterns: partitioned.globPatterns,
      excludes: partitioned.excludePatterns,
    });
  }

  const oversized: string[] = [];
  const accepted: string[] = [];
  for (const filePath of filteredCandidates) {
    let stats: FsStats;
    try {
      stats = await fsModule.stat(filePath);
    } catch (error) {
      throw new FileValidationError(
        `Missing file or directory: ${relativePath(filePath, cwd)}`,
        { path: filePath },
        error,
      );
    }
    if (!stats.isFile()) {
      continue;
    }
    if (maxFileSizeBytes && typeof stats.size === "number" && stats.size > maxFileSizeBytes) {
      const relative = path.relative(cwd, filePath) || filePath;
      oversized.push(`${relative} (${formatBytes(stats.size)})`);
      continue;
    }
    accepted.push(filePath);
  }

  if (oversized.length > 0) {
    throw new FileValidationError(
      `The following files exceed the ${formatBytes(maxFileSizeBytes)} limit:\n- ${oversized.join("\n- ")}`,
      {
        files: oversized,
        limitBytes: maxFileSizeBytes,
      },
    );
  }

  const files: FileContent[] = [];
  for (const filePath of accepted) {
    let content = "";
    if (readContents) {
      // Native reads must reach the strict decoder as bytes, not as a string
      // that has already replaced invalid UTF-8. String-only injected filesystems
      // remain supported for existing in-memory callers.
      const bytes = fsModule.readFileBytes
        ? await fsModule.readFileBytes(filePath)
        : fsModule === DEFAULT_FS
          ? await fs.readFile(filePath)
          : Buffer.from(await fsModule.readFile(filePath, "utf8"), "utf8");
      if (maxFileSizeBytes && bytes.byteLength > maxFileSizeBytes) {
        throw new FileValidationError(
          `Source exceeds the ${formatBytes(maxFileSizeBytes)} limit after reading: ${relativePath(filePath, cwd)}`,
          { path: filePath, limitBytes: maxFileSizeBytes },
        );
      }
      content = decodeSourceText(bytes, relativePath(filePath, cwd));
    }
    files.push({ path: filePath, content });
  }
  return files;
}

async function partitionFileInputs(
  rawPaths: string[],
  cwd: string,
  fsModule: MinimalFsModule,
): Promise<PartitionedFiles> {
  const result: PartitionedFiles = {
    globPatterns: [],
    excludePatterns: [],
    literalFiles: [],
    literalDirectories: [],
  };

  for (const entry of rawPaths) {
    const raw = entry?.trim();
    if (!raw) {
      continue;
    }
    if (raw.startsWith("!")) {
      const normalized = normalizeGlob(raw.slice(1), cwd);
      if (normalized) {
        result.excludePatterns.push(normalized);
      }
      continue;
    }

    if (fg.isDynamicPattern(raw)) {
      result.globPatterns.push(normalizeGlob(raw, cwd));
      continue;
    }

    const absolutePath = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    let stats: FsStats;
    try {
      stats = await fsModule.stat(absolutePath);
    } catch (error) {
      throw new FileValidationError(
        `Missing file or directory: ${raw}`,
        { path: absolutePath },
        error,
      );
    }
    if (stats.isDirectory()) {
      result.literalDirectories.push(absolutePath);
    } else if (stats.isFile()) {
      result.literalFiles.push(absolutePath);
    } else {
      throw new FileValidationError(`Not a file or directory: ${raw}`, { path: absolutePath });
    }
  }

  return result;
}

async function expandWithNativeGlob(partitioned: PartitionedFiles, cwd: string): Promise<string[]> {
  const patterns = [
    ...partitioned.globPatterns,
    ...partitioned.literalFiles.map((absPath) => toPosixRelativeOrBasename(absPath, cwd)),
    ...partitioned.literalDirectories.map((absDir) =>
      makeDirectoryPattern(toPosixRelative(absDir, cwd)),
    ),
  ].filter(Boolean);

  if (patterns.length === 0) {
    return [];
  }

  const isGitignored = await createGitignoreFilter(cwd);

  // Hidden-path consent is scoped to the pattern that names it. A separate
  // explicit `.github/**` input must not turn an unrelated `src/**` into an
  // invitation to upload `src/.secrets/**` as well.
  const explicitDotPatterns = patterns.filter((pattern) => includesDotfileSegment(pattern));
  const visibleMatches = (await fg(patterns, {
    cwd,
    absolute: false,
    dot: false,
    ignore: partitioned.excludePatterns,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  })) as string[];
  const explicitDotMatches =
    explicitDotPatterns.length > 0
      ? ((await fg(explicitDotPatterns, {
          cwd,
          absolute: false,
          dot: true,
          ignore: partitioned.excludePatterns,
          onlyFiles: true,
          followSymbolicLinks: false,
          suppressErrors: true,
        })) as string[])
      : [];
  const matches = [...visibleMatches, ...explicitDotMatches];
  const resolved = matches.map((match) => path.resolve(cwd, match));
  const literalFiles = new Set(partitioned.literalFiles.map((file) => path.resolve(file)));
  const admitted = await Promise.all(
    resolved.map(async (filePath) => literalFiles.has(filePath) || !(await isGitignored(filePath))),
  );
  return Array.from(new Set(resolved.filter((_file, index) => admitted[index])));
}

async function buildIgnoredWhitelist(
  filePaths: string[],
  cwd: string,
  fsModule: MinimalFsModule,
): Promise<Set<string>> {
  const whitelist = new Set<string>();
  for (const filePath of filePaths) {
    const absolute = path.resolve(filePath);
    const rel = path.relative(cwd, absolute);
    const parts = rel.split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!DEFAULT_IGNORED_DIRS.has(part)) {
        continue;
      }
      const dirPath = path.resolve(cwd, ...parts.slice(0, i + 1));
      if (whitelist.has(dirPath)) {
        continue;
      }
      try {
        const stats = await fsModule.stat(path.join(dirPath, ".gitignore"));
        if (stats.isFile()) {
          whitelist.add(dirPath);
        }
      } catch {
        // no .gitignore at this level; keep ignored
      }
    }
  }
  return whitelist;
}

function findIgnoredAncestor(
  filePath: string,
  cwd: string,
  _literalDirs: Set<string>,
  allowedPaths: Set<string>,
  ignoredWhitelist: Set<string>,
): string | null {
  const absolute = path.resolve(filePath);
  if (
    Array.from(allowedPaths).some(
      (allowed) => absolute === allowed || absolute.startsWith(`${allowed}${path.sep}`),
    )
  ) {
    return null; // explicitly requested path overrides default ignore when the ignored dir itself was passed
  }
  const rel = path.relative(cwd, absolute);
  const parts = rel.split(path.sep);
  for (let idx = 0; idx < parts.length; idx += 1) {
    const part = parts[idx];
    if (!DEFAULT_IGNORED_DIRS.has(part)) {
      continue;
    }
    const ignoredDir = path.resolve(cwd, parts.slice(0, idx + 1).join(path.sep));
    if (ignoredWhitelist.has(ignoredDir)) {
      continue;
    }
    return part;
  }
  return null;
}

function includesDotfileSegment(pattern: string): boolean {
  const segments = pattern.split("/");
  return segments.some((segment) => segment.startsWith(".") && segment.length > 1);
}

async function expandWithCustomFs(
  partitioned: PartitionedFiles,
  fsModule: MinimalFsModule,
): Promise<string[]> {
  const paths = new Set<string>();
  partitioned.literalFiles.forEach((file) => {
    paths.add(file);
  });
  for (const directory of partitioned.literalDirectories) {
    const nested = await expandDirectoryRecursive(directory, fsModule);
    nested.forEach((entry) => {
      paths.add(entry);
    });
  }
  return Array.from(paths);
}

async function expandDirectoryRecursive(
  directory: string,
  fsModule: MinimalFsModule,
): Promise<string[]> {
  const entries = await fsModule.readdir(directory);
  const results: string[] = [];
  for (const entry of entries) {
    const childPath = path.join(directory, entry);
    const stats = await fsModule.stat(childPath);
    if (stats.isDirectory()) {
      results.push(...(await expandDirectoryRecursive(childPath, fsModule)));
    } else if (stats.isFile()) {
      results.push(childPath);
    }
  }
  return results;
}

function makeDirectoryPattern(relative: string): string {
  if (relative === "." || relative === "") {
    return "**/*";
  }
  return `${stripTrailingSlashes(relative)}/**/*`;
}

function isNativeFsModule(fsModule: MinimalFsModule): boolean {
  return (
    (fsModule as unknown as Record<string, unknown>).__nativeFs === true ||
    (fsModule.readFile === DEFAULT_FS.readFile &&
      fsModule.stat === DEFAULT_FS.stat &&
      fsModule.readdir === DEFAULT_FS.readdir)
  );
}

function normalizeGlob(pattern: string, cwd: string): string {
  if (!pattern) {
    return "";
  }
  let normalized = pattern;
  if (path.isAbsolute(normalized)) {
    normalized = path.relative(cwd, normalized);
  }
  normalized = toPosix(normalized);
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function toPosixRelative(absPath: string, cwd: string): string {
  const relative = path.relative(cwd, absPath);
  if (!relative) {
    return ".";
  }
  return toPosix(relative);
}

function toPosixRelativeOrBasename(absPath: string, cwd: string): string {
  const relative = path.relative(cwd, absPath);
  return toPosix(relative || path.basename(absPath));
}

function stripTrailingSlashes(value: string): string {
  const normalized = toPosix(value);
  return normalized.replace(/\/+$/g, "");
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) {
    return `${formatScaled(size / (1024 * 1024))} MB`;
  }
  if (size >= 1024) {
    return `${formatScaled(size / 1024)} KB`;
  }
  return `${size} B`;
}

function formatScaled(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function normalizeMaxFileSizeBytes(
  value: number | string | undefined | null,
  source = "max file size",
): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value.trim() : String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${source} must be a positive integer number of bytes.`);
  }
  return parsed;
}

function relativePath(targetPath: string, cwd: string): string {
  const relative = path.relative(cwd, targetPath);
  return relative || targetPath;
}

function formatLegacyFileSection(index: number, displayPath: string, content: string): string {
  return [`### File ${index}: ${displayPath}`, "```", content.trimEnd(), "```"].join("\n");
}

export function createFileSections(files: FileContent[], cwd = process.cwd()): FileSection[] {
  return files.map((file, index) => {
    const relative = toPosix(path.relative(cwd, file.path) || file.path);
    const sectionText = formatLegacyFileSection(index + 1, relative, file.content);
    return {
      index: index + 1,
      absolutePath: file.path,
      displayPath: relative,
      sectionText,
      content: file.content,
    };
  });
}
