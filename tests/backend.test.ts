import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { activate } from "../src/backend.ts";
import { STORE_FILE, V1_BACKUP_FILE } from "../src/store.ts";
import { latestProblemStatement } from "../src/session.ts";

const fields = {
	subject: "Statistics",
	concept: "Conditional probability direction",
	cause: "Mix-up",
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

function setup(dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-test-"))) {
	const handlers = new Map<string, (input: unknown) => unknown>();
	const emitted: string[] = [];
	const registrations: { instructions: unknown[]; tools: { agents: string[]; create: (c: unknown) => any[] }[] } = { instructions: [], tools: [] };
	const controller = new AbortController();
	const ctx = {
		manifest: { id: "mistracker", version: "0.3.0" },
		directory: path.join(dataDirectory, "..", "dist"),
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
	assert.equal((await call("get-proposal", { id: b })).entry.status, "deleted", "delete is a soft delete");
	assert.equal((await call("list-entries")).entries.length, 0);
	assert.deepEqual((await call("list-entries")).subjects, [], "deleted entries do not count as subjects");
});

test("undo restores dismissed proposals to pending and deleted entries to saved", async () => {
	const { call, tool } = setup();
	const a = (await tool().execute("a", fields)).details.proposalId;
	const b = (await tool().execute("b", fields)).details.proposalId;
	await call("dismiss-proposal", { id: a });
	assert.equal((await call("restore-entry", { id: a })).entry.status, "pending");
	await call("save-proposal", { id: b });
	await call("delete-entry", { id: b });
	assert.equal((await call("restore-entry", { id: b })).entry.status, "saved");
	assert.equal((await call("list-entries")).entries.length, 1);
	await assert.rejects(async () => call("restore-entry", { id: a }), /pending and cannot be restored/);
	await assert.rejects(async () => call("restore-entry", { id: b }), /saved and cannot be restored/);
	await assert.rejects(async () => call("restore-entry", { id: "nope" }), /no longer exists/);
});

test("startup prunes pending, dismissed and deleted entries older than 7 days", () => {
	const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-test-"));
	const file = path.join(dataDirectory, STORE_FILE);
	const day = 24 * 60 * 60 * 1000;
	const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
	const entry = (id: string, status: string, updatedAt: string) => ({ ...fields, id, status, chatId: "chat1", sessionTitle: "", problemStatement: "", toolCallId: id, createdAt: ago(30), updatedAt });
	const entries = {
		oldDismissed: entry("oldDismissed", "dismissed", ago(8)),
		oldDeleted: entry("oldDeleted", "deleted", ago(8)),
		freshDismissed: entry("freshDismissed", "dismissed", ago(6)),
		freshDeleted: entry("freshDeleted", "deleted", ago(6)),
		oldSaved: entry("oldSaved", "saved", ago(60)),
		oldPending: entry("oldPending", "pending", ago(8)),
		freshPending: entry("freshPending", "pending", ago(6)),
	};
	fs.writeFileSync(file, JSON.stringify({ version: 2, revision: 5, entries }));
	const ctx = { dataDirectory, signal: new AbortController().signal, registerInstructions: () => {}, registerTools: () => {}, handle: () => {}, events: { emit: () => {} } } as unknown as PluginBackendContext;
	activate(ctx);
	const stored = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.deepEqual(Object.keys(stored.entries).sort(), ["freshDeleted", "freshDismissed", "freshPending", "oldSaved"]);
	assert.equal(stored.revision, 6);

	activate(ctx);
	assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).revision, 6, "nothing expired, so nothing is written");
});

test("rejects invalid fields", async () => {
	const { call, tool } = setup();
	await assert.rejects(tool().execute("x", { ...fields, cause: "careless" }), /cause must be one of/);
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
	fs.writeFileSync(file, JSON.stringify({ version: 3, revision: 0, entries: {} }));
	const ctx = { dataDirectory, signal: new AbortController().signal } as unknown as PluginBackendContext;
	assert.throws(() => activate(ctx), /Unsupported or invalid/);
	assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 3);
});

function v1Directory(pairs: Record<string, [string, string]>) {
	const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mistracker-test-"));
	const now = new Date().toISOString();
	const entries = Object.fromEntries(Object.entries(pairs).map(([id, [missClass, mistakeType]]) => {
		const { cause: _, ...rest } = fields;
		return [id, { ...rest, missClass, mistakeType, id, status: "saved", chatId: "chat1", sessionTitle: "", problemStatement: "", toolCallId: id, createdAt: now, updatedAt: now }];
	}));
	const original = JSON.stringify({ version: 1, revision: 4, entries });
	fs.writeFileSync(path.join(dataDirectory, STORE_FILE), original);
	return { dataDirectory, original };
}

test("version 1 data migrates to one cause per entry and keeps a backup", async () => {
	const { dataDirectory, original } = v1Directory({
		a: ["structural", "Conceptual"],
		b: ["discrimination", "Conceptual"],
		c: ["cue", "New info/detail"],
		d: ["cue", "Memory/Formula"],
		e: ["cue", "Conceptual"],
		f: ["cue", "Calculation"],
		g: ["execution", "Calculation"],
		h: ["execution", "Conceptual"],
		i: ["careless", "Calculation"],
	});
	const { call } = setup(dataDirectory);
	const { entries } = await call("list-entries");
	const causes = Object.fromEntries(entries.map((entry: { id: string; cause: string }) => [entry.id, entry.cause]));
	assert.deepEqual(causes, { a: "Misconception", b: "Mix-up", c: "Never learned", d: "Forgot", e: "Didn't apply", f: "Didn't apply", g: "Wrong steps", h: "Wrong steps", i: "Wrong steps" });
	const stored = JSON.parse(fs.readFileSync(path.join(dataDirectory, STORE_FILE), "utf8"));
	assert.equal(stored.version, 2);
	assert.equal(stored.revision, 5);
	assert.ok(!("missClass" in stored.entries.a) && !("mistakeType" in stored.entries.a), "old fields are dropped");
	assert.equal(fs.readFileSync(path.join(dataDirectory, V1_BACKUP_FILE), "utf8"), original, "backup is the untouched version 1 file");
});

test("version 1 data with an unknown miss class is refused without changes", () => {
	const { dataDirectory, original } = v1Directory({ a: ["structural", "Conceptual"], b: ["nope", "Conceptual"] });
	const ctx = { dataDirectory, signal: new AbortController().signal } as unknown as PluginBackendContext;
	assert.throws(() => activate(ctx), /Unsupported or invalid/);
	assert.equal(fs.readFileSync(path.join(dataDirectory, STORE_FILE), "utf8"), original);
	assert.ok(!fs.existsSync(path.join(dataDirectory, V1_BACKUP_FILE)));
});

test("edit form switches the stored cause", async () => {
	const { call, tool } = setup();
	const id = (await tool().execute("c", fields)).details.proposalId;
	const saved = await call("save-proposal", { id, edits: { cause: "Forgot" } });
	assert.equal(saved.entry.cause, "Forgot");
});

test("plugin problem poses are recognized through their snapshot", () => {
	const statement = latestProblemStatement([
		{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "coding_problem", arguments: {} }] },
		{ role: "toolResult", toolCallId: "c1", toolName: "coding_problem", isError: false, details: { pluginProblem: { input: { statement: "Reverse a list." } } } },
	]);
	assert.equal(statement, "Reverse a list.");
	assert.equal(latestProblemStatement([]), undefined);
});

test("instructions ask for short human notes with LaTeX and code formatting", () => {
	const { registrations } = setup();
	const text = (registrations.instructions[0] as { text: string }).text;
	assert.match(text, /first person/);
	assert.match(text, /Do not write "the learner"/);
	assert.match(text, /LaTeX: `\$\.\.\.\$` inline/);
	assert.match(text, /fenced code blocks with a language tag/);
	assert.match(text, /`careless`, do not propose/);
	assert.match(text, /exact step I took and the wrong assumption/);
	assert.match(text, /no bullets/);
	assert.match(text, /cause Better method/);
	assert.doesNotMatch(text, /encode line breaks/, "escaped line breaks made the agent write a literal \\n");
});

test("the agent can propose a Better method entry", async () => {
	const { call, tool } = setup();
	const id = (await tool().execute("b", { ...fields, cause: "Better method" })).details.proposalId;
	assert.equal((await call("get-proposal", { id })).entry.cause, "Better method");
	assert.match(JSON.stringify(tool().parameters), /Better method/);
});

test("exports saved entries and imports a JSON export, skipping entries already present", async () => {
	const source = setup();
	const a = (await source.tool().execute("a", fields)).details.proposalId;
	const b = (await source.tool().execute("b", { ...fields, subject: "Machine Learning", concept: "Bias term" })).details.proposalId;
	await source.tool().execute("c", fields);
	await source.call("save-proposal", { id: a });
	await source.call("save-proposal", { id: b });

	const markdown = await source.call("export-markdown");
	assert.match(markdown.filename, /^mistracker-\d{4}-\d{2}-\d{2}\.md$/);
	assert.match(markdown.content, /## Statistics[\s\S]*### Conditional probability direction/);
	assert.match(markdown.content, /## Machine Learning[\s\S]*### Bias term/);
	assert.match(markdown.content, /\*\*Problem:\*\*\n\nCompute P\(disease \| positive\)\./);
	assert.equal(markdown.content.match(/^### /gm)?.length, 2, "pending entries are not exported");

	const json = await source.call("export-json");
	const target = setup();
	const first = await target.call("import-json", { text: json.content });
	assert.deepEqual(first, { added: 2, skipped: 0 });
	assert.deepEqual((await target.call("list-entries")).entries.map((e: { id: string }) => e.id).sort(), [a, b].sort());
	assert.ok(target.emitted.length > 0);
	assert.deepEqual(await target.call("import-json", { text: json.content }), { added: 0, skipped: 2 });

	await target.call("delete-entry", { id: a });
	assert.deepEqual(await target.call("import-json", { text: json.content }), { added: 1, skipped: 1 }, "a deleted entry comes back from the backup");
	assert.equal((await target.call("list-entries")).entries.length, 2);
});

test("import refuses invalid files without changing anything", async () => {
	const { call } = setup();
	await assert.rejects(async () => call("import-json", { text: "not json" }), /not a Mistracker JSON export/);
	await assert.rejects(async () => call("import-json", { text: JSON.stringify({ format: "mistracker-export", version: 9, entries: [] }) }), /newer Mistracker/);
	const good = { ...fields, id: "x", createdAt: new Date().toISOString() };
	const bad = { ...fields, id: "y", cause: "careless" };
	await assert.rejects(async () => call("import-json", { text: JSON.stringify({ format: "mistracker-export", version: 1, entries: [good, bad] }) }), /Entry 2: cause/);
	assert.equal((await call("list-entries")).entries.length, 0);
});
