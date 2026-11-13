/** Inline transcript card for propose_mistake: Save / Edit / Dismiss. */
import type { PluginFrontendContext, PluginToolRenderProps } from "learnharness-plugin-api";
import { pickFields, type Entry } from "./contract.ts";
import { createEntryForm, el, renderFields } from "./form.ts";
import { button, childScope, errorText, subscribeRefresh } from "./ui-common.ts";

interface ProposalView { entry: Entry | null; subjects: string[] }

function proposalIdOf(tool: PluginToolRenderProps): string | undefined {
	const output = tool.output as { proposalId?: unknown } | undefined;
	return typeof output?.proposalId === "string" ? output.proposalId : undefined;
}

export function mountCard(ctx: PluginFrontendContext, container: HTMLElement, tool: PluginToolRenderProps): () => void {
	const doc = container.ownerDocument;
	const root = el(doc, "div", "mt-root mt-card");
	container.append(root);
	const cleanup = () => root.remove();

	const header = (text: string) => el(doc, "div", "mt-card-title", text);

	if (tool.state === "input-streaming" || tool.state === "input-available") {
		root.append(header("Mistracker"), el(doc, "p", "mt-muted", "Drafting a mistake entry…"));
		return cleanup;
	}
	if (tool.state === "output-error") {
		root.append(header("Mistracker"), el(doc, "p", "mt-error", tool.errorText || "The proposal could not be created."));
		return cleanup;
	}
	const proposalId = proposalIdOf(tool);
	if (!proposalId) {
		root.append(header("Mistracker"), el(doc, "p", "mt-error", "This proposal has no entry id."));
		return cleanup;
	}

	let scope = childScope(tool.signal);
	let editing = false;
	let busy = false;
	let current: ProposalView | undefined;
	let message = "";

	const render = () => {
		scope.abort();
		scope = childScope(tool.signal);
		const signal = scope.signal;
		root.replaceChildren();
		const entry = current?.entry;
		if (!current) {
			root.append(header("Mistracker"), el(doc, "p", "mt-muted", message || "Loading…"));
			return;
		}
		if (!entry) {
			root.append(header("Mistracker"), el(doc, "p", "mt-muted", "This entry was deleted."));
			return;
		}
		if (entry.status === "saved") {
			root.classList.add("mt-card-compact");
			const line = el(doc, "div", "mt-status-line");
			line.append(el(doc, "span", "mt-status mt-status-saved", "Saved to Mistracker"), el(doc, "span", "mt-muted", ` · ${entry.subject} · ${entry.concept}`));
			root.append(line);
			button(ctx, line, signal, { label: "Open library", variant: "link", onClick: () => ctx.app.openView("library") });
			return;
		}
		if (entry.status === "dismissed") {
			root.classList.add("mt-card-compact");
			const line = el(doc, "div", "mt-status-line");
			line.append(el(doc, "span", "mt-status", "Mistake proposal dismissed"), el(doc, "span", "mt-muted", ` · ${entry.concept}`));
			root.append(line);
			return;
		}
		root.classList.remove("mt-card-compact");
		root.append(header("Add this to your mistake tracker?"));
		const form = editing ? createEntryForm(doc, pickFields(entry), current.subjects) : undefined;
		root.append(form ? form.element : renderFields(doc, entry, (box, text) => { ctx.ui.mountMarkdown(box, { text }, { signal }); }));
		if (message) root.append(el(doc, "p", "mt-error", message));
		const actions = el(doc, "div", "mt-actions");
		root.append(actions);
		const run = async (operation: string, input: unknown) => {
			if (busy) return;
			busy = true;
			message = "";
			try {
				const result = await ctx.call<{ entry: Entry }>(operation, input);
				if (tool.signal.aborted) return;
				current = { entry: result.entry, subjects: current?.subjects ?? [] };
				editing = false;
			} catch (error) {
				message = errorText(error);
			} finally {
				busy = false;
				if (!tool.signal.aborted) render();
			}
		};
		if (form) {
			button(ctx, actions, signal, { label: "Save", onClick: () => run("save-proposal", { id: entry.id, edits: form.read() }) });
			button(ctx, actions, signal, { label: "Cancel", variant: "ghost", onClick: () => { editing = false; message = ""; render(); } });
			form.focus();
		} else {
			button(ctx, actions, signal, { label: "Save", onClick: () => run("save-proposal", { id: entry.id }) });
			button(ctx, actions, signal, { label: "Edit", variant: "outline", onClick: () => { editing = true; message = ""; render(); } });
			button(ctx, actions, signal, { label: "Dismiss", variant: "ghost", onClick: () => run("dismiss-proposal", { id: entry.id }) });
		}
	};

	const load = async () => {
		try {
			const view = await ctx.call<ProposalView>("get-proposal", { id: proposalId });
			if (tool.signal.aborted) return;
			const changed = current?.entry?.status !== view.entry?.status || current?.entry?.updatedAt !== view.entry?.updatedAt;
			current = view;
			// Keep an open edit form unless the entry changed elsewhere.
			if (editing && !changed) return;
			if (changed) editing = false;
			render();
		} catch (error) {
			if (tool.signal.aborted) return;
			message = errorText(error);
			render();
		}
	};

	subscribeRefresh(tool.signal, () => { if (!busy) void load(); });
	render();
	void load();
	return () => { scope.abort(); cleanup(); };
}
