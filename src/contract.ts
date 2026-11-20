/** Shared, browser-safe entry shapes and validation for Mistracker. */

export const TOOL_NAME = "propose_mistake";
export const CHANGED_TOPIC = "changed";

/** What went wrong, as the learner reads it. The agent picks one; it is the only classification stored. */
export const CAUSES = ["Misconception", "Mix-up", "Never learned", "Forgot", "Didn't apply", "Wrong steps", "Better method"] as const;

export type Cause = (typeof CAUSES)[number];

/** Meaning of each cause, shown to the agent with the conclude miss class it follows from. */
export const CAUSE_MEANINGS: Record<Cause, string> = {
	"Misconception": "the idea itself was wrong in their head (conclude: structural)",
	"Mix-up": "a similar but wrong idea won over the right one (conclude: discrimination)",
	"Never learned": "they never learned the fact, formula or method (conclude: cue)",
	"Forgot": "they learned it but could not recall it (conclude: cue)",
	"Didn't apply": "they knew it but did not see that this problem needed it (conclude: cue)",
	"Wrong steps": "right idea, carried out wrongly (conclude: execution)",
	"Better method": "they solved it correctly, but with a clearly worse method than the standard one the problem was built around (no miss)",
};

export type EntryStatus = "pending" | "saved" | "dismissed" | "deleted";

/** Unsaved entries (pending, dismissed, deleted) are kept this long after their last change, then pruned at startup. */
export const UNDO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Fields the agent drafts and the learner may edit. */
export interface EntryFields {
	subject: string;
	concept: string;
	cause: Cause;
	whyHappened: string;
	howToAvoid: string;
}

export interface Entry extends EntryFields {
	id: string;
	status: EntryStatus;
	chatId: string;
	sessionTitle: string;
	problemStatement: string;
	toolCallId: string;
	createdAt: string;
	updatedAt: string;
}

export const FIELD_LIMITS: Record<Exclude<keyof EntryFields, "cause">, number> = {
	subject: 80,
	concept: 200,
	whyHappened: 2000,
	howToAvoid: 2000,
};

const TEXT_FIELDS = Object.keys(FIELD_LIMITS) as (keyof typeof FIELD_LIMITS)[];

/** Validate a complete set of fields; returns trimmed values or throws a readable error. */
export function validateFields(value: unknown): EntryFields {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Entry fields must be an object.");
	const input = value as Record<string, unknown>;
	const out: Partial<EntryFields> = {};
	for (const key of TEXT_FIELDS) {
		const raw = input[key];
		if (typeof raw !== "string" || !raw.trim()) throw new Error(`${key} is required.`);
		const text = raw.trim();
		if (text.length > FIELD_LIMITS[key]) throw new Error(`${key} must be at most ${FIELD_LIMITS[key]} characters.`);
		out[key] = text;
	}
	if (!CAUSES.includes(input.cause as Cause)) throw new Error(`cause must be one of: ${CAUSES.join(", ")}.`);
	out.cause = input.cause as Cause;
	return out as EntryFields;
}

/** Validate a partial edit merged onto existing fields. */
export function mergeFields(current: EntryFields, edits: unknown): EntryFields {
	if (edits === undefined) return validateFields(current);
	if (!edits || typeof edits !== "object" || Array.isArray(edits)) throw new Error("Edits must be an object.");
	const allowed = new Set<string>([...TEXT_FIELDS, "cause"]);
	for (const key of Object.keys(edits)) if (!allowed.has(key)) throw new Error(`Unknown field: ${key}.`);
	return validateFields({ ...current, ...(edits as object) });
}

export function pickFields(entry: EntryFields): EntryFields {
	const { subject, concept, cause, whyHappened, howToAvoid } = entry;
	return { subject, concept, cause, whyHappened, howToAvoid };
}
