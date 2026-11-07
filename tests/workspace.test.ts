import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyOperation, decodeWorkspace, emptyWorkspace, parseOperation, WorkspaceError } from "../src/lib/workspace";
import type { Operation, Task, Workspace } from "../src/lib/types";

function operation(type: Operation["type"], payload: Operation["payload"], expectedUpdatedAt?: string): Operation {
  return { operationId: randomUUID(), type, payload, expectedUpdatedAt, actor: "Sara" };
}
function withPerson() { return applyOperation(emptyWorkspace(), operation("person.create", { name: "Ali", role: "Design" })); }
function withTask(): Workspace {
  const state = withPerson();
  return applyOperation(state, operation("task.create", { title: "Prepare proposal", assigneeId: state.people[0].id }));
}

test("starts empty and creates an assigned task with full history without changing previous state", () => {
  const state = withPerson();
  const snapshot = structuredClone(state);
  const next = applyOperation(state, operation("task.create", { title: "  Prepare proposal  ", assigneeId: state.people[0].id }), new Date("2026-11-05T10:00:00Z"));
  assert.deepEqual(state, snapshot);
  assert.equal(next.tasks[0].title, "Prepare proposal");
  assert.equal(next.tasks[0].status, "todo");
  assert.equal(next.tasks[0].priority, "medium");
  assert.deepEqual(next.tasks[0].meetingIds, []);
  assert.equal(next.tasks[0].createdAt, "2026-11-05T10:00:00.000Z");
  assert.equal(next.activity[0].actor, "Sara");
  assert.equal(next.activity[0].action, "created");
  assert.deepEqual(next.activity[0].changes.find(change => change.field === "assigneeId"), { field: "assigneeId", from: "", to: "Ali" });
  assert.equal(emptyWorkspace().tasks.length, 0);
});

test("status and assignee edits record previous and new values", () => {
  const state = withTask();
  const task = state.tasks[0];
  const next = applyOperation(state, operation("task.update", { id: task.id, status: "progress", assigneeId: null }, task.updatedAt));
  assert.deepEqual(next.activity[0].changes, [
    { field: "status", from: "todo", to: "progress" },
    { field: "assigneeId", from: "Ali", to: "Unassigned" },
  ]);
  assert.ok(next.tasks[0].updatedAt > task.updatedAt);
  assert.equal(next.tasks[0].createdAt, task.createdAt);
});

test("stale and missing edit versions cannot overwrite another person's changes", () => {
  const state = withTask();
  const original = state.tasks[0];
  const newer = applyOperation(state, operation("task.update", { id: original.id, title: "New title" }, original.updatedAt));
  for (const version of [undefined, original.updatedAt]) {
    assert.throws(() => applyOperation(newer, operation("task.update", { id: original.id, title: "Overwrite" }, version)), (error: unknown) => error instanceof WorkspaceError && error.status === 409);
  }
  assert.equal(newer.tasks[0].title, "New title");
});

test("repeating the same operation creates no duplicate task or activity even after later changes", () => {
  const create = operation("task.create", { title: "Exactly once" });
  const state = applyOperation(emptyWorkspace(), create);
  const later = applyOperation(state, operation("task.update", { id: state.tasks[0].id, status: "done" }, state.tasks[0].updatedAt));
  assert.equal(applyOperation(later, create), later);
  assert.equal(later.tasks.length, 1);
  assert.equal(later.activity.length, 2);
});

test("no-op updates do not add history or change entity timestamps", () => {
  const state = withTask();
  const task = state.tasks[0];
  const update = operation("task.update", { id: task.id, title: task.title }, task.updatedAt);
  const next = applyOperation(state, update);
  assert.equal(next.activity.length, state.activity.length);
  assert.equal(next.tasks[0].updatedAt, task.updatedAt);
  assert.ok(next.appliedOperations.includes(update.operationId));
});

test("archive and restore preserve contents and history; archived edits are rejected", () => {
  const state = withTask();
  const task = state.tasks[0];
  const archived = applyOperation(state, operation("task.archive", { id: task.id }, task.updatedAt));
  assert.equal(archived.tasks[0].archived, true);
  assert.throws(() => applyOperation(archived, operation("task.update", { id: task.id, title: "New" }, archived.tasks[0].updatedAt)), /Restore this item/);
  const restored = applyOperation(archived, operation("task.restore", { id: task.id }, archived.tasks[0].updatedAt));
  assert.equal(restored.tasks[0].archived, false);
  assert.equal(restored.tasks[0].title, task.title);
  assert.deepEqual(restored.activity.slice(0, 2).map(entry => entry.action), ["restored", "archived"]);
});

test("Arabic meeting minutes, attendees, decisions, and actions round trip and retain prior history", () => {
  const state = withPerson();
  const saved = applyOperation(state, operation("meeting.create", {
    title: "الاجتماع الأسبوعي", date: "2026-11-05", time: "14:30", attendeeIds: [state.people[0].id],
    minutes: "ناقشنا خطة العمل\nوتوزيع المهام", decisions: "الموافقة على الخطة", actionItems: "علي: إعداد التقرير",
  }));
  assert.equal(saved.meetings[0].minutes, "ناقشنا خطة العمل\nوتوزيع المهام");
  const revised = applyOperation(saved, operation("meeting.update", { id: saved.meetings[0].id, minutes: "المحضر المعدل" }, saved.meetings[0].updatedAt));
  assert.deepEqual(revised.activity[0].changes, [{ field: "minutes", from: "ناقشنا خطة العمل\nوتوزيع المهام", to: "المحضر المعدل" }]);
  assert.equal(saved.activity[0].changes.find(change => change.field === "attendeeIds")?.to, "Ali");
});

test("invalid dates and times, unknown enum values, blank titles, and oversized inputs are rejected", () => {
  const cases: Array<[Operation["type"], Operation["payload"]]> = [
    ["task.create", { title: " " }], ["task.create", { title: "A".repeat(201) }],
    ["task.create", { title: "Task", status: "deleted" }], ["task.create", { title: "Task", priority: "urgent" }],
    ["task.create", { title: "Task", status: ["todo"] }], ["task.create", { title: "Task", priority: ["high"] }],
    ["task.create", { title: "Task", dueDate: "2026-02-30" }], ["task.create", { title: "Task", assigneeId: randomUUID() }],
    ["meeting.create", { title: "Meeting" }], ["meeting.create", { title: "Meeting", date: "2026-13-05" }],
    ["meeting.create", { title: "Meeting", date: "2026-11-05", time: "25:00" }],
    ["meeting.create", { title: "Meeting", date: "2026-11-05", attendeeIds: [null] }],
  ];
  for (const [type, payload] of cases) assert.throws(() => applyOperation(emptyWorkspace(), operation(type, payload)), WorkspaceError);
  assert.doesNotThrow(() => applyOperation(emptyWorkspace(), operation("meeting.create", { title: "Leap day", date: "2028-02-29" })));
});

test("unknown fields cannot set IDs, history, or server timestamps", () => {
  for (const field of ["id", "updatedAt", "createdAt", "archived", "activity"]) {
    assert.throws(() => applyOperation(emptyWorkspace(), operation("task.create", { title: "Task", [field]: "injected" })), /unsupported field/);
  }
  assert.throws(() => parseOperation({ operationId: "bad", type: "task.create", payload: {} }), /operation ID/);
});

test("archived members keep existing assignments but cannot receive new assignments", () => {
  const state = withTask();
  const person = state.people[0];
  const archived = applyOperation(state, operation("person.archive", { id: person.id }, person.updatedAt));
  assert.equal(archived.tasks[0].assigneeId, person.id);
  assert.doesNotThrow(() => applyOperation(archived, operation("task.update", { id: archived.tasks[0].id, assigneeId: person.id, description: "Updated" }, archived.tasks[0].updatedAt)));
  assert.throws(() => applyOperation(archived, operation("task.create", { title: "New task", assigneeId: person.id })), /active team member/);
});

test("member names are unique among active members and safe restore prevents ambiguous duplicates", () => {
  const state = withPerson();
  assert.throws(() => applyOperation(state, operation("person.create", { name: "ALI" })), /already has this name/);
  const archived = applyOperation(state, operation("person.archive", { id: state.people[0].id }, state.people[0].updatedAt));
  const replacement = applyOperation(archived, operation("person.create", { name: "Ali" }));
  assert.throws(() => applyOperation(replacement, operation("person.restore", { id: state.people[0].id }, archived.people[0].updatedAt)), /already has this name/);
});

function withMeetings(): Workspace {
  let state = withTask();
  state = applyOperation(state, operation("meeting.create", { title: "المحضر الأول", date: "2026-10-26" }));
  return applyOperation(state, operation("meeting.create", { title: "اجتماع المتابعة", date: "2026-11-02" }));
}

test("legacy workspaces gain empty meeting links without changing original content or history", () => {
  const original = withTask();
  const legacy = structuredClone(original);
  delete (legacy.tasks[0] as Partial<Task>).meetingIds;
  const before = JSON.stringify(legacy);
  const decoded = decodeWorkspace(legacy);
  assert.deepEqual(decoded, original);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(decoded.revision, original.revision);
  assert.deepEqual(decoded.activity, original.activity);
  assert.equal(decoded.tasks[0].createdAt, original.tasks[0].createdAt);
  assert.equal(decoded.tasks[0].updatedAt, original.tasks[0].updatedAt);
  assert.throws(() => decodeWorkspace({ ...original, tasks: [{ ...original.tasks[0], meetingIds: null }] }), (error: unknown) => error instanceof WorkspaceError && error.code === "STORAGE_FORMAT_ERROR");
});

test("creating a linked task deduplicates meeting IDs and records readable meeting names", () => {
  const initial = withMeetings();
  const [first, second] = initial.meetings;
  const state = applyOperation(initial, operation("task.create", { title: "Shared task", meetingIds: [second.id, first.id, second.id] }));
  const task = state.tasks.find(item => item.title === "Shared task")!;
  assert.deepEqual(task.meetingIds, [first.id, second.id].sort());
  const change = state.activity[0].changes.find(item => item.field === "meetingIds")!;
  assert.equal(change.from, "");
  assert.ok(change.to.includes("المحضر الأول (2026-10-26)"));
  assert.ok(change.to.includes("اجتماع المتابعة (2026-11-02)"));
  assert.ok(!change.to.includes(first.id));
  assert.deepEqual(initial.tasks[0].meetingIds, []);
});

test("carrying unfinished work to another meeting retains one task and its original meeting link", () => {
  let state = withMeetings();
  const originalTask = state.tasks[0];
  const [first, second] = state.meetings;
  state = applyOperation(state, operation("task.update", { id: originalTask.id, meetingIds: [first.id] }, originalTask.updatedAt));
  const beforeCarry = state.tasks[0];
  state = applyOperation(state, operation("task.update", { id: beforeCarry.id, meetingIds: [...beforeCarry.meetingIds, second.id] }, beforeCarry.updatedAt));
  const carried = state.tasks[0];
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(carried.meetingIds, [first.id, second.id].sort());
  assert.equal(carried.id, originalTask.id);
  assert.equal(carried.createdAt, originalTask.createdAt);
  assert.equal(carried.status, "todo");
  assert.equal(carried.assigneeId, originalTask.assigneeId);
  assert.equal(carried.description, originalTask.description);
  assert.equal(state.activity[0].changes.length, 1);
  assert.equal(state.activity[0].changes[0].field, "meetingIds");
  assert.equal(state.activity[0].changes[0].from, "المحضر الأول (2026-10-26)");
  // Unlinking is explicit and affects only the association, not either record.
  state = applyOperation(state, operation("task.update", { id: carried.id, meetingIds: [second.id] }, carried.updatedAt));
  assert.deepEqual(state.tasks[0].meetingIds, [second.id]);
  assert.equal(state.meetings.length, 2);
  assert.equal(state.tasks.length, 1);
});

test("meeting links reject malformed, nonexistent, oversized, and newly archived targets", () => {
  let state = withMeetings();
  const [first] = state.meetings;
  state = applyOperation(state, operation("meeting.archive", { id: first.id }, first.updatedAt));
  const invalid: unknown[] = [null, "meeting", {}, [null], [1], [""], [randomUUID()], Array(101).fill(first.id), [first.id]];
  for (const meetingIds of invalid) {
    assert.throws(() => applyOperation(state, operation("task.create", { title: "Bad link", meetingIds })), WorkspaceError);
    assert.throws(() => applyOperation(state, operation("task.update", { id: state.tasks[0].id, meetingIds }, state.tasks[0].updatedAt)), WorkspaceError);
  }
});

test("archived meetings remain linked while edits add an active meeting or deliberately remove old links", () => {
  let state = withMeetings();
  const [first, second] = state.meetings;
  state = applyOperation(state, operation("task.update", { id: state.tasks[0].id, meetingIds: [first.id] }, state.tasks[0].updatedAt));
  state = applyOperation(state, operation("meeting.archive", { id: first.id }, first.updatedAt));
  state = applyOperation(state, operation("task.update", { id: state.tasks[0].id, description: "Still relevant" }, state.tasks[0].updatedAt));
  assert.deepEqual(state.tasks[0].meetingIds, [first.id]);
  state = applyOperation(state, operation("task.update", { id: state.tasks[0].id, meetingIds: [first.id, second.id] }, state.tasks[0].updatedAt));
  assert.deepEqual(state.tasks[0].meetingIds, [first.id, second.id].sort());
  state = applyOperation(state, operation("task.update", { id: state.tasks[0].id, meetingIds: [second.id] }, state.tasks[0].updatedAt));
  assert.deepEqual(state.tasks[0].meetingIds, [second.id]);
  assert.throws(() => applyOperation(state, operation("task.update", { id: state.tasks[0].id, meetingIds: [first.id, second.id] }, state.tasks[0].updatedAt)), /active meeting/);
});

test("archived tasks allow only meeting-link updates without restoring or changing their content", () => {
  let state = withMeetings();
  const original = state.tasks[0];
  state = applyOperation(state, operation("task.archive", { id: original.id }, original.updatedAt));
  const archived = state.tasks[0];
  state = applyOperation(state, operation("task.update", { id: archived.id, meetingIds: state.meetings.map(meeting => meeting.id) }, archived.updatedAt));
  assert.equal(state.tasks[0].archived, true);
  assert.deepEqual({ ...state.tasks[0], meetingIds: [], updatedAt: archived.updatedAt }, archived);
  assert.deepEqual(state.activity[0].changes.map(change => change.field), ["meetingIds"]);
  assert.throws(() => applyOperation(state, operation("task.update", { id: original.id, title: original.title, meetingIds: [] }, state.tasks[0].updatedAt)), (error: unknown) => error instanceof WorkspaceError && error.code === "ITEM_ARCHIVED");
  assert.throws(() => applyOperation(state, operation("task.update", { id: original.id, status: "done" }, state.tasks[0].updatedAt)), /Restore this item/);
});

test("meeting-link edits keep optimistic concurrency, replay protection, and set-order no-op behavior", () => {
  let state = withMeetings();
  const task = state.tasks[0];
  const [first, second] = state.meetings;
  const addFirst = operation("task.update", { id: task.id, meetingIds: [first.id] }, task.updatedAt);
  state = applyOperation(state, addFirst);
  assert.throws(() => applyOperation(state, operation("task.update", { id: task.id, meetingIds: [second.id] }, task.updatedAt)), (error: unknown) => error instanceof WorkspaceError && error.code === "EDIT_CONFLICT");
  state = applyOperation(state, operation("task.update", { id: task.id, meetingIds: [first.id, second.id] }, state.tasks[0].updatedAt));
  assert.equal(applyOperation(state, addFirst), state);
  const before = state;
  state = applyOperation(state, operation("task.update", { id: task.id, meetingIds: [second.id, first.id, second.id] }, state.tasks[0].updatedAt));
  assert.equal(state.activity.length, before.activity.length);
  assert.equal(state.tasks[0].updatedAt, before.tasks[0].updatedAt);
  assert.deepEqual(state.tasks[0].meetingIds, before.tasks[0].meetingIds);
});
