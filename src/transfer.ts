/** Export saved entries as Markdown or JSON, and import a JSON export. */
import { validateFields, type Entry } from "./contract.ts";
import { savedSubjects, type StoreState } from "./store.ts";

export const EXPORT_FORMAT = "mistracker-export";
export const EXPORT_VERSION = 1;

export interface JsonExport {
	format: typeof EXPORT_FORMAT;
	version: typeof EXPORT_VERSION;
	exportedAt: string;
	entries: Entry[];
}

function savedEntries(state: StoreState): Entry[] {
	return Object.values(state.entries)
		.filter(entry => entry.status === "saved")
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const day = (iso: string) => iso.slice(0, 10);

/** Every saved entry grouped by subject (most used subject first, newest entry first). */
export function exportMarkdown(state: StoreState, now = new Date()): string {
	const entries = savedEntries(state);
	const lines = [
		`# My mistakes (Mistracker export, ${day(now.toISOString())})`,
		"",
		"Mistakes I made while practising, saved in Mistracker and grouped by subject. Each entry gives the concept, its cause, the date, the problem, why I made the mistake and how to avoid it.",
	];
	for (const subject of savedSubjects(state)) {
		lines.push("", `## ${subject}`);
		for (const entry of entries.filter(entry => entry.subject === subject)) {
			lines.push("", `### ${entry.concept}`, "", `Cause: ${entry.cause} · ${day(entry.createdAt)}`);
			if (entry.problemStatement.trim()) lines.push("", "**Problem:**", "", entry.problemStatement.trim());
			lines.push("", "**Why:**", "", entry.whyHappened, "", "**How to avoid:**", "", entry.howToAvoid);
		}
	}
	return lines.join("\n") + "\n";
}

export function exportJson(state: StoreState, now = new Date()): JsonExport {
	return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), entries: savedEntries(state) };
}

const INVALID = "That file is not a Mistracker JSON export. Nothing was imported.";

function text(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function isoDate(value: unknown, fallback: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/** Parse and validate an export without changing anything; throws on any invalid entry. */
export function parseJsonExport(raw: string, now = new Date()): Entry[] {
	let data: unknown;
	try { data = JSON.parse(raw); } catch { throw new Error(INVALID); }
	const value = data as Partial<JsonExport> | null;
	if (!value || value.format !== EXPORT_FORMAT || !Array.isArray(value.entries)) throw new Error(INVALID);
	if (value.version !== EXPORT_VERSION) throw new Error("This export comes from a newer Mistracker. Update Mistracker, then import it. Nothing was imported.");
	const stamp = now.toISOString();
	const seen = new Set<string>();
	return value.entries.map((item, index) => {
		const input = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
		const id = input.id;
		if (typeof id !== "string" || !id.trim()) throw new Error(`Entry ${index + 1} has no id. Nothing was imported.`);
		if (seen.has(id)) throw new Error(`Entry ${index + 1} repeats an id. Nothing was imported.`);
		seen.add(id);
		let fields;
		try { fields = validateFields(input); } catch (error) { throw new Error(`Entry ${index + 1}: ${(error as Error).message} Nothing was imported.`); }
		const createdAt = isoDate(input.createdAt, stamp);
		return {
			...fields,
			id,
			status: "saved",
			chatId: text(input.chatId),
			sessionTitle: text(input.sessionTitle),
			problemStatement: text(input.problemStatement),
			toolCallId: text(input.toolCallId),
			createdAt,
			updatedAt: stamp,
		} satisfies Entry;
	});
}

/** Add imported entries the library does not have yet; a pending, dismissed or deleted entry
 * with the same id is replaced by the saved import. Returns how many were added and skipped. */
export function addImported(state: StoreState, entries: Entry[]): { added: number; skipped: number } {
	let added = 0;
	for (const entry of entries) {
		if (state.entries[entry.id]?.status === "saved") continue;
		state.entries[entry.id] = entry;
		added++;
	}
	return { added, skipped: entries.length - added };
}
