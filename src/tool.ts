import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import { FIELD_LIMITS, MISS_CLASSES, MISTAKE_TYPES, TOOL_NAME, validateFields, type Entry } from "./contract.ts";
import { latestProblemStatement } from "./session.ts";
import { savedSubjects, type Store } from "./store.ts";

export interface ProposalDetails { proposalId: string }

const parameters = {
	type: "object",
	properties: {
		subject: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.subject, description: "Broad course-level subject, e.g. Statistics, Biology, Machine Learning." },
		concept: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.concept, description: "Short name for the idea the learner got wrong, a few words. Markdown; math in LaTeX." },
		mistakeType: { type: "string", enum: [...MISTAKE_TYPES] },
		missClass: { type: "string", enum: [...MISS_CLASSES], description: "The same miss class you gave in conclude." },
		whyHappened: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.whyHappened, description: "One or two first-person sentences (\"I…\") naming the wrong assumption. Markdown; math in LaTeX." },
		howToAvoid: { type: "string", minLength: 1, maxLength: FIELD_LIMITS.howToAvoid, description: "One quick rule or check for next time, starting with the action: one or two sentences or at most 3 short bullets. Markdown; math in LaTeX." },
	},
	required: ["subject", "concept", "mistakeType", "missClass", "whyHappened", "howToAvoid"],
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
		description: "Propose one mistake-tracker entry for a meaningful thinking gap, right after concluding a problem. The learner confirms or dismisses it; nothing is saved without them." + subjectHint,
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
