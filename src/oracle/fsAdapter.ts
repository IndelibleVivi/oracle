import type { MinimalFsModule } from "./types.js";

type FsLike = Pick<typeof import("node:fs/promises"), "stat" | "readdir" | "readFile">;

export function createFsAdapter(fsModule: FsLike): MinimalFsModule {
  const adapter: MinimalFsModule = {
    stat: (targetPath: string) => fsModule.stat(targetPath),
    readdir: (targetPath: string) => fsModule.readdir(targetPath),
    readFileBytes: (targetPath: string) => fsModule.readFile(targetPath),
    readFile: (targetPath: string, encoding: NodeJS.BufferEncoding) =>
      fsModule.readFile(targetPath, encoding),
  };
  // Mark adapters so downstream callers can treat them as native filesystem access.
  (adapter as unknown as Record<string, boolean>).__nativeFs = true;
  return adapter;
}
