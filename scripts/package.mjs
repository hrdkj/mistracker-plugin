/** Package the built dist/ as release/mistracker-<version>.zip with a
 * mistracker/dist/ layout, ready to extract into a LearnHarness plugins directory. */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
for (const file of [manifest.main, manifest.backend, manifest.styles, "LICENSE"]) {
  if (!fs.existsSync(path.join(dist, file))) throw new Error(`dist/ is missing ${file}; run npm run build first.`);
}
if (fs.existsSync(path.join(dist, "data"))) throw new Error("dist/ contains data/; refusing to package plugin data.");

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-package-"));
try {
  fs.cpSync(dist, path.join(stage, manifest.id, "dist"), { recursive: true });
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir, { recursive: true });
  const zip = path.join(releaseDir, `${manifest.id}-${manifest.version}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-r", "-X", "-q", zip, manifest.id], { cwd: stage, stdio: "inherit" });
  console.log(`Packaged ${zip}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
