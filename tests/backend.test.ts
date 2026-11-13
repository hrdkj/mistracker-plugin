import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { activate } from "../src/backend.ts";
import { STORE_FILE } from "../src/store.ts";
import { latestProblemStatement } from "../src/session.ts";

const fields = {
	subject: "Statistics",
	concept: "Conditional probability direction",
	mistakeType: "Conceptual",
	missClass: "discrimination",
	whyHappened: "Treated P(A|B) as P(B|A).",
	howToAvoid: "Write the conditioning event explicitly before computing.",
};

const practiceSession = {
	id: "chat1",
	title: "Bayes practice",
	kind: "practice",
	messages: [
		{ role: "assistant", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { statement: "Old problem", mode: "recall", modelSolution: "x" } }] },
		{ role: "toolResult", toolCallId: "p1", toolName: "problem", isError: false, content: [] },
		{ role: "assistant", content: [{ type: "toolCall", id: "p2", name: "problem", arguments: { statement: "Compute P(disease | positive).", mode: "composition", modelSolution: "y" } }] },
		{ role: "toolResult", toolCallId: "p2", toolName: "problem", isError: false, content: [] },
		{ role: "assistant", content: [{ type: "toolCall", id: "p3", name: "problem", arguments: { statement: "Errored pose" } }] },
		{ role: "toolResult", toolCallId: "p3", toolName: "problem", isError: true, content: [] },
	],
};

function setup() {
	const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-test-"));
	const handlers = new Map<string, (input: unknown) => unknown>();
	const emitted: string[] = [];
	const registrations: { instructions: unknown[]; tools: { agents: string[]; create: (c: unknown) => any[] }[] } = { instructions: [], tools: [] };
	const controller = new AbortController();
	const ctx = {
		dataDirectory,
		signal: controller.signal,
		learning: { getSession: (id: string) => (id === "chat1" ? practiceSession : null) },
		registerInstructions: (c: unknown) => { registrations.instructions.push(c); return () => {}; },
		registerTools: (c: any) => { registrations.tools.push(c); return () => {}; },
		handle: (name: string, fn: (input: unknown) => unknown) => { handlers.set(name, fn); return () => {}; },
		events: { on: () => () => {}, emit: (topic: string) => { emitted.push(topic); } },
	} as unknown as PluginBackendContext;
	activate(ctx);
	const call = async (name: string, input: unknown = {}) => handlers.get(name)!(input) as any;
	const tool = (chatId = "chat1") => registrations.tools[0]!.create({ chatId, agent: "practice" })[0];
	return { dataDirectory, call, tool, emitted, registrations };
}

test("registers practice-only instructions and tool", () => {
	const { registrations, tool } = setup();
	assert.deepEqual((registrations.instructions[0] as { agents: string[] }).agents, ["practice"]);
	assert.deepEqual(registrations.tools[0]!.agents, ["practice"]);
	assert.equal(tool().name, "propose_mistake");
});

test("proposal is pending, captures the latest clean problem, and saves with edits", async () => {
	const { call, tool, emitted, dataDirectory } = setup();
	const result = await tool().execute("call-1", fields);
	const id = result.details.proposalId;
	const { entry } = await call("get-proposal", { id });
	assert.equal(entry.status, "pending");
	assert.equal(entry.problemStatement, "Compute P(disease | positive).");
	assert.equal(entry.sessionTitle, "Bayes practice");
	assert.equal(entry.toolCallId, "call-1");
	assert.equal((await call("list-entries")).entries.length, 0, "pending entries are not in the library");

	const saved = await call("save-proposal", { id, edits: { subject: "Probability" } });
	assert.equal(saved.entry.status, "saved");
	assert.equal(saved.entry.subject, "Probability");
	const list = await call("list-entries");
	assert.equal(list.entries.length, 1);
	assert.deepEqual(list.subjects, ["Probability"]);
	await assert.rejects(async () => call("save-proposal", { id }), /already saved/);
	assert.ok(emitted.length >= 2);
	assert.ok(fs.existsSync(path.join(dataDirectory, STORE_FILE)));
});

test("existing subjects are offered in the tool description", async () => {
	const { call, tool } = setup();
	const { details } = await tool().execute("c", fields);
	await call("save-proposal", { id: details.proposalId });
	assert.match(tool().description, /"Statistics"/);
});

test("dismiss, update and delete", async () => {
	const { call, tool } = setup();
	const a = (await tool().execute("a", fields)).details.proposalId;
	const b = (await tool().execute("b", fields)).details.proposalId;
	assert.equal((await call("dismiss-proposal", { id: a })).entry.status, "dismissed");
	await call("save-proposal", { id: b });
	const updated = await call("update-entry", { id: b, edits: { howToAvoid: "New rule." } });
	assert.equal(updated.entry.howToAvoid, "New rule.");
	await assert.rejects(async () => call("update-entry", { id: a, edits: {} }), /already dismissed/);
	await call("delete-entry", { id: b });
	assert.equal((await call("get-proposal", { id: b })).entry, null);
	assert.equal((await call("list-entries")).entries.length, 0);
});

test("rejects invalid fields", async () => {
	const { call, tool } = setup();
	await assert.rejects(tool().execute("x", { ...fields, mistakeType: "Silly/Careless" }), /mistakeType/);
	await assert.rejects(tool().execute("x", { ...fields, missClass: "nope" }), /missClass/);
	await assert.rejects(tool().execute("x", { ...fields, concept: "  " }), /concept/);
	const id = (await tool().execute("y", fields)).details.proposalId;
	await assert.rejects(async () => call("save-proposal", { id, edits: { bogus: 1 } }), /Unknown field/);
	await assert.rejects(async () => call("save-proposal", { id, edits: { subject: "x".repeat(81) } }), /subject/);
});

test("unknown session still records the proposal", async () => {
	const { call, tool } = setup();
	const id = (await tool("missing").execute("z", fields)).details.proposalId;
	const { entry } = await call("get-proposal", { id });
	assert.equal(entry.problemStatement, "");
	assert.equal(entry.chatId, "missing");
});

test("store refuses unsupported data without changing it", () => {
	const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-test-"));
	const file = path.join(dataDirectory, STORE_FILE);
	fs.writeFileSync(file, JSON.stringify({ version: 2, revision: 0, entries: {} }));
	const ctx = { dataDirectory, signal: new AbortController().signal } as unknown as PluginBackendContext;
	assert.throws(() => activate(ctx), /Unsupported or invalid/);
	assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
});

test("plugin problem poses are recognized through their snapshot", () => {
	const statement = latestProblemStatement([
		{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "coding_problem", arguments: {} }] },
		{ role: "toolResult", toolCallId: "c1", toolName: "coding_problem", isError: false, details: { pluginProblem: { input: { statement: "Reverse a list." } } } },
	]);
	assert.equal(statement, "Reverse a list.");
	assert.equal(latestProblemStatement([]), undefined);
});
