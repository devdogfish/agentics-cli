#!/usr/bin/env -S node --experimental-strip-types
import { fileURLToPath } from "node:url";
import { agenticsHome, loadConfig, promptForTool } from "./config.ts";
import { readCatalog } from "./catalog.ts";
import { ensureContentLibrary } from "./library.ts";

const version = "0.1.0";

interface CommandSpec {
  description: string;
  summary: string;
  usage: string;
  options: string[];
}

const commandSpecs = {
  add: {
    description: "Install an agentic from the library, or import a URL/local path later.",
    summary: "Install or import an agentic",
    usage: "agentics add [options] <name|source>",
    options: [
      "-g, --global    Install globally",
      "--name <name>   Override imported package name",
      "-h, --help      Show help",
    ],
  },
  install: {
    description: "Materialize manifest agentics into tool-native directories later.",
    summary: "Materialize manifest agentics",
    usage: "agentics install [options]",
    options: ["-g, --global    Install global manifest", "-h, --help      Show help"],
  },
  update: {
    description: "Refresh one or all upstream-backed agentics later.",
    summary: "Update upstream-backed agentics",
    usage: "agentics update [options] [name]",
    options: [
      "-F, --force     Replace dirty package contents",
      "-h, --help      Show help",
    ],
  },
  remove: {
    description: "Remove installed managed agentics later.",
    summary: "Remove installed agentics",
    usage: "agentics remove [options] <name>",
    options: ["-g, --global    Remove global install", "-h, --help      Show help"],
  },
} as const satisfies Record<string, CommandSpec>;

type CommandName = keyof typeof commandSpecs;
const commandNames = Object.keys(commandSpecs) as CommandName[];

export { promptForTool };

export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  if (command === undefined || isHelp(command)) {
    printRootHelp();
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(version);
    return 0;
  }

  if (isCommandName(command)) {
    if (args.some(isHelp)) {
      printCommandHelp(command);
      return 0;
    }

    if (command === "add") {
      return handleAdd(args);
    }

    printCommandStub(command);
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run agentics --help for usage.");
  return 1;
}

function printRootHelp(): void {
  console.log(`agentics ${version}

Usage: agentics <command> [options]

Commands:
${commandNames
  .map((command) => `  ${command.padEnd(10)}${commandSpecs[command].summary}`)
  .join("\n")}

Options:
  -h, --help      Show help
  -v, --version   Show version`);
}

function printCommandHelp(command: CommandName): void {
  const spec = commandSpecs[command];

  console.log(`${spec.description}

Usage: ${spec.usage}

Options:
${spec.options.map((option) => `  ${option}`).join("\n")}`);
}

function printCommandStub(command: CommandName): void {
  printCommandHelp(command);
  console.log("");
  console.log(`agentics ${command} behavior will be implemented in a later slice.`);
}

async function handleAdd(args: string[]): Promise<number> {
  const name = firstPositionalArg(args);

  if (name === undefined) {
    printCommandHelp("add");
    return 1;
  }

  try {
    const home = agenticsHome();
    const config = await loadConfig();
    const libraryDir = await ensureContentLibrary(config, home);
    const catalog = await readCatalog(libraryDir);
    const entry = catalog[name];

    if (entry === undefined) {
      console.error(`Agentic not found in catalog: ${name}`);
      return 1;
    }

    console.log(`${name} (${entry.type})`);
    console.log(entry.description);
    console.log(`tool: ${config.defaultTool}`);
    console.log(`path: ${entry.path}`);

    if (entry.upstream !== undefined) {
      console.log(`upstream: ${entry.upstream}`);
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function firstPositionalArg(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--name") {
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    return arg;
  }

  return undefined;
}

function isHelp(value: string): boolean {
  return value === "--help" || value === "-h";
}

function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(commandSpecs, value);
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === process.argv[1]
  );
}

if (isMainModule()) {
  process.exitCode = await run(process.argv.slice(2));
}
