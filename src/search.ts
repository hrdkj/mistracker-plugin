/** Library search: every query word must appear somewhere in the entry's text. */
import type { Entry } from "./contract.ts";

const SEARCHED_FIELDS = ["subject", "concept", "whyHappened", "howToAvoid", "problemStatement", "sessionTitle"] as const;

type SearchableEntry = Pick<Entry, (typeof SEARCHED_FIELDS)[number]>;

export function searchTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function entryMatches(entry: SearchableEntry, terms: readonly string[]): boolean {
	if (!terms.length) return true;
	const text = SEARCHED_FIELDS.map(field => entry[field].toLowerCase());
	return terms.every(term => text.some(field => field.includes(term)));
}
