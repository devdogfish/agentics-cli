import { cancel, isCancel, multiselect } from "@clack/prompts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  configureAgenticsRepoGitUser,
  ensureAgenticsRepoIgnore,
  inspectAgenticsRepo,
  type AgenticsRepoInspection,
} from "./agentics-repo.ts";
import { type Catalog } from "./catalog.ts";
import {
  assertSupportedConfiguredTool,
  configPath,
  defaultSupportedTools,
  deprecatedAgenticsRepoPath,
  existingConfigPath,
  loadConfig,
  managedAgenticsRepoPath,
  manifestPath,
  saveConfig,
  type JawfishConfig,
} from "./config.ts";
import { exists } from "./files.ts";
import {
  installManifestEntry,
  readManifest,
  type Manifest,
} from "./install.ts";
import { runCommand } from "./process.ts";

interface InitCommandArgs {
  force: boolean;
  global: boolean;
  name?: string;
  positionals: string[];
  raw: boolean;
  type?: string;
  yes: boolean;
}

export async function initCommand(args: InitCommandArgs): Promise<number> {
  if (
    args.force ||
    args.global ||
    args.name !== undefined ||
    args.positionals.length > 0 ||
    args.raw ||
    args.type !== undefined
  ) {
    console.error("Usage: jawfish init [options]");
    return 1;
  }

  const configFile = await existingConfigPath();
  if (configFile === undefined) {
    const config = await createMachineSetup();
    console.log(`Initialized jawfish at ${configPath()}`);
    console.log(`Agentics repo: ${config.agenticsRepo}`);
    if (args.yes) {
      await printAgenticsRepoInspection(config.agenticsRepo);
      return 0;
    }

    await runProjectSetup(config);
    return 0;
  }

  const config = await validateMachineSetup();
  if (args.yes) {
    await ensureProjectManifest();
    console.log(`Initialized project at ${manifestPath("project")}`);
    await printAgenticsRepoInspection(config.agenticsRepo);
    return 0;
  }

  await runProjectSetup(config);
  return 0;
}

async function createMachineSetup(): Promise<JawfishConfig> {
  const defaultTool = process.env.JAWFISH_DEFAULT_TOOL ?? firstSupportedTool();
  assertSupportedConfiguredTool(defaultTool, "JAWFISH_DEFAULT_TOOL");

  const agenticsRepo =
    process.env.JAWFISH_AGENTICS_REPO ?? managedAgenticsRepoPath();
  const config: JawfishConfig = { agenticsRepo, defaultTool };

  await saveConfig(config);
  await initializeLocalAgenticsRepo(agenticsRepo);
  await ensureGlobalManifest();
  return config;
}

function firstSupportedTool(): string {
  const [tool] = defaultSupportedTools;
  if (tool === undefined) {
    throw new Error("No supported tools configured");
  }

  return tool;
}

async function initializeLocalAgenticsRepo(agenticsRepo: string): Promise<void> {
  const agenticsRepoDir = isAbsolute(agenticsRepo)
    ? agenticsRepo
    : resolve(process.cwd(), agenticsRepo);

  await mkdir(agenticsRepoDir, { recursive: true });
  if (!(await exists(join(agenticsRepoDir, ".git")))) {
    await runCommand("git", ["init"], agenticsRepoDir);
  }

  await configureAgenticsRepoGitUser(agenticsRepoDir);
  await ensureAgenticsRepoIgnore(agenticsRepoDir);
}

async function ensureGlobalManifest(): Promise<void> {
  await ensureManifest(manifestPath("global"));
}

async function ensureProjectManifest(): Promise<void> {
  await ensureManifest(manifestPath("project"));
}

async function validateMachineSetup(): Promise<JawfishConfig> {
  const config = await loadConfig({ promptForMissingDefaultTool: false });
  if (config.agenticsRepo === undefined || config.agenticsRepo === "") {
    return config;
  }

  const configured = isAbsolute(config.agenticsRepo)
    ? config.agenticsRepo
    : resolve(process.cwd(), config.agenticsRepo);
  if (resolve(configured) !== resolve(deprecatedAgenticsRepoPath())) {
    return config;
  }

  throw new Error(
    `Nested agentics repo is no longer supported: ${configured}\n` +
      `Move the repo to ${managedAgenticsRepoPath()} and update ${configPath()}.`,
  );
}

async function ensureManifest(path: string): Promise<void> {
  if (await exists(path)) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ jawfish: {} }, null, 2)}\n`);
}

async function runProjectSetup(config: JawfishConfig): Promise<void> {
  const agenticsRepoDir = resolveAgenticsRepoPath(config.agenticsRepo);
  const inspection = await inspectAgenticsRepo(agenticsRepoDir);
  const manifest = await readManifest("project");

  console.log(`Initialized project at ${manifestPath("project")}`);
  printInspection(inspection);

  if (inspection.usable.length === 0) {
    await ensureProjectManifest();
    console.log("No registered agentics are selectable. Add or import agentics first.");
    return;
  }

  const selected = await selectProjectAgentics(inspection, manifest);
  if (selected === undefined) {
    return;
  }

  if (selected.length === 0) {
    await ensureProjectManifest();
    console.log("No project agentics selected");
    return;
  }

  const tool = configuredDefaultTool(config);
  const catalog = catalogFromInspection(inspection);
  for (const name of selected) {
    await installManifestEntry(agenticsRepoDir, catalog, name, "project", tool);
    console.log(`Installed ${name} to project`);
  }
}

async function selectProjectAgentics(
  inspection: AgenticsRepoInspection,
  manifest: Manifest,
): Promise<string[] | undefined> {
  const selected = await multiselect({
    message: "Select project agentics",
    options: inspection.usable.map(({ entry, name }) => ({
      hint: entry.description,
      label: `${name} (${entry.type})`,
      value: name,
    })),
    initialValues: Object.keys(manifest.jawfish).filter((name) =>
      inspection.usableNames.includes(name),
    ),
    required: false,
  });

  if (isCancel(selected)) {
    cancel("Project setup cancelled");
    throw new Error("Project setup cancelled");
  }

  return selected;
}

function catalogFromInspection(inspection: AgenticsRepoInspection): Catalog {
  return {
    jawfish: Object.fromEntries(
      inspection.usable.map(({ entry, name }) => [name, entry]),
    ),
  };
}

function configuredDefaultTool(config: JawfishConfig): string {
  if (config.defaultTool === undefined || config.defaultTool === "") {
    throw new Error(`Missing defaultTool in ${configPath()}`);
  }

  assertSupportedConfiguredTool(config.defaultTool, "config defaultTool");
  return config.defaultTool;
}

async function printAgenticsRepoInspection(
  agenticsRepo: string | undefined,
): Promise<void> {
  if (agenticsRepo === undefined || agenticsRepo === "") {
    console.log("Agentics repo inspection");
    console.log("Catalog: none");
    console.log("Counts: 0 skills, 0 agents, 0 prompts");
    console.log("Usable: none");
    return;
  }

  const agenticsRepoDir = isAbsolute(agenticsRepo)
    ? agenticsRepo
    : resolve(process.cwd(), agenticsRepo);
  const inspection = await inspectAgenticsRepo(agenticsRepoDir);
  printInspection(inspection);
}

function resolveAgenticsRepoPath(agenticsRepo: string | undefined): string {
  if (agenticsRepo === undefined || agenticsRepo === "") {
    throw new Error(`Missing agenticsRepo in ${configPath()}`);
  }

  return isAbsolute(agenticsRepo)
    ? agenticsRepo
    : resolve(process.cwd(), agenticsRepo);
}

function printInspection(inspection: AgenticsRepoInspection): void {
  console.log("Agentics repo inspection");
  console.log(`Catalog: ${inspection.catalogPath ?? "none"}`);
  console.log(
    `Counts: ${formatCount(inspection.counts.skill, "skill")}, ` +
      `${formatCount(inspection.counts.agent, "agent")}, ` +
      `${formatCount(inspection.counts.prompt, "prompt")}`,
  );
  console.log(`Usable: ${formatNames(inspection.usableNames)}`);

  if (
    inspection.usableNames.length === 0 &&
    inspection.broken.length === 0 &&
    inspection.skipped.length === 0
  ) {
    console.log("Repo is empty. Add or import agentics to make them selectable.");
  }

  for (const issue of inspection.broken) {
    console.log(`Broken: ${issue.target}: ${issue.reason}`);
  }
  for (const issue of inspection.skipped) {
    console.log(`Skipped: ${issue.target}: ${issue.reason}`);
  }
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatNames(names: string[]): string {
  if (names.length === 0) {
    return "none";
  }

  return names.join(", ");
}
