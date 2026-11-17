/** Plugin-owned JSON store under ctx.dataDirectory (pattern from Flashcards' store.cjs). */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UNDO_RETENTION_MS, type Cause, type Entry } from "./contract.ts";

export interface StoreState {
	version: 2;
	revision: number;
	entries: Record<string, Entry>;
}

export interface Store {
	get(): StoreState;
	change<T>(update: (state: StoreState) => T): T;
}

export const STORE_FILE = "mistracker.json";
/** Copy of the version 1 file, written once before it is migrated. */
export const V1_BACKUP_FILE = "mistracker.v1-backup.json";

const INVALID = "Unsupported or invalid Mistracker data. No data was changed.";

/** Version 1 stored a miss class and a mistake type; version 2 stores one cause. */
const V1_CAUSES: Record<string, Cause> = { structural: "Misconception", discrimination: "Mix-up", execution: "Wrong steps", careless: "Wrong steps" };
const V1_CUE_CAUSES: Record<string, Cause> = { "New info/detail": "Never learned", "Memory/Formula": "Forgot" };

function causeFromV1(entry: { missClass?: unknown; mistakeType?: unknown }): Cause {
	if (entry.missClass === "cue") return V1_CUE_CAUSES[entry.mistakeType as string] ?? "Didn't apply";
	const cause = V1_CAUSES[entry.missClass as string];
	if (!cause) throw new Error(INVALID);
	return cause;
}

function isStateShape(state: { revision?: unknown; entries?: unknown } | null): boolean {
	return !!state && Number.isSafeInteger(state.revision) && !!state.entries && typeof state.entries === "object" && !Array.isArray(state.entries);
}

function migrateV1(file: string, v1: { revision: number; entries: Record<string, Record<string, unknown>> }): StoreState {
	const entries: Record<string, Entry> = {};
	for (const [id, { missClass, mistakeType, ...rest }] of Object.entries(v1.entries)) {
		entries[id] = { ...rest, cause: causeFromV1({ missClass, mistakeType }) } as Entry;
	}
	const backup = path.join(path.dirname(file), V1_BACKUP_FILE);
	if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
	const state: StoreState = { version: 2, revision: v1.revision + 1, entries };
	atomicWrite(file, JSON.stringify(state));
	return state;
}

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
		state = { version: 2, revision: 0, entries: {} };
	}
	if (!isStateShape(state)) throw new Error(INVALID);
	if ((state.version as number) === 1) state = migrateV1(file, state as never);
	if (state.version !== 2) throw new Error(INVALID);
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

/** Remove unsaved entries (pending, dismissed or deleted) last changed more than the
 * retention window ago. Saved entries are never pruned. Returns the number removed. */
export function pruneEntries(state: StoreState, now: number): number {
	let removed = 0;
	for (const [id, entry] of Object.entries(state.entries)) {
		if (entry.status === "saved") continue;
		const changed = Date.parse(entry.updatedAt);
		if (Number.isNaN(changed) || now - changed <= UNDO_RETENTION_MS) continue;
		delete state.entries[id];
		removed++;
	}
	return removed;
}
