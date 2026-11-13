import type { PluginBackendContext } from "learnharness-plugin-api";
import { CHANGED_TOPIC, mergeFields, pickFields, type Entry } from "./contract.ts";
import { PRACTICE_INSTRUCTIONS } from "./instructions.ts";
import { openStore, savedSubjects, type Store } from "./store.ts";
import { createProposeTool } from "./tool.ts";

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
		store.change(state => { delete state.entries[entry.id]; });
		notify();
		return { deleted: entry.id };
	});
}
