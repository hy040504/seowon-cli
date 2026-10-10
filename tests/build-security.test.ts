import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seowon-build-security-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  await fs.copyFile("scripts/clean-dist.mjs", path.join(root, "scripts", "clean-dist.mjs"));
  return root;
}

test("build cleanup removes obsolete generated files and preserves source and local credentials", async (t) => {
  const root = await setup(t);
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist", "obsolete.js"), "old generated code");
  await fs.writeFile(path.join(root, ".env"), "SEOWON_PW=DEMO_PASSWORD_NOT_REAL");
  await fs.mkdir(path.join(root, "lib"));
  await fs.writeFile(path.join(root, "lib", "source.ts"), "current source");
  const result = spawnSync(process.execPath, ["scripts/clean-dist.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(fs.stat(path.join(root, "dist")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(root, ".env"), "utf8"), "SEOWON_PW=DEMO_PASSWORD_NOT_REAL");
  assert.equal(await fs.readFile(path.join(root, "lib", "source.ts"), "utf8"), "current source");
});

test("build cleanup refuses a linked output directory and preserves its target", async (t) => {
  const root = await setup(t);
  const outside = path.join(root, "private-files");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep.txt"), "preserve");
  try { await fs.symlink(outside, path.join(root, "dist"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Symlink privilege unavailable"); return; }
    throw error;
  }
  const result = spawnSync(process.execPath, ["scripts/clean-dist.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "preserve");
  assert.equal((await fs.lstat(path.join(root, "dist"))).isSymbolicLink(), true);
});
