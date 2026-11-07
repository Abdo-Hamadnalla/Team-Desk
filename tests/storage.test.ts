import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GET, POST } from "../src/app/api/workspace/route";
import { commitOperation, type WorkspaceStore } from "../src/lib/storage";
import { applyOperation, emptyWorkspace, WorkspaceError } from "../src/lib/workspace";
import type { Operation, Workspace } from "../src/lib/types";

function create(title: string): Operation { return { operationId: randomUUID(), type: "task.create", payload: { title }, actor: "Test" }; }

function memoryStore(initial = emptyWorkspace()) {
  let state = initial;
  let version: string | null = initial.revision ? String(initial.revision) : null;
  let writes = 0;
  const store: WorkspaceStore = {
    async read() { return { state: structuredClone(state), version }; },
    async write(next, expected) {
      if (version !== expected) return false;
      state = structuredClone(next);
      version = String(next.revision);
      writes++;
      return true;
    },
  };
  return { store, state: () => state, writes: () => writes };
}

test("simultaneous first writes both survive conditional-create conflict", async () => {
  const memory = memoryStore();
  await Promise.all([commitOperation(create("A"), memory.store), commitOperation(create("B"), memory.store)]);
  assert.deepEqual(memory.state().tasks.map(task => task.title).sort(), ["A", "B"]);
  assert.equal(memory.state().activity.length, 2);
  assert.equal(memory.writes(), 2);
});

test("retry after successful write with lost response does not duplicate data", async () => {
  const memory = memoryStore();
  const op = create("One task");
  await commitOperation(op, memory.store);
  await commitOperation(op, memory.store);
  assert.equal(memory.state().tasks.length, 1);
  assert.equal(memory.writes(), 1);
});

test("concurrent updates of different tasks merge without dropping either", async () => {
  let state = applyOperation(emptyWorkspace(), create("A"));
  state = applyOperation(state, create("B"));
  const memory = memoryStore(state);
  const updates: Operation[] = state.tasks.map(task => ({ operationId: randomUUID(), type: "task.update", actor: "Test", payload: { id: task.id, status: "done" }, expectedUpdatedAt: task.updatedAt }));
  await Promise.all(updates.map(op => commitOperation(op, memory.store)));
  assert.equal(memory.state().tasks.filter(task => task.status === "done").length, 2);
  assert.equal(memory.state().activity.length, 4);
});

test("concurrent editors of same task receive a conflict instead of losing an edit", async () => {
  const initial = applyOperation(emptyWorkspace(), create("Task"));
  const memory = memoryStore(initial);
  const ops: Operation[] = ["A", "B"].map(title => ({ operationId: randomUUID(), type: "task.update", payload: { id: initial.tasks[0].id, title }, expectedUpdatedAt: initial.tasks[0].updatedAt }));
  const results = await Promise.allSettled(ops.map(op => commitOperation(op, memory.store)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof WorkspaceError);
  assert.equal(rejected.reason.code, "EDIT_CONFLICT");
  assert.equal(memory.state().activity.length, 2);
});

test("unavailable storage never turns a failed save into success", async () => {
  const store: WorkspaceStore = { async read() { return { state: emptyWorkspace(), version: null }; }, async write(_next: Workspace) { throw new Error("storage offline"); } };
  await assert.rejects(commitOperation(create("Unsaved"), store), /storage offline/);
});

test("API persists changes, prevents cross-site writes, rejects malformed JSON, and streams large Arabic history", async () => {
  const keys = ["LOCAL_DATA_PATH", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL"] as const;
  const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  await mkdir(path.join(process.cwd(), ".data"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".data", "storage-test-"));
  const file = path.join(directory, "workspace.json");
  for (const key of keys) delete process.env[key];
  process.env.LOCAL_DATA_PATH = file;
  try {
    const op = create("Persistent task");
    const response = await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(op) }));
    assert.equal(response.status, 200);
    const posted = await response.json();
    assert.equal(posted.state.tasks[0].title, "Persistent task");
    assert.equal(JSON.parse(await readFile(file, "utf8")).tasks[0].title, "Persistent task");
    assert.equal((await (await GET()).json()).state.tasks[0].title, "Persistent task");
    const loopback = await POST(new Request("http://localhost:3001/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify(create("Loopback save")) }));
    assert.equal(loopback.status, 200);
    assert.ok((await loopback.json()).state.tasks.some((task: { title: string }) => task.title === "Loopback save"));
    assert.equal((await POST(new Request("http://localhost:3001/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3001", Origin: "http://localhost:3001" }, body: JSON.stringify(create("Wrong host")) }))).status, 403);
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost", "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify(create("Cross-site")) }))).status, 403);
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", "X-Forwarded-Host": "unrelated.example", Origin: "http://unrelated.example" }, body: JSON.stringify(create("Untrusted proxy")) }))).status, 403);
    process.env.VERCEL = "1";
    const forwarded = await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", "X-Forwarded-Host": "team-desk.example.com", "X-Forwarded-Proto": "https", Origin: "https://team-desk.example.com" }, body: "{" }));
    assert.equal(forwarded.status, 400); // Origin accepted; malformed JSON rejected before accessing storage.
    delete process.env.VERCEL;
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" }, body: JSON.stringify(create("Blocked")) }))).status, 403);
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }))).status, 415);
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
    assert.equal((await POST(new Request("http://localhost/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: "a".repeat(512 * 1024 + 1) }))).status, 413);

    let large = emptyWorkspace();
    for (let index = 0; index < 25; index++) {
      large = applyOperation(large, { operationId: randomUUID(), type: "meeting.create", payload: { title: `Meeting ${index}`, date: "2026-11-05", minutes: "محضر ".repeat(6000), agenda: "نقاش ".repeat(6000) } });
    }
    await writeFile(file, JSON.stringify(large), "utf8");
    const streamed = await GET();
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers.get("content-length"), null);
    const reader = streamed.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      assert.ok(chunk.value.byteLength <= 65536);
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    assert.ok(bytes.byteLength > 4.5 * 1024 * 1024);
    assert.deepEqual(JSON.parse(bytes.toString("utf8")).state, large);
  } finally {
    await unlink(file).catch(() => undefined);
    await rmdir(directory);
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
