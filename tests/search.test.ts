import { test } from "node:test";
import assert from "node:assert/strict";
import { entryMatches, searchTerms } from "../src/search.ts";

const entry = {
	subject: "Statistics",
	concept: "Conditional probability direction",
	mistakeType: "Conceptual",
	whyHappened: "Treated $P(A \\mid B)$ as P(B|A).",
	howToAvoid: "Write the conditioning event explicitly before computing.",
	problemStatement: "Compute P(disease | positive) for a rare illness.",
	sessionTitle: "Bayes practice",
};

const matches = (query: string) => entryMatches(entry, searchTerms(query));

test("every word must match, in any order and any case", () => {
	assert.equal(matches("probability conditional"), true);
	assert.equal(matches("DIRECTION statistics"), true);
	assert.equal(matches("conditional geometry"), false);
});

test("words match as substrings across different fields", () => {
	assert.equal(matches("stat bayes explicit"), true);
});

test("each searched field is searched", () => {
	assert.equal(matches("statistics"), true, "subject");
	assert.equal(matches("direction"), true, "concept");
	assert.equal(matches("treated"), true, "whyHappened");
	assert.equal(matches("conditioning"), true, "howToAvoid");
	assert.equal(matches("illness"), true, "problemStatement");
	assert.equal(matches("bayes"), true, "sessionTitle");
});

test("LaTeX source is searchable as typed", () => {
	assert.equal(matches("\\mid"), true);
});

test("fields outside the searched text do not match", () => {
	assert.equal(matches("conceptual"), false);
});

test("an empty or whitespace-only query matches everything", () => {
	assert.equal(matches(""), true);
	assert.equal(matches("  \t\n "), true);
});

test("a word found in no field fails the match", () => {
	assert.equal(matches("eigenvalue"), false);
});
