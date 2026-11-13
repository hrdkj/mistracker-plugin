/** Read the most recent practice problem statement from a saved session record.
 * Re-implements the host's pose scan (native `problem` calls and plugin problem
 * poses, counted only through clean results) using public record shapes. */

interface Block { type?: string; id?: string; name?: string; arguments?: unknown }
interface Message {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	details?: unknown;
}

const NATIVE_PROBLEM_TOOL = "problem";

function statementOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const statement = (value as { statement?: unknown }).statement;
	return typeof statement === "string" && statement.trim() ? statement : undefined;
}

export function latestProblemStatement(messages: readonly unknown[]): string | undefined {
	const list = messages as readonly Message[];
	const results = new Map<string, Message>();
	for (const message of list) {
		if (message?.role === "toolResult" && typeof message.toolCallId === "string") results.set(message.toolCallId, message);
	}
	for (let mi = list.length - 1; mi >= 0; mi--) {
		const message = list[mi];
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		const blocks = message.content as Block[];
		for (let bi = blocks.length - 1; bi >= 0; bi--) {
			const block = blocks[bi];
			if (block?.type !== "toolCall" || typeof block.id !== "string") continue;
			const result = results.get(block.id);
			if (!result || result.isError || result.toolName !== block.name) continue;
			if (block.name === NATIVE_PROBLEM_TOOL) {
				const statement = statementOf(block.arguments);
				if (statement) return statement;
				continue;
			}
			const snapshot = (result.details as { pluginProblem?: { input?: unknown } } | undefined)?.pluginProblem;
			const statement = statementOf(snapshot?.input);
			if (statement) return statement;
		}
	}
	return undefined;
}
