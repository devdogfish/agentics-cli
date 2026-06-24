import { cancel, isCancel, select } from "@clack/prompts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { errorHasCode, errorMessage } from "./errors.ts";
import { supportedTools } from "./tool-adapters.ts";

export const defaultSupportedTools = supportedTools;

export interface JawfishConfig {
  contentLibrary?: string;
  defaultTool?: string;
}

interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  promptForDefaultTool?: (supportedTools: string[]) => Promise<string>;
}

export function jawfishHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.JAWFISH_HOME ?? join(homedir(), ".jawfish");
}

export function configPath(home = jawfishHome()): string {
  return join(home, "config.json");
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<JawfishConfig> {
  const env = options.env ?? process.env;
  const home = jawfishHome(env);
  const filePath = configPath(home);
  const existing = await readConfig(filePath);
  const { allowedTools: _allowedTools, ...config } = existing;
  let changed = existing.allowedTools !== undefined;

  if (config.contentLibrary === undefined && env.JAWFISH_CONTENT_LIBRARY) {
    config.contentLibrary = env.JAWFISH_CONTENT_LIBRARY;
    changed = true;
  }

  if (config.defaultTool === undefined) {
    config.defaultTool = await chooseDefaultTool(options, env);
    changed = true;
  } else {
    assertSupportedDefaultTool(config.defaultTool, "config defaultTool");
  }

  if (changed) {
    await writeConfig(filePath, config);
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
  options: LoadConfigOptions,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const envDefault = env.JAWFISH_DEFAULT_TOOL;

  if (envDefault !== undefined) {
    assertSupportedDefaultTool(envDefault, "JAWFISH_DEFAULT_TOOL");
    return envDefault;
  }

  const selected = await (options.promptForDefaultTool ?? promptForTool)([
    ...supportedTools,
  ]);
  assertSupportedDefaultTool(selected, "selected default tool");
  return selected;
}

type RawConfig = Partial<JawfishConfig> & { allowedTools?: unknown };

async function readConfig(path: string): Promise<RawConfig> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RawConfig;
  } catch (error) {
    if (errorHasCode(error, "ENOENT")) {
      return {};
    }

    throw new Error(`Invalid config at ${path}: ${errorMessage(error)}`);
  }
}

async function writeConfig(path: string, config: JawfishConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

function assertSupportedDefaultTool(tool: string, source: string): void {
  if (!supportedTools.includes(tool as (typeof supportedTools)[number])) {
    throw new Error(
      `Unsupported ${source}: ${tool}. Supported tools: ${supportedTools.join(", ")}`,
    );
  }
}
