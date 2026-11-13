/** Plugin-owned JSON store under ctx.dataDirectory (pattern from Flashcards' store.cjs). */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Entry } from "./contract.ts";

export interface StoreState {
	version: 1;
	revision: number;
	entries: Record<string, Entry>;
}

export interface Store {
	get(): StoreState;
	change<T>(update: (state: StoreState) => T): T;
}

export const STORE_FILE = "mistracker.json";

function atomicWrite(file: string, content: string): void {
	const temporary = `${file}.${randomUUID()}.tmp`;
	let fd: number | undefined;
	try {
		fd = fs.openSync(temporary, "wx", 0o600);
		fs.writeFileSync(fd, content);
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		fd = undefined;
		fs.renameSync(temporary, file);
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
		try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}

export function openStore(directory: string): Store {
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, STORE_FILE);
	let state: StoreState;
	try {
		state = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Could not read Mistracker data: ${(error as Error).message}`);
		state = { version: 1, revision: 0, entries: {} };
	}
	if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
		throw new Error("Unsupported or invalid Mistracker data. No data was changed.");
	}
	return {
		get: () => state,
		change(update) {
			const next = structuredClone(state);
			const result = update(next);
			next.revision++;
			atomicWrite(file, JSON.stringify(next));
			state = next;
			return result;
		},
	};
}

/** Distinct subject names of saved entries, most used first. */
export function savedSubjects(state: StoreState): string[] {
	const counts = new Map<string, number>();
	for (const entry of Object.values(state.entries)) {
		if (entry.status !== "saved") continue;
		counts.set(entry.subject, (counts.get(entry.subject) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}
