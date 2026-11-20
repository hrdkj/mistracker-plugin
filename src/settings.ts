/** Mistracker settings: export and import entries, and update the plugin from GitHub. */
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { el } from "./form.ts";
import { button, childScope, errorText } from "./ui-common.ts";

interface ExportFile { filename: string; content: string }
interface UpdateCheck { current: string; latest?: string; newer?: boolean; installed?: string }

function download(doc: Document, file: ExportFile, type: string): void {
	const url = URL.createObjectURL(new Blob([file.content], { type }));
	const link = el(doc, "a");
	link.href = url;
	link.download = file.filename;
	doc.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function mountSettings(ctx: PluginFrontendContext, container: HTMLElement, hostSignal: AbortSignal): () => void {
	const doc = container.ownerDocument;
	const scope = childScope(hostSignal);
	const signal = scope.signal;
	const root = el(doc, "div", "mt-root mt-settings");
	container.append(root);

	const section = (title: string, description: string) => {
		const box = el(doc, "section", "mt-settings-section");
		box.append(el(doc, "h3", "mt-settings-title", title), el(doc, "p", "mt-muted mt-settings-text", description));
		const actions = el(doc, "div", "mt-actions");
		const status = el(doc, "p", "mt-settings-status");
		status.setAttribute("role", "status");
		const error = el(doc, "p", "mt-error");
		error.setAttribute("role", "alert");
		box.append(actions, status, error);
		root.append(box);
		return { actions, status, error };
	};
	/** Run one action at a time per section, showing its result or error. */
	const runner = (parts: { status: HTMLElement; error: HTMLElement }) => {
		let busy = false;
		return async (work: () => Promise<string>) => {
			if (busy || signal.aborted) return;
			busy = true;
			parts.error.textContent = "";
			try {
				const message = await work();
				if (!signal.aborted) parts.status.textContent = message;
			} catch (error) {
				if (!signal.aborted) { parts.status.textContent = ""; parts.error.textContent = errorText(error); }
			} finally {
				busy = false;
			}
		};
	};

	const data = section("Data", "Export your saved mistakes as Markdown to read or give to an AI, or as JSON to back them up. Importing a JSON export adds the entries you don't have yet.");
	const runData = runner(data);
	const exportAs = (operation: string, type: string, label: string) => runData(async () => {
		const file = await ctx.call<ExportFile>(operation, {});
		if (signal.aborted) return "";
		download(doc, file, type);
		return `${label} saved as ${file.filename}.`;
	});
	button(ctx, data.actions, signal, { label: "Export Markdown", variant: "outline", onClick: () => exportAs("export-markdown", "text/markdown", "Markdown export") });
	button(ctx, data.actions, signal, { label: "Export JSON", variant: "outline", onClick: () => exportAs("export-json", "application/json", "JSON export") });
	const picker = el(doc, "input");
	picker.type = "file";
	picker.accept = ".json,application/json";
	picker.hidden = true;
	picker.addEventListener("change", () => {
		const file = picker.files?.[0];
		picker.value = "";
		if (!file) return;
		void runData(async () => {
			const result = await ctx.call<{ added: number; skipped: number }>("import-json", { text: await file.text() });
			const added = `Imported ${result.added} ${result.added === 1 ? "entry" : "entries"}`;
			return result.skipped ? `${added}; skipped ${result.skipped} you already had.` : `${added}.`;
		});
	}, { signal });
	data.actions.append(picker);
	button(ctx, data.actions, signal, { label: "Import JSON", variant: "outline", onClick: () => picker.click() });

	const updates = section("Updates", `Installed version: ${ctx.manifest.version}. Checking contacts GitHub; nothing is downloaded until you choose to update.`);
	const runUpdate = runner(updates);
	const install = el(doc, "div", "mt-actions");
	install.hidden = true;
	updates.actions.after(install);
	const showInstalled = (version: string) => {
		install.hidden = true;
		return `Mistracker ${version} is installed. Restart LearnHarness to finish updating.`;
	};
	button(ctx, updates.actions, signal, {
		label: "Check for updates",
		variant: "outline",
		onClick: () => runUpdate(async () => {
			const result = await ctx.call<UpdateCheck>("check-update", {});
			if (result.installed) return showInstalled(result.installed);
			install.hidden = !result.newer;
			return result.newer ? `Mistracker ${result.latest} is available.` : `You have the latest version (${result.current}).`;
		}),
	});
	button(ctx, install, signal, {
		label: "Update",
		onClick: () => runUpdate(async () => {
			updates.status.textContent = "Downloading and installing…";
			const result = await ctx.call<{ installed: string }>("install-update", {});
			return showInstalled(result.installed);
		}),
	});

	return () => { scope.abort(); root.remove(); };
}
