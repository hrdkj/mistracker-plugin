import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { CAUSES, CAUSE_MEANINGS, FIELD_LIMITS, TOOL_NAME, validateFields, type Entry } from "./contract.ts";
import { latestProblemStatement } from "./session.ts";
import { savedSubjects, type Store } from "./store.ts";

export interface ProposalDetails { proposalId: string }

const parameters = {
	type: "object",
	properties: {
		subject: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.subject, description: "Broad course-level subject, e.g. Statistics, Biology, Machine Learning." },
		concept: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.concept, description: "Short name for the idea the learner got wrong, or for the better method, a few words. Markdown; math in LaTeX." },
		cause: { type: "string", enum: [...CAUSES], description: `What went wrong: ${CAUSES.map(cause => `"${cause}": ${CAUSE_MEANINGS[cause]}`).join("; ")}.` },
		whyHappened: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.whyHappened, description: "One or two first-person sentences (\"I…\") stating the exact step I took and the wrong assumption behind it. Markdown; math in LaTeX." },
		howToAvoid: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.howToAvoid, description: "One or two plain sentences, no bullets: the cue in a problem that should trigger the fix, and the concrete action to take. Specific to this trap; do not repeat the concept's formula. Markdown; math in LaTeX." },
	},
	required: ["subject", "concept", "cause", "whyHappened", "howToAvoid"],
	additionalProperties: false,
};

export function createProposeTool(ctx: PluginBackendContext, store: Store, context: PluginToolContext, notify: () => void): AgentTool<any> {
	const subjects = savedSubjects(store.get());
	const subjectHint = subjects.length
		? ` Existing subjects (reuse one when it fits): ${subjects.slice(0, 40).map(s => JSON.stringify(s)).join(", ")}.`
		: "";
	return {
		name: TOOL_NAME,
		label: "Propose mistake entry",
		description: "Propose one mistake-tracker entry for a meaningful thinking gap or a clearly worse method, right after concluding a problem. The learner confirms or dismisses it; nothing is saved without them." + subjectHint,
		parameters: parameters as never,
		execute: async (toolCallId, params, signal) => {
			if (signal?.aborted || ctx.signal.aborted) throw new Error("Mistracker tool cancelled");
			const fields = validateFields(params);
			const session = ctx.learning.getSession(context.chatId);
			const now = new Date().toISOString();
			const entry: Entry = {
				...fields,
				id: randomUUID(),
				status: "pending",
				chatId: context.chatId,
				sessionTitle: session?.title ?? "",
				problemStatement: session ? latestProblemStatement(session.messages) ?? "" : "",
				toolCallId,
				createdAt: now,
				updatedAt: now,
			};
			store.change(state => { state.entries[entry.id] = entry; });
			notify();
			const details: ProposalDetails = { proposalId: entry.id };
			return {
				content: [{ type: "text", text: "Proposed to the learner for confirmation. Do not mention it unless they ask." }],
				details,
			};
		},
	};
}
