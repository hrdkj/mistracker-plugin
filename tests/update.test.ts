import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkForUpdate, compareVersions, distFromZip, installUpdate, readZip, swapDist, type Fetch } from "../src/update.ts";

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-update-"));

/** Build a release-shaped zip (mistracker/dist/...) with the system zip tool. */
function releaseZip(version: string, options: { stored?: boolean; extra?: Record<string, string>; manifest?: object } = {}): Buffer {
	const stage = temp();
	const dist = path.join(stage, "mistracker", "dist");
	fs.mkdirSync(dist, { recursive: true });
	const manifest = options.manifest ?? { id: "mistracker", version, main: "main.js", backend: "backend.cjs", styles: "styles.css" };
	const files: Record<string, string> = { "manifest.json": JSON.stringify(manifest), "main.js": `// main ${version}\n`.repeat(50), "backend.cjs": `// backend ${version}\n`, "styles.css": "", ...options.extra };
	for (const [name, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(stage, name.startsWith("../") ? name.slice(3) : path.join("mistracker/dist", name))), { recursive: true });
		fs.writeFileSync(name.startsWith("../") ? path.join(stage, name.slice(3)) : path.join(dist, name), content);
	}
	const zip = path.join(stage, "out.zip");
	execFileSync("zip", ["-r", "-X", "-q", ...(options.stored ? ["-0"] : []), zip, "."], { cwd: stage });
	return fs.readFileSync(zip);
}

function installed(version = "0.3.0") {
	const plugin = temp();
	const dist = path.join(plugin, "dist");
	fs.mkdirSync(dist);
	fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify({ id: "mistracker", version }));
	fs.mkdirSync(path.join(plugin, "data"));
	fs.writeFileSync(path.join(plugin, "data", "mistracker.json"), "{\"keep\":true}");
	return { plugin, dist };
}

function fakeFetch(version: string, zip: Buffer): Fetch {
	return async url => url.includes("api.github.com")
		? new Response(JSON.stringify({ tag_name: `v${version}`, assets: [{ name: `mistracker-${version}.zip`, browser_download_url: `https://example.test/mistracker-${version}.zip` }] }))
		: new Response(new Uint8Array(zip));
}

test("versions compare numerically", () => {
	assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
	assert.ok(compareVersions("0.3.0", "0.3.1") < 0);
	assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
});

test("reads deflated and stored zips", () => {
	for (const stored of [false, true]) {
		const files = readZip(releaseZip("0.4.0", { stored }));
		assert.equal(files.get("mistracker/dist/main.js")?.toString(), "// main 0.4.0\n".repeat(50));
		assert.ok(!files.has("mistracker/dist/"), "directories are skipped");
	}
	assert.throws(() => readZip(Buffer.from("not a zip")), /not a valid zip/);
});

test("rejects packages that are not this release", () => {
	assert.throws(() => distFromZip(releaseZip("0.4.0"), "0.5.0"), /says it is 0.4.0, not 0.5.0/);
	assert.throws(() => distFromZip(releaseZip("0.4.0", { manifest: { id: "other", version: "0.4.0" } }), "0.4.0"), /not a Mistracker package/);
	assert.throws(() => distFromZip(releaseZip("0.4.0", { extra: { "../stray.txt": "x" } }), "0.4.0"), /unexpected file: stray.txt/);
	assert.throws(() => distFromZip(releaseZip("0.4.0", { extra: { "data/mistracker.json": "{}" } }), "0.4.0"), /data folder/);
});

test("checks GitHub and installs the new dist, keeping data", async () => {
	const { plugin, dist } = installed();
	const fetcher = fakeFetch("0.4.0", releaseZip("0.4.0"));
	const info = await checkForUpdate("0.3.0", fetcher);
	assert.equal(info.latest, "0.4.0");
	assert.equal(info.newer, true);
	assert.equal((await checkForUpdate("0.4.0", fetcher)).newer, false);

	await installUpdate(info, dist, fetcher);
	assert.equal(JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8")).version, "0.4.0");
	assert.equal(fs.readFileSync(path.join(dist, "backend.cjs"), "utf8"), "// backend 0.4.0\n");
	assert.equal(fs.readFileSync(path.join(plugin, "data", "mistracker.json"), "utf8"), "{\"keep\":true}");
	assert.deepEqual(fs.readdirSync(plugin).sort(), ["data", "dist"], "the staging folder is removed");
});

test("a failed swap leaves the old dist in place", () => {
	const { plugin, dist } = installed();
	const files = new Map([["manifest.json", Buffer.from("{}")], ["sub", Buffer.from("file")], ["sub/x.js", Buffer.from("conflict")]]);
	assert.throws(() => swapDist(dist, files));
	assert.equal(JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8")).version, "0.3.0");
	assert.deepEqual(fs.readdirSync(plugin).sort(), ["data", "dist"]);
});

test("refuses to update a plugin that is not installed in a dist folder", () => {
	assert.throws(() => swapDist(path.join(temp(), "mistracker"), new Map()), /community plugin/);
});

test("reports a release without the zip asset", async () => {
	const fetcher: Fetch = async () => new Response(JSON.stringify({ tag_name: "v0.4.0", assets: [] }));
	await assert.rejects(checkForUpdate("0.3.0", fetcher), /has no mistracker-0.4.0.zip/);
});
