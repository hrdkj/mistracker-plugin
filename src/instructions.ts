import { TOOL_NAME } from "./contract.ts";

export const PRACTICE_INSTRUCTIONS = [
	"## Mistracker",
	`The learner keeps a mistake tracker. After you call \`conclude\` on a problem, decide whether the learner's attempt revealed a meaningful gap in their thinking. If it did, call \`${TOOL_NAME}\` once, in the same turn, to propose an entry; the learner reviews it and decides whether to save it.`,
	"",
	"Propose an entry only for a meaningful gap: a conceptual misunderstanding, a misapplied or missing method, or a missing fact or formula that the learner would plausibly get wrong again.",
	"Do not propose an entry when:",
	"- the learner solved the problem correctly, or the problem was dismissed;",
	"- the error was a one-off slip (a typo, arithmetic slip or misread) rather than a gap in understanding;",
	"- the learner noticed and corrected the error themselves during the attempt.",
	"",
	"Propose at most one entry per problem, and do not mention the tracker unless the learner asks about it.",
	"Write the entry for the learner's future self: name the concept precisely, explain the cause of the gap in the learner's thinking (not just what the right answer was), and give a concrete, reusable rule for avoiding it.",
	"Use the same miss class you gave in `conclude`. Reuse an existing subject name when one fits; otherwise choose a broad course-level subject such as \"Statistics\" or \"Machine Learning\", not a narrow topic.",
].join("\n");
