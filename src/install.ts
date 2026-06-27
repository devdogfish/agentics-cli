import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { manifestPath } from "./config.ts";
import { exists } from "./files.ts";
import { type Catalog } from "./catalog.ts";
import {
  adoptMaterializedPackage,
  assertCanMaterializeSource,
  materializeSource,
  removeMaterializedPackage,
  resolveInside as resolvePathInside,
  type MaterializationTarget,
} from "./materialization.ts";
import {
  type AgenticType,
  type InstallScope,
} from "./tool-adapters.ts";

export {
  resolveInside,
  stripMaterializationMetadata,
} from "./materialization.ts";

export interface Manifest {
  jawfish: Record<string, ManifestEntry>;
}

export interface ManifestEntry {
  tool: string;
}

interface PathOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function readManifest(
  scope: InstallScope,
  options: PathOptions = {},
): Promise<Manifest> {
  const path = manifestPath(scope, options.env, options.cwd);
  if (!(await exists(path))) {
    return { jawfish: {} };
  }

  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<Manifest>;
  return { jawfish: parsed.jawfish ?? {} };
}

export async function writeManifest(
  scope: InstallScope,
  manifest: Manifest,
  options: PathOptions = {},
): Promise<void> {
  await writeJson(manifestPath(scope, options.env, options.cwd), manifest);
}

export async function installManifestEntry(
  agenticsRepoDir: string,
  catalog: Catalog,
  name: string,
  scope: InstallScope,
  tool: string,
  options: PathOptions = {},
): Promise<void> {
  await materialize(agenticsRepoDir, catalog, name, scope, tool, options);

  const manifest = await readManifest(scope, options);
  manifest.jawfish[name] = { tool };
  await writeManifest(scope, manifest, options);
}

export async function materialize(
  agenticsRepoDir: string,
  catalog: Catalog,
  name: string,
  scope: InstallScope,
  tool: string,
  options: PathOptions = {},
): Promise<void> {
  const entry = catalog.jawfish[name];
  if (entry === undefined) {
    throw new Error(`Unknown agentic: ${name}`);
  }

  const sourcePath = resolvePathInside(agenticsRepoDir, entry.path);
  await materializeSource(
    sourcePath,
    materializationTarget(name, entry.type, scope, tool),
    options,
  );
}

export async function removeMaterialized(
  name: string,
  type: AgenticType,
  scope: InstallScope,
  tool: string,
  options: PathOptions = {},
): Promise<void> {
  await removeMaterializedPackage(
    materializationTarget(name, type, scope, tool),
    options,
  );
}

export async function assertCanMaterializePackage(
  sourcePath: string,
  name: string,
  type: AgenticType,
  scope: InstallScope,
  tool: string,
  options: PathOptions = {},
): Promise<void> {
  await assertCanMaterializeSource(
    sourcePath,
    materializationTarget(name, type, scope, tool),
    options,
  );
}

export async function adoptMaterialized(
  name: string,
  type: AgenticType,
  scope: InstallScope,
  tool: string,
  options: PathOptions = {},
): Promise<void> {
  await adoptMaterializedPackage(
    materializationTarget(name, type, scope, tool),
    options,
  );
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function materializationTarget(
  name: string,
  type: AgenticType,
  scope: InstallScope,
  tool: string,
): MaterializationTarget {
  return {
    name,
    scope,
    tool,
    type,
  };
}
