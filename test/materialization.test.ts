import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  adoptMaterialized,
  materialize,
  removeMaterialized,
} from "../src/install.ts";
import { type Catalog } from "../src/catalog.ts";

interface MaterializationTestContext {
  agenticsRepoDir: string;
  homeDir: string;
  options: {
    cwd: string;
    env: Record<string, string>;
  };
  projectDir: string;
  rootDir: string;
}

async function withContext(
  run: (context: MaterializationTestContext) => Promise<void>,
): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), "jawfish-materialization-"));
  try {
    const homeDir = join(rootDir, "home");
    const projectDir = join(rootDir, "project");
    await mkdir(homeDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await run({
      agenticsRepoDir: join(rootDir, "agentics"),
      homeDir,
      options: {
        cwd: projectDir,
        env: {
          HOME: homeDir,
          JAWFISH_HOME: homeDir,
          OPENCODE_CONFIG_DIR: join(homeDir, ".config", "opencode"),
          XDG_CONFIG_HOME: join(homeDir, ".config"),
        },
      },
      projectDir,
      rootDir,
    });
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

function focusCatalog(): Catalog {
  return {
    jawfish: {
      focus: {
        description: "Focus workflow",
        path: "skills/focus",
        type: "skill",
      },
    },
  };
}

function reviewPromptCatalog(): Catalog {
  return {
    jawfish: {
      review: {
        description: "Review prompt",
        path: "prompts/review",
        type: "prompt",
      },
    },
  };
}

async function writePackageFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
}

function focusSourceDir(context: MaterializationTestContext): string {
  return join(context.agenticsRepoDir, "skills", "focus");
}

function focusInstallDir(context: MaterializationTestContext): string {
  return join(context.projectDir, ".codex", "skills", "focus");
}

test("adopts native files so remove can delete managed content", async () => {
  await withContext(async (context) => {
    const nativePrompt = join(
      context.projectDir,
      ".opencode",
      "commands",
      "review.md",
    );

    await mkdir(join(context.projectDir, ".opencode", "commands"), {
      recursive: true,
    });
    await writeFile(nativePrompt, "# Review\n");

    await adoptMaterialized(
      "review",
      "prompt",
      "project",
      "opencode",
      context.options,
    );
    await removeMaterialized(
      "review",
      "prompt",
      "project",
      "opencode",
      context.options,
    );

    await assertMissing(nativePrompt);
  });
});

test("installs directory packages and removes stale managed files", async () => {
  await withContext(async (context) => {
    await writePackageFiles(focusSourceDir(context), {
      "SKILL.md": "# Focus\n",
      "old.md": "old\n",
    });
    await materialize(
      context.agenticsRepoDir,
      focusCatalog(),
      "focus",
      "project",
      "codex",
      context.options,
    );

    await writeFile(join(focusSourceDir(context), "SKILL.md"), "# New Focus\n");
    await rm(join(focusSourceDir(context), "old.md"));
    await materialize(
      context.agenticsRepoDir,
      focusCatalog(),
      "focus",
      "project",
      "codex",
      context.options,
    );

    assert.equal(
      await readFile(join(focusInstallDir(context), "SKILL.md"), "utf8"),
      "# New Focus\n",
    );
    await assertMissing(join(focusInstallDir(context), "old.md"));
  });
});

test("installs native file destinations", async () => {
  await withContext(async (context) => {
    await writePackageFiles(
      join(context.agenticsRepoDir, "prompts", "review"),
      {
        "review.md": "# Review\n",
      },
    );

    await materialize(
      context.agenticsRepoDir,
      reviewPromptCatalog(),
      "review",
      "project",
      "opencode",
      context.options,
    );

    assert.equal(
      await readFile(
        join(context.projectDir, ".opencode", "commands", "review.md"),
        "utf8",
      ),
      "# Review\n",
    );
  });
});

test("adopts matching directory installs without claiming unrelated files", async () => {
  await withContext(async (context) => {
    await writePackageFiles(focusSourceDir(context), {
      "SKILL.md": "# Focus\n",
    });
    await writePackageFiles(focusInstallDir(context), {
      "SKILL.md": "# Focus\n",
      ".library-managed.yaml": "manager: library\n",
    });

    await materialize(
      context.agenticsRepoDir,
      focusCatalog(),
      "focus",
      "project",
      "codex",
      context.options,
    );
    await removeMaterialized(
      "focus",
      "skill",
      "project",
      "codex",
      context.options,
    );

    await assertMissing(join(focusInstallDir(context), "SKILL.md"));
    assert.equal(
      await readFile(
        join(focusInstallDir(context), ".library-managed.yaml"),
        "utf8",
      ),
      "manager: library\n",
    );
  });
});

test("rejects unmanaged destination file conflicts", async () => {
  await withContext(async (context) => {
    await writePackageFiles(focusSourceDir(context), {
      "SKILL.md": "# Focus\n",
    });
    await materialize(
      context.agenticsRepoDir,
      focusCatalog(),
      "focus",
      "project",
      "codex",
      context.options,
    );
    await writeFile(join(focusInstallDir(context), "notes.md"), "manual\n");
    await writeFile(join(focusSourceDir(context), "notes.md"), "managed\n");

    await assert.rejects(
      materialize(
        context.agenticsRepoDir,
        focusCatalog(),
        "focus",
        "project",
        "codex",
        context.options,
      ),
      /Refusing to overwrite unmanaged destination file: .*\nRemove it or move it aside, then retry\./,
    );
    assert.equal(
      await readFile(join(focusInstallDir(context), "notes.md"), "utf8"),
      "manual\n",
    );
  });
});

test("remove preserves unmanaged directory files", async () => {
  await withContext(async (context) => {
    await writePackageFiles(focusSourceDir(context), {
      "SKILL.md": "# Focus\n",
    });
    await materialize(
      context.agenticsRepoDir,
      focusCatalog(),
      "focus",
      "project",
      "codex",
      context.options,
    );
    await writeFile(join(focusInstallDir(context), "user.md"), "manual\n");

    await removeMaterialized(
      "focus",
      "skill",
      "project",
      "codex",
      context.options,
    );

    await assertMissing(join(focusInstallDir(context), "SKILL.md"));
    assert.equal(
      await readFile(join(focusInstallDir(context), "user.md"), "utf8"),
      "manual\n",
    );
  });
});
