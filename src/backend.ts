import type { PluginBackendContext } from "learnharness-plugin-api";
import { CHANGED_TOPIC, mergeFields, pickFields, type Entry } from "./contract.ts";
import { PRACTICE_INSTRUCTIONS } from "./instructions.ts";
import { openStore, pruneEntries, savedSubjects, type Store } from "./store.ts";
import { createProposeTool } from "./tool.ts";
import { addImported, exportJson, exportMarkdown, parseJsonExport } from "./transfer.ts";
import { checkForUpdate, installUpdate, type UpdateInfo } from "./update.ts";

function objectInput(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object input.");
	return input as Record<string, unknown>;
}

function entryOf(store: Store, id: unknown, status?: Entry["status"]): Entry {
	if (typeof id !== "string") throw new Error("Entry id is required.");
	const entry = store.get().entries[id];
	if (!entry) throw new Error("That entry no longer exists.");
	if (status && entry.status !== status) throw new Error(`That entry is already ${entry.status}.`);
	return entry;
}

export function activate(ctx: PluginBackendContext): void {
	const store = openStore(ctx.dataDirectory);
	// Prune expired unsaved entries; write only when something expired.
	const now = Date.now();
	if (pruneEntries(structuredClone(store.get()), now) > 0) store.change(state => pruneEntries(state, now));
	const notify = () => { if (!ctx.signal.aborted) ctx.events.emit(CHANGED_TOPIC); };

	ctx.registerInstructions({ agents: ["practice"], text: PRACTICE_INSTRUCTIONS });
	ctx.registerTools({ agents: ["practice"], create: context => [createProposeTool(ctx, store, context, notify)] });

	const register = (name: string, handler: (input: Record<string, unknown>) => unknown) =>
		ctx.handle(name, input => {
			if (ctx.signal.aborted) throw new Error("Mistracker is not active.");
			return handler(objectInput(input));
		});

	register("get-proposal", input => {
		const entry = typeof input.id === "string" ? store.get().entries[input.id] : undefined;
		return { entry: entry ?? null, subjects: savedSubjects(store.get()) };
	});

	register("save-proposal", input => {
		const entry = entryOf(store, input.id, "pending");
		const fields = mergeFields(pickFields(entry), input.edits);
		const saved = store.change(state => {
			const next: Entry = { ...state.entries[entry.id]!, ...fields, status: "saved", updatedAt: new Date().toISOString() };
			state.entries[entry.id] = next;
			return next;
		});
		notify();
		return { entry: saved };
	});

	register("dismiss-proposal", input => {
		const entry = entryOf(store, input.id, "pending");
		const dismissed = store.change(state => {
			const next: Entry = { ...state.entries[entry.id]!, status: "dismissed", updatedAt: new Date().toISOString() };
			state.entries[entry.id] = next;
			return next;
		});
		notify();
		return { entry: dismissed };
	});

	register("list-entries", () => {
		const state = store.get();
		const entries = Object.values(state.entries)
			.filter(entry => entry.status === "saved")
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return { entries, subjects: savedSubjects(state) };
	});

	register("update-entry", input => {
		const entry = entryOf(store, input.id, "saved");
		const fields = mergeFields(pickFields(entry), input.edits);
		const updated = store.change(state => {
			const next: Entry = { ...state.entries[entry.id]!, ...fields, updatedAt: new Date().toISOString() };
			state.entries[entry.id] = next;
			return next;
		});
		notify();
		return { entry: updated };
	});

	register("delete-entry", input => {
		const entry = entryOf(store, input.id, "saved");
		const deleted = store.change(state => {
			const next: Entry = { ...state.entries[entry.id]!, status: "deleted", updatedAt: new Date().toISOString() };
			state.entries[entry.id] = next;
			return next;
		});
		notify();
		return { entry: deleted };
	});

	const stamp = () => new Date().toISOString().slice(0, 10);
	register("export-markdown", () => ({ filename: `mistracker-${stamp()}.md`, content: exportMarkdown(store.get()) }));
	register("export-json", () => ({ filename: `mistracker-${stamp()}.json`, content: JSON.stringify(exportJson(store.get()), null, "\t") + "\n" }));

	register("import-json", input => {
		if (typeof input.text !== "string") throw new Error("Choose a Mistracker JSON export to import.");
		const entries = parseJsonExport(input.text);
		const result = store.change(state => addImported(state, entries));
		if (result.added > 0) notify();
		return result;
	});

	/** Version installed by this activation's updater; the running code stays old until restart. */
	let installedVersion: string | undefined;
	let checked: UpdateInfo | undefined;
	let installing = false;
	register("check-update", async () => {
		if (installedVersion) return { current: ctx.manifest.version, installed: installedVersion };
		checked = await checkForUpdate(ctx.manifest.version, fetch, ctx.signal);
		return { current: ctx.manifest.version, latest: checked.latest, newer: checked.newer };
	});
	register("install-update", async () => {
		if (installedVersion) return { installed: installedVersion };
		if (!checked?.newer) throw new Error("Check for updates first.");
		if (installing) throw new Error("An update is already being installed.");
		const target = checked;
		installing = true;
		try { await installUpdate(target, ctx.directory, fetch, ctx.signal); }
		finally { installing = false; }
		installedVersion = target.latest;
		return { installed: installedVersion };
	});

	/** Undo: a dismissed proposal returns to pending, a deleted entry returns to saved. */
	register("restore-entry", input => {
		const entry = entryOf(store, input.id);
		const status = entry.status === "dismissed" ? "pending" : entry.status === "deleted" ? "saved" : undefined;
		if (!status) throw new Error(`That entry is ${entry.status} and cannot be restored.`);
		const restored = store.change(state => {
			const next: Entry = { ...state.entries[entry.id]!, status, updatedAt: new Date().toISOString() };
			state.entries[entry.id] = next;
			return next;
		});
		notify();
		return { entry: restored };
	});
}
