/** Plain-DOM entry form shared by the session card and the library edit dialog. */
import { FIELD_LIMITS, MISS_CLASSES, MISTAKE_TYPES, type EntryFields } from "./contract.ts";

let listCounter = 0;

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export interface EntryForm {
	element: HTMLElement;
	read(): EntryFields;
	focus(): void;
}

export function createEntryForm(doc: Document, fields: EntryFields, subjects: readonly string[]): EntryForm {
	const form = el(doc, "div", "mt-form");
	const listId = `mt-subjects-${++listCounter}`;
	const datalist = el(doc, "datalist");
	datalist.id = listId;
	for (const subject of subjects) {
		const option = el(doc, "option");
		option.value = subject;
		datalist.append(option);
	}

	const row = (label: string, control: HTMLElement) => {
		const wrapper = el(doc, "label", "mt-field");
		wrapper.append(el(doc, "span", "mt-field-label", label), control);
		form.append(wrapper);
	};
	const input = (value: string, max: number) => {
		const node = el(doc, "input", "mt-input");
		node.value = value;
		node.maxLength = max;
		return node;
	};
	const area = (value: string, max: number) => {
		const node = el(doc, "textarea", "mt-input mt-textarea");
		node.value = value;
		node.maxLength = max;
		node.rows = 3;
		return node;
	};
	const select = (value: string, options: readonly string[]) => {
		const node = el(doc, "select", "mt-input");
		for (const option of options) {
			const item = el(doc, "option", undefined, option);
			item.value = option;
			node.append(item);
		}
		node.value = value;
		return node;
	};

	const subject = input(fields.subject, FIELD_LIMITS.subject);
	subject.setAttribute("list", listId);
	const concept = input(fields.concept, FIELD_LIMITS.concept);
	const mistakeType = select(fields.mistakeType, MISTAKE_TYPES);
	const missClass = select(fields.missClass, MISS_CLASSES);
	const whyHappened = area(fields.whyHappened, FIELD_LIMITS.whyHappened);
	const howToAvoid = area(fields.howToAvoid, FIELD_LIMITS.howToAvoid);

	row("Subject", subject);
	row("Concept", concept);
	const pair = el(doc, "div", "mt-field-pair");
	form.append(pair);
	const pairRow = (label: string, control: HTMLElement) => {
		const wrapper = el(doc, "label", "mt-field");
		wrapper.append(el(doc, "span", "mt-field-label", label), control);
		pair.append(wrapper);
	};
	pairRow("Mistake type", mistakeType);
	pairRow("Miss class", missClass);
	row("Why it happened", whyHappened);
	row("How to avoid", howToAvoid);
	form.append(datalist);

	return {
		element: form,
		read: () => ({
			subject: subject.value,
			concept: concept.value,
			mistakeType: mistakeType.value as EntryFields["mistakeType"],
			missClass: missClass.value as EntryFields["missClass"],
			whyHappened: whyHappened.value,
			howToAvoid: howToAvoid.value,
		}),
		focus: () => subject.focus(),
	};
}

/** Mounts Markdown text into a container (host renderer); falls back to plain text. */
export type TextMount = (container: HTMLElement, text: string) => void;

/** Read-only presentation of entry fields. */
export function renderFields(doc: Document, fields: EntryFields, mountText?: TextMount): HTMLElement {
	const box = el(doc, "div", "mt-fields");
	const meta = el(doc, "div", "mt-meta");
	meta.append(el(doc, "span", "mt-chip", fields.subject), el(doc, "span", "mt-chip", fields.mistakeType), el(doc, "span", "mt-chip mt-chip-muted", fields.missClass));
	const concept = el(doc, "div", "mt-concept mt-text");
	if (mountText) mountText(concept, fields.concept); else concept.textContent = fields.concept;
	box.append(concept, meta);
	for (const [label, text] of [["Why it happened", fields.whyHappened], ["How to avoid", fields.howToAvoid]] as const) {
		const section = el(doc, "div", "mt-section");
		const body = el(doc, "div", "mt-text");
		if (mountText) mountText(body, text); else body.textContent = text;
		section.append(el(doc, "div", "mt-field-label", label), body);
		box.append(section);
	}
	return box;
}
