import type { PluginFrontendContext } from "learnharness-plugin-api";
import { CHANGED_TOPIC, TOOL_NAME } from "./contract.ts";
import { mountCard } from "./card.ts";
import { mountLibrary } from "./library.ts";
import { refreshers } from "./ui-common.ts";

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

export function activate(ctx: PluginFrontendContext): void {
	const refreshAll = () => { for (const refresh of [...refreshers]) refresh(); };
	ctx.onNotification(event => { if (event.topic === CHANGED_TOPIC) refreshAll(); });
	ctx.onResync(refreshAll);
	ctx.cleanup(() => refreshers.clear());

	ctx.registerToolRenderer({ toolName: TOOL_NAME, mount: (container, tool) => mountCard(ctx, container, tool) });
	ctx.registerView({ id: "library", name: "Mistracker", mount: (container, signal) => mountLibrary(ctx, container, signal) });
	ctx.registerAction({ id: "open-library", name: "Mistracker", icon: ICON, run: () => ctx.app.openView("library") });
	ctx.placeAction({ id: "sidebar-library", actionId: "open-library", location: "sidebar" });
}
