import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createBareRemote,
  createCliTestContext,
  createGitRepository,
  git,
  runAgentics,
  type CliTestContext,
} from "./helpers/cli.ts";
import {
  configPath,
  defaultAllowedTools,
  loadConfig,
  type AgenticsConfig,
} from "../src/config.ts";

const contexts: CliTestContext[] = [];

async function setup(): Promise<CliTestContext> {
  const context = await createCliTestContext();
  contexts.push(context);
  return context;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

describe("agentics CLI", () => {
  test("prints root help and command help for the initial surface", async () => {
    const context = await setup();

    const rootHelp = await runAgentics(context, ["--help"]);
    assert.equal(rootHelp.exitCode, 0);
    assert.match(rootHelp.stdout, /Usage: agentics <command>/);

    for (const command of ["add", "install", "update", "remove"]) {
      const result = await runAgentics(context, [command, "--help"]);

      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, new RegExp(`Usage: agentics ${command}`));
    }
  });

  test("creates first-run config with default tools and selected default tool", async () => {
    const context = await setup();
    const remoteDir = await createContentLibraryRemote(context, {
      "demo-skill": {
        type: "skill",
        description: "Demo skill",
        path: "skills/demo-skill",
      },
    });

    const result = await runAgentics(context, ["add", "demo-skill"], {
      env: {
        AGENTICS_CONTENT_LIBRARY: remoteDir,
        AGENTICS_DEFAULT_TOOL: "claude-code",
      },
    });

    assert.equal(result.exitCode, 0, result.stderr);
    const config = JSON.parse(await readFile(configPath(context.homeDir), "utf8"));

    assert.deepEqual(config, {
      contentLibrary: remoteDir,
      allowedTools: ["codex", "claude-code", "hermes"],
      defaultTool: "claude-code",
    });
  });

  test("prompts for a missing default tool and saves the selected tool", async () => {
    const context = await setup();
    let promptedTools: string[] = [];

    const config = await loadConfig({
      env: {
        AGENTICS_HOME: context.homeDir,
      },
      promptForDefaultTool: async (allowedTools) => {
        promptedTools = allowedTools;
        return "hermes";
      },
    });

    assert.deepEqual(promptedTools, [...defaultAllowedTools]);
    assert.deepEqual(config, {
      allowedTools: ["codex", "claude-code", "hermes"],
      defaultTool: "hermes",
    });

    const savedConfig = JSON.parse(
      await readFile(configPath(context.homeDir), "utf8"),
    ) as AgenticsConfig;
    assert.equal(savedConfig.defaultTool, "hermes");
  });

  test("clones configured content library and reads name-keyed catalog entries", async () => {
    const context = await setup();
    const remoteDir = await createContentLibraryRemote(context, {
      "demo-skill": {
        type: "skill",
        description: "Demo skill",
        path: "skills/demo-skill",
        upstream: "https://example.com/demo-skill",
      },
    });

    await writeFile(
      configPath(context.homeDir),
      `${JSON.stringify({
        contentLibrary: remoteDir,
        allowedTools: ["codex", "claude-code", "hermes"],
        defaultTool: "codex",
      })}\n`,
    );

    const result = await runAgentics(context, ["add", "demo-skill"]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /demo-skill/);
    assert.match(result.stdout, /skill/);
    assert.match(result.stdout, /Demo skill/);
    assert.match(result.stdout, /https:\/\/example\.com\/demo-skill/);

    const reusedClone = await runAgentics(context, ["add", "demo-skill"]);
    assert.equal(reusedClone.exitCode, 0, reusedClone.stderr);

    const cloneHead = await git(join(context.homeDir, "content-library"), [
      "rev-parse",
      "HEAD",
    ]);
    assert.match(cloneHead.stdout.trim(), /^[a-f0-9]{40}$/);
  });

  test("fails with a clear error when the catalog is invalid", async () => {
    const context = await setup();
    const remoteDir = await createContentLibraryRemote(context, {
      broken: {
        type: "skill",
        description: "Broken skill",
      },
    });

    await writeFile(
      configPath(context.homeDir),
      `${JSON.stringify({
        contentLibrary: remoteDir,
        allowedTools: ["codex"],
        defaultTool: "codex",
      })}\n`,
    );

    const result = await runAgentics(context, ["add", "broken"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Invalid catalog/);
    assert.match(result.stderr, /path/);
  });
});

describe("CLI test harness", () => {
  test("runs commands with temporary home and project directories", async () => {
    const context = await setup();

    assert.notEqual(context.homeDir, context.projectDir);
    assert.ok(context.homeDir.includes(context.rootDir));
    assert.ok(context.projectDir.includes(context.rootDir));

    const result = await runAgentics(context, ["--version"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.trim(), /\d+\.\d+\.\d+/);
  });

  test("creates temporary git repositories and remotes", async () => {
    const context = await setup();
    const repoDir = join(context.rootDir, "content-library");
    const remoteDir = join(context.rootDir, "content-library.git");

    await createGitRepository(repoDir);
    await createBareRemote(remoteDir);
    await git(repoDir, ["remote", "add", "origin", remoteDir]);
    await git(repoDir, ["push", "-u", "origin", "HEAD"]);

    const bareState = await git(remoteDir, ["rev-parse", "--is-bare-repository"]);
    const remoteHead = await git(remoteDir, ["rev-parse", "HEAD"]);

    assert.equal(bareState.stdout.trim(), "true");
    assert.match(remoteHead.stdout.trim(), /^[a-f0-9]{40}$/);
  });
});

interface TestCatalogEntry {
  type?: string;
  description?: string;
  path?: string;
  upstream?: string;
}

async function createContentLibraryRemote(
  context: CliTestContext,
  catalog: Record<string, TestCatalogEntry>,
): Promise<string> {
  const repoDir = join(context.rootDir, "content-library-source");
  const remoteDir = join(context.rootDir, "content-library.git");

  await createGitRepository(repoDir);
  await mkdir(join(repoDir, "skills", "demo-skill"), { recursive: true });
  await writeFile(join(repoDir, "skills", "demo-skill", "SKILL.md"), "# Demo\n");
  await writeFile(join(repoDir, "index.json"), `${JSON.stringify(catalog)}\n`);
  await git(repoDir, ["add", "."]);
  await git(repoDir, ["commit", "-m", "add catalog"]);
  await createBareRemote(remoteDir);
  await git(repoDir, ["remote", "add", "origin", remoteDir]);
  await git(repoDir, ["push", "-u", "origin", "HEAD"]);

  return remoteDir;
}
