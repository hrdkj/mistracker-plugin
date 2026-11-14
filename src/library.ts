/** Library view: saved entries grouped by subject. */
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { pickFields, type Entry } from "./contract.ts";
import { createEntryForm, el } from "./form.ts";
import { button, childScope, errorText, subscribeRefresh } from "./ui-common.ts";

const svg = (paths: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICON_OPEN = svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const ICON_EDIT = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICON_DELETE = svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');

/** Matches the max-height of `.mt-clamp.mt-clamped` in styles.css (about 6 lines). */
const PROBLEM_CLAMP_PX = 150;

interface LibraryData { entries: Entry[]; subjects: string[] }

export function mountLibrary(ctx: PluginFrontendContext, container: HTMLElement, viewSignal: AbortSignal): () => void {
	const doc = container.ownerDocument;
	const root = el(doc, "div", "mt-root mt-library");
	container.append(root);
	const closedSubjects = new Set<string>();
	let data: LibraryData | undefined;
	let message = "";
	let scope = childScope(viewSignal);

	const openEditor = (entry: Entry) => {
		const handle = ctx.ui.openDialog({
			title: `Edit ${entry.concept}`,
			content: (body, signal) => {
				const box = el(doc, "div", "mt-root mt-dialog");
				box.append(el(doc, "h2", "mt-dialog-title", "Edit mistake"));
				const form = createEntryForm(doc, pickFields(entry), data?.subjects ?? []);
				const error = el(doc, "p", "mt-error");
				const actions = el(doc, "div", "mt-actions");
				box.append(form.element, error, actions);
				body.append(box);
				button(ctx, actions, signal, {
					label: "Save",
					onClick: async () => {
						try {
							await ctx.call("update-entry", { id: entry.id, edits: form.read() });
							handle.dispose();
							void load();
						} catch (failure) { error.textContent = errorText(failure); }
					},
				});
				button(ctx, actions, signal, { label: "Cancel", variant: "ghost", onClick: () => handle.dispose() });
				form.focus();
				return () => box.remove();
			},
		}, { signal: viewSignal });
	};

	const confirmDelete = (entry: Entry) => {
		const handle = ctx.ui.openDialog({
			title: "Delete mistake",
			content: (body, signal) => {
				const box = el(doc, "div", "mt-root mt-dialog");
				const concept = el(doc, "div", "mt-concept mt-text");
				box.append(el(doc, "h2", "mt-dialog-title", "Delete this mistake?"), concept, el(doc, "p", "mt-muted", "It will be removed permanently."));
				ctx.ui.mountMarkdown(concept, { text: entry.concept }, { signal });
				const error = el(doc, "p", "mt-error");
				const actions = el(doc, "div", "mt-actions");
				box.append(error, actions);
				body.append(box);
				button(ctx, actions, signal, {
					label: "Delete",
					variant: "destructive",
					onClick: async () => {
						try {
							await ctx.call("delete-entry", { id: entry.id });
							handle.dispose();
							void load();
						} catch (failure) { error.textContent = errorText(failure); }
					},
				});
				button(ctx, actions, signal, { label: "Cancel", variant: "ghost", onClick: () => handle.dispose() });
				return () => box.remove();
			},
		}, { signal: viewSignal });
	};

	/** Long problems are clipped to ~6 lines with a fade and a Show more / Show less toggle. */
	const mountClampedProblem = (parent: HTMLElement, text: string, signal: AbortSignal) => {
		const clamp = el(doc, "div", "mt-clamp");
		const markdown = el(doc, "div", "mt-problem");
		clamp.append(markdown);
		const toggle = el(doc, "button", "mt-toggle", "Show more");
		toggle.type = "button";
		toggle.hidden = true;
		toggle.setAttribute("aria-expanded", "false");
		parent.append(clamp, toggle);
		let expanded = false;
		const update = () => {
			const overflowing = markdown.scrollHeight > PROBLEM_CLAMP_PX + 8;
			toggle.hidden = !overflowing;
			clamp.classList.toggle("mt-clamped", overflowing && !expanded);
		};
		toggle.addEventListener("click", () => {
			expanded = !expanded;
			toggle.textContent = expanded ? "Show less" : "Show more";
			toggle.setAttribute("aria-expanded", String(expanded));
			update();
		}, { signal });
		// Markdown, math and diagrams render asynchronously, so re-measure on every size change.
		const view = doc.defaultView;
		if (view?.ResizeObserver) {
			const observer = new view.ResizeObserver(update);
			observer.observe(markdown);
			signal.addEventListener("abort", () => observer.disconnect(), { once: true });
		}
		ctx.ui.mountMarkdown(markdown, { text }, { signal });
		update();
	};

	const COLUMNS = ["Concept", "Problem", "Why it happened", "How to avoid", ""] as const;

	const cell = (label: string, className: string) => {
		const td = el(doc, "td", className);
		td.dataset.label = label;
		return td;
	};

	const renderRow = (entry: Entry, signal: AbortSignal) => {
		const row = el(doc, "tr", "mt-row");
		const concept = cell("Concept", "mt-col-concept");
		const conceptText = el(doc, "div", "mt-concept");
		concept.append(conceptText);
		ctx.ui.mountMarkdown(conceptText, { text: entry.concept }, { signal });
		const problem = cell("Problem", "mt-col-problem");
		if (entry.problemStatement) mountClampedProblem(problem, entry.problemStatement, signal);
		else problem.append(el(doc, "span", "mt-muted", "—"));
		const markdownCell = (label: string, className: string, text: string) => {
			const td = cell(label, className);
			const box = el(doc, "div", "mt-text");
			td.append(box);
			ctx.ui.mountMarkdown(box, { text }, { signal });
			return td;
		};
		const why = markdownCell("Why it happened", "mt-col-why", entry.whyHappened);
		const avoid = markdownCell("How to avoid", "mt-col-avoid", entry.howToAvoid);
		const actions = cell("", "mt-col-actions");
		const icons = el(doc, "div", "mt-icon-actions");
		actions.append(icons);
		if (entry.chatId) button(ctx, icons, signal, { label: "Open session", icon: ICON_OPEN, iconOnly: true, size: "icon-sm", variant: "ghost", title: entry.sessionTitle ? `Open “${entry.sessionTitle}”` : "Open session", onClick: () => ctx.app.openSession(entry.chatId) });
		button(ctx, icons, signal, { label: "Edit", icon: ICON_EDIT, iconOnly: true, size: "icon-sm", variant: "ghost", title: "Edit", onClick: () => openEditor(entry) });
		button(ctx, icons, signal, { label: "Delete", icon: ICON_DELETE, iconOnly: true, size: "icon-sm", variant: "ghost", title: "Delete", onClick: () => confirmDelete(entry) });
		row.append(concept, problem, why, avoid, actions);
		return row;
	};

	const renderTable = (entries: Entry[], signal: AbortSignal) => {
		const wrap = el(doc, "div", "mt-table-wrap");
		const table = el(doc, "table", "mt-table");
		const head = el(doc, "thead");
		const headRow = el(doc, "tr");
		for (const name of COLUMNS) {
			const th = el(doc, "th", undefined, name);
			if (!name) th.append(el(doc, "span", "mt-sr-only", "Actions"));
			headRow.append(th);
		}
		head.append(headRow);
		const body = el(doc, "tbody");
		for (const entry of entries) body.append(renderRow(entry, signal));
		table.append(head, body);
		wrap.append(table);
		return wrap;
	};

	const render = () => {
		scope.abort();
		scope = childScope(viewSignal);
		const signal = scope.signal;
		root.replaceChildren();
		const heading = el(doc, "div", "mt-library-header");
		heading.append(el(doc, "h1", "mt-library-title", "Mistakes"));
		root.append(heading);
		if (message) root.append(el(doc, "p", "mt-error", message));
		if (!data) {
			root.append(el(doc, "p", "mt-muted", "Loading…"));
			return;
		}
		if (!data.entries.length) {
			root.append(el(doc, "p", "mt-muted mt-empty", "No mistakes saved yet. When the practice agent spots a meaningful gap in your thinking, it will propose an entry at the end of the problem for you to save."));
			return;
		}
		heading.append(el(doc, "span", "mt-muted", `${data.entries.length} saved`));
		const groups = new Map<string, Entry[]>();
		for (const entry of data.entries) {
			const list = groups.get(entry.subject) ?? [];
			list.push(entry);
			groups.set(entry.subject, list);
		}
		const subjects = [...groups.keys()].sort((a, b) => a.localeCompare(b));
		for (const subject of subjects) {
			const entries = groups.get(subject)!;
			const group = el(doc, "details", "mt-group");
			group.open = !closedSubjects.has(subject);
			group.addEventListener("toggle", () => { if (group.open) closedSubjects.delete(subject); else closedSubjects.add(subject); });
			const summary = el(doc, "summary", "mt-group-summary");
			summary.append(el(doc, "span", "mt-group-name", subject), el(doc, "span", "mt-group-count", String(entries.length)));
			group.append(summary);
			group.append(renderTable(entries, signal));
			root.append(group);
		}
	};

	const load = async () => {
		try {
			const next = await ctx.call<LibraryData>("list-entries", {});
			if (viewSignal.aborted) return;
			data = next;
			message = "";
		} catch (error) {
			if (viewSignal.aborted) return;
			message = errorText(error);
		}
		render();
	};

	subscribeRefresh(viewSignal, () => void load());
	render();
	void load();
	return () => { scope.abort(); root.remove(); };
}
