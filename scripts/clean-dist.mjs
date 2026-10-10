import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tsc retains outputs for deleted source files; those files must not enter a release.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(projectRoot, "dist");
if (path.relative(projectRoot, destination) !== "dist") throw new Error("Unexpected build output directory");
try {
  const stat = await fs.lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Build output must be a regular directory");
  const resolved = await fs.realpath(destination);
  const resolvedRoot = await fs.realpath(projectRoot);
  const expectedPath = path.join(resolvedRoot, "dist");
  const expected = process.platform === "win32" ? expectedPath.toLowerCase() : expectedPath;
  if ((process.platform === "win32" ? resolved.toLowerCase() : resolved) !== expected) throw new Error("Build output resolves outside the project");
  await fs.rm(resolved, { recursive: true, force: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
