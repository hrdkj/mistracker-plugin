// Copy the built dist/ into a LearnHarness plugins directory (default: the sibling
// checkout's data/plugins). Existing plugin data/ is preserved by the host helper.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = path.resolve(root, process.env.LH_APP_DIR ?? "../learnharness");
const plugins = process.argv[2] ?? path.join(process.env.LH_DATA_DIR ?? path.join(app, "data"), "plugins");
execFileSync(process.execPath, [path.join(app, "scripts/install-plugin-local.mjs"), plugins], { cwd: root, stdio: "inherit" });
