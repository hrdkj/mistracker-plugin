/** Check GitHub for a newer Mistracker release and swap it into the installed dist/. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const RELEASES_API = "https://api.github.com/repos/hrdkj/mistracker-plugin/releases/latest";
const PLUGIN_ID = "mistracker";
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

export interface UpdateInfo {
	current: string;
	latest: string;
	newer: boolean;
	assetUrl: string;
}

export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** Compare x.y.z versions numerically; returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.split(".").map(part => Number.parseInt(part, 10) || 0);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
	return 0;
}

export async function checkForUpdate(current: string, fetcher: Fetch, signal?: AbortSignal): Promise<UpdateInfo> {
	const response = await fetcher(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "mistracker-plugin" }, signal });
	if (!response.ok) throw new Error(`Could not check for updates (GitHub answered ${response.status}).`);
	const release = await response.json() as { tag_name?: unknown; assets?: { name?: unknown; browser_download_url?: unknown }[] };
	const latest = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
	if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("The latest release has no version number.");
	const asset = (release.assets ?? []).find(a => a.name === `${PLUGIN_ID}-${latest}.zip`);
	const assetUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
	if (!assetUrl.startsWith("https://")) throw new Error(`Release ${latest} has no ${PLUGIN_ID}-${latest}.zip download.`);
	return { current, latest, newer: compareVersions(latest, current) > 0, assetUrl };
}

/** Read every file in a zip archive (stored or deflated, no zip64). */
export function readZip(zip: Buffer): Map<string, Buffer> {
	const bad = (why: string): never => { throw new Error(`The downloaded update is not a valid zip (${why}).`); };
	let end = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
	}
	if (end < 0) bad("no end record");
	const count = zip.readUInt16LE(end + 10);
	let offset = zip.readUInt32LE(end + 16);
	const files = new Map<string, Buffer>();
	for (let n = 0; n < count; n++) {
		if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) bad("broken directory");
		const method = zip.readUInt16LE(offset + 10);
		const crc = zip.readUInt32LE(offset + 16);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const size = zip.readUInt32LE(offset + 24);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const local = zip.readUInt32LE(offset + 42);
		const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) bad("zip64 is not supported");
		if (name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) bad(`unsafe path ${name}`);
		if (name.endsWith("/")) continue;
		if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) bad("broken file header");
		const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const raw = zip.subarray(start, start + compressedSize);
		if (raw.length !== compressedSize) bad("truncated file");
		const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : bad(`unsupported compression ${method}`);
		if (data.length !== size) bad(`wrong size for ${name}`);
		if (typeof zlib.crc32 === "function" && (zlib.crc32(data) >>> 0) !== crc) bad(`checksum mismatch for ${name}`);
		files.set(name, data);
	}
	return files;
}

/** The release's mistracker/dist/ files, keyed by path inside dist/; checks the manifest. */
export function distFromZip(zip: Buffer, expectedVersion: string): Map<string, Buffer> {
	const prefix = `${PLUGIN_ID}/dist/`;
	const dist = new Map<string, Buffer>();
	for (const [name, data] of readZip(zip)) {
		if (!name.startsWith(prefix)) throw new Error(`The update contains an unexpected file: ${name}.`);
		dist.set(name.slice(prefix.length), data);
	}
	const manifestData = dist.get("manifest.json");
	if (!manifestData) throw new Error("The update has no manifest.json.");
	const manifest = JSON.parse(manifestData.toString("utf8")) as Record<string, unknown>;
	if (manifest.id !== PLUGIN_ID) throw new Error("The update is not a Mistracker package.");
	if (manifest.version !== expectedVersion) throw new Error(`The update says it is ${String(manifest.version)}, not ${expectedVersion}.`);
	for (const key of ["main", "backend", "styles"]) {
		const file = manifest[key];
		if (typeof file === "string" && !dist.has(file)) throw new Error(`The update is missing ${file}.`);
	}
	if ([...dist.keys()].some(name => name === "data" || name.startsWith("data/"))) throw new Error("The update contains a data folder.");
	return dist;
}

/** Replace distDirectory with the given files; the old dist/ is restored if anything fails. */
export function swapDist(distDirectory: string, files: Map<string, Buffer>): void {
	if (path.basename(distDirectory) !== "dist") throw new Error("Mistracker can update itself only when installed as a community plugin.");
	const plugin = path.dirname(distDirectory);
	const stage = fs.mkdtempSync(path.join(plugin, ".update-"));
	const next = path.join(stage, "next");
	const previous = path.join(stage, "previous");
	let movedOld = false;
	let installed = false;
	let keepStage = false;
	try {
		for (const [name, data] of files) {
			const output = path.join(next, name);
			fs.mkdirSync(path.dirname(output), { recursive: true });
			fs.writeFileSync(output, data);
		}
		fs.renameSync(distDirectory, previous);
		movedOld = true;
		fs.renameSync(next, distDirectory);
		installed = true;
	} catch (error) {
		if (movedOld && !installed) {
			try { fs.renameSync(previous, distDirectory); }
			catch (rollbackError) {
				keepStage = true;
				throw new Error(`Update failed and the old version could not be put back. It is kept at ${previous}: ${(rollbackError as Error).message}`, { cause: error });
			}
		}
		throw error;
	} finally {
		if (!keepStage) fs.rmSync(stage, { recursive: true, force: true });
	}
}

/** Download the release zip for info.latest and install it over distDirectory. */
export async function installUpdate(info: UpdateInfo, distDirectory: string, fetcher: Fetch, signal?: AbortSignal): Promise<void> {
	const response = await fetcher(info.assetUrl, { headers: { "User-Agent": "mistracker-plugin" }, signal });
	if (!response.ok) throw new Error(`Could not download the update (GitHub answered ${response.status}).`);
	const zip = Buffer.from(await response.arrayBuffer());
	if (zip.length > MAX_ZIP_BYTES) throw new Error("The update download is unexpectedly large.");
	signal?.throwIfAborted();
	swapDist(distDirectory, distFromZip(zip, info.latest));
}
