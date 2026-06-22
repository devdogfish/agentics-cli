import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface CommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

test("published package exposes a runnable CLI", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "jawfish-package-test-"));

  try {
    const packed = await runCommand("bun", ["pm", "pack", "--destination", rootDir, "--quiet"], {
      cwd: repoRoot,
    });
    assert.equal(packed.exitCode, 0, packed.stderr);

    const tarball = packed.stdout.trim().split(/\r?\n/).at(-1);
    assert.ok(tarball, "expected bun pm pack to print a tarball path");

    const consumerDir = join(rootDir, "consumer");
    await mkdir(consumerDir);

    const initialized = await runCommand("bun", ["init", "-y"], {
      cwd: consumerDir,
    });
    assert.equal(initialized.exitCode, 0, initialized.stderr);

    const installed = await runCommand("bun", ["add", tarball], {
      cwd: consumerDir,
    });
    assert.equal(installed.exitCode, 0, installed.stderr);

    const version = await runCommand(
      join(consumerDir, "node_modules", ".bin", "jawfish"),
      ["--version"],
      { cwd: consumerDir },
    );
    assert.equal(version.exitCode, 0, version.stderr);
    assert.equal(version.stdout.trim(), "0.1.0");
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
    waitForExit(child),
  ]);

  return { exitCode, stderr, stdout };
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";

  for await (const chunk of stream) {
    output += String(chunk);
  }

  return output;
}
