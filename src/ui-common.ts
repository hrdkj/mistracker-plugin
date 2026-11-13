import type { PluginButtonProps, PluginFrontendContext } from "learnharness-plugin-api";
import { el } from "./form.ts";

/** Live refresh hooks for mounted cards and views; fed by onNotification/onResync. */
export const refreshers = new Set<() => void>();

export function subscribeRefresh(signal: AbortSignal, refresh: () => void): void {
	refreshers.add(refresh);
	signal.addEventListener("abort", () => refreshers.delete(refresh), { once: true });
}

/** A child scope that is replaced on each re-render and dies with its parent. */
export function childScope(parent: AbortSignal): AbortController {
	const controller = new AbortController();
	if (parent.aborted) controller.abort();
	else parent.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

export function button(ctx: PluginFrontendContext, container: HTMLElement, signal: AbortSignal, props: PluginButtonProps): void {
	const slot = el(container.ownerDocument, "span", "mt-button-slot");
	container.append(slot);
	ctx.ui.mountButton(slot, { size: "sm", ...props }, { signal });
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
