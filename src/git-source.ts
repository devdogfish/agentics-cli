import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import { runCommand } from "./process.ts";

export async function gitTopLevelPath(cwd: string): Promise<string | undefined> {
  const topLevel = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    cwd,
    false,
  );
  const value = topLevel.stdout.trim();
  if (topLevel.exitCode !== 0 || value === "") {
    return undefined;
  }

  return realpath(value);
}

export async function gitRemoteOrigin(
  rootPath: string,
): Promise<string | undefined> {
  const origin = await runCommand(
    "git",
    ["config", "--get", "remote.origin.url"],
    rootPath,
    false,
  );
  const value = origin.stdout.trim();
  return origin.exitCode === 0 && value !== "" ? value : undefined;
}

export async function inferredLocalGitUpstream(
  sourcePath: string,
): Promise<string | undefined> {
  const rootPath = await gitTopLevelPath(sourcePath);
  if (rootPath === undefined) {
    return undefined;
  }

  const origin = await gitRemoteOrigin(rootPath);
  if (origin === undefined) {
    return undefined;
  }

  const resolvedSourcePath = await realpath(sourcePath);
  const relativeSourcePath = relative(rootPath, resolvedSourcePath).replaceAll(
    "\\",
    "/",
  );
  return `${origin}#${relativeSourcePath}`;
}
