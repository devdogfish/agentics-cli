import { cancel, isCancel, select } from "@clack/prompts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultAllowedTools = ["codex", "claude-code", "hermes"] as const;

export interface AgenticsConfig {
  contentLibrary?: string;
  allowedTools: string[];
  defaultTool?: string;
}

interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  promptForDefaultTool?: (allowedTools: string[]) => Promise<string>;
}

export function agenticsHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENTICS_HOME ?? join(homedir(), ".agentics");
}

export function configPath(home = agenticsHome()): string {
  return join(home, "config.json");
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<AgenticsConfig> {
  const env = options.env ?? process.env;
  const home = agenticsHome(env);
  const path = configPath(home);
  const existing = await readConfig(path);
  const config: AgenticsConfig = {
    ...existing,
    allowedTools: existing.allowedTools ?? [...defaultAllowedTools],
  };
  let changed = existing.allowedTools === undefined;

  if (config.contentLibrary === undefined && env.AGENTICS_CONTENT_LIBRARY) {
    config.contentLibrary = env.AGENTICS_CONTENT_LIBRARY;
    changed = true;
  }

  if (config.defaultTool === undefined) {
    config.defaultTool = await chooseDefaultTool(config.allowedTools, options, env);
    changed = true;
  }

  if (changed) {
    await writeConfig(path, config);
  }

  return config;
}

export async function promptForTool(allowedTools: string[]): Promise<string> {
  const selected = await select({
    message: "Select default tool",
    options: allowedTools.map((tool) => ({ label: tool, value: tool })),
  });

  if (isCancel(selected)) {
    cancel("No tool selected");
    throw new Error("No tool selected");
  }

  return selected;
}

async function chooseDefaultTool(
  allowedTools: string[],
  options: LoadConfigOptions,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const envDefault = env.AGENTICS_DEFAULT_TOOL;

  if (envDefault !== undefined) {
    if (!allowedTools.includes(envDefault)) {
      throw new Error(`Default tool is not allowed: ${envDefault}`);
    }

    return envDefault;
  }

  return (options.promptForDefaultTool ?? promptForTool)(allowedTools);
}

async function readConfig(path: string): Promise<Partial<AgenticsConfig>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Partial<AgenticsConfig>;
  } catch (error) {
    if (isNotFoundError(error)) {
      return {};
    }

    throw new Error(`Invalid config at ${path}: ${errorMessage(error)}`);
  }
}

async function writeConfig(path: string, config: AgenticsConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
