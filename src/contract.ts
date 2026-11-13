/** Shared, browser-safe entry shapes and validation for Mistracker. */

export const TOOL_NAME = "propose_mistake";
export const CHANGED_TOPIC = "changed";

export const MISTAKE_TYPES = ["Conceptual", "New info/detail", "Calculation", "Memory/Formula"] as const;
/** Mirrors the practice agent's own `conclude` miss classes. */
export const MISS_CLASSES = ["cue", "discrimination", "execution", "careless", "structural"] as const;

export type MistakeType = (typeof MISTAKE_TYPES)[number];
export type MissClass = (typeof MISS_CLASSES)[number];
export type EntryStatus = "pending" | "saved" | "dismissed";

/** Fields the agent drafts and the learner may edit. */
export interface EntryFields {
	subject: string;
	concept: string;
	mistakeType: MistakeType;
	missClass: MissClass;
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

export const FIELD_LIMITS: Record<Exclude<keyof EntryFields, "mistakeType" | "missClass">, number> = {
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
	if (!MISTAKE_TYPES.includes(input.mistakeType as MistakeType)) throw new Error(`mistakeType must be one of: ${MISTAKE_TYPES.join(", ")}.`);
	if (!MISS_CLASSES.includes(input.missClass as MissClass)) throw new Error(`missClass must be one of: ${MISS_CLASSES.join(", ")}.`);
	out.mistakeType = input.mistakeType as MistakeType;
	out.missClass = input.missClass as MissClass;
	return out as EntryFields;
}

/** Validate a partial edit merged onto existing fields. */
export function mergeFields(current: EntryFields, edits: unknown): EntryFields {
	if (edits === undefined) return validateFields(current);
	if (!edits || typeof edits !== "object" || Array.isArray(edits)) throw new Error("Edits must be an object.");
	const allowed = new Set<string>([...TEXT_FIELDS, "mistakeType", "missClass"]);
	for (const key of Object.keys(edits)) if (!allowed.has(key)) throw new Error(`Unknown field: ${key}.`);
	return validateFields({ ...current, ...(edits as object) });
}

export function pickFields(entry: EntryFields): EntryFields {
	const { subject, concept, mistakeType, missClass, whyHappened, howToAvoid } = entry;
	return { subject, concept, mistakeType, missClass, whyHappened, howToAvoid };
}
