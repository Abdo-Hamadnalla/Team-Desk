import { randomUUID } from "node:crypto";
import type { Activity, EntityType, Meeting, Operation, Person, Task, Workspace } from "./types";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400, public code = "VALIDATION_ERROR") {
    super(message);
    this.name = "WorkspaceError";
  }
}

export function emptyWorkspace(): Workspace {
  return { schemaVersion: 1, revision: 0, tasks: [], meetings: [], people: [], activity: [], appliedOperations: [] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = {
  task: ["title", "description", "status", "priority", "assigneeId", "dueDate", "meetingIds"],
  meeting: ["title", "date", "time", "attendeeIds", "agenda", "minutes", "decisions", "actionItems"],
  person: ["name", "role"],
} as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string") throw new WorkspaceError(`${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw new WorkspaceError(`${label} is required.`);
  if (clean.length > max) throw new WorkspaceError(`${label} must be ${max.toLocaleString("en")} characters or fewer.`);
  return clean;
}

function date(value: unknown, label: string, required = false): string {
  const clean = text(value, label, 10, required);
  if (!clean && !required) return "";
  const parsed = new Date(`${clean}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== clean) {
    throw new WorkspaceError(`${label} must be a valid date.`);
  }
  return clean;
}

function memberId(value: unknown, state: Workspace, allowedArchived: string[] = []): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new WorkspaceError("Choose a valid team member.");
  const member = state.people.find(person => person.id === value);
  if (!member || (member.archived && !allowedArchived.includes(member.id))) throw new WorkspaceError("Choose an active team member.");
  return member.id;
}

function values(entityType: EntityType, payload: Record<string, unknown>, state: Workspace, existing?: Task | Meeting | Person): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const creating = !existing;
  for (const field of fields[entityType]) {
    if (!creating && !Object.hasOwn(payload, field)) continue;
    let value = payload[field];
    if (entityType === "task") {
      if (field === "title") value = text(value ?? "", "Task title", 200, true);
      if (field === "description") value = text(value ?? "", "Description", 12000);
      if (field === "dueDate") value = date(value ?? "", "Due date");
      if (field === "status") {
        value ??= "todo";
        if (typeof value !== "string" || !["todo", "progress", "review", "done"].includes(value)) throw new WorkspaceError("Choose a valid task status.");
      }
      if (field === "priority") {
        value ??= "medium";
        if (typeof value !== "string" || !["low", "medium", "high"].includes(value)) throw new WorkspaceError("Choose a valid priority.");
      }
      if (field === "assigneeId") value = memberId(value ?? null, state, existing && "assigneeId" in existing && existing.assigneeId ? [existing.assigneeId] : []);
      if (field === "meetingIds") {
        if (value === undefined && creating) value = [];
        if (!Array.isArray(value) || value.length > 100) throw new WorkspaceError("Choose up to 100 linked meetings.");
        const allowedArchived = existing && "meetingIds" in existing ? existing.meetingIds : [];
        value = [...new Set(value.map(id => {
          if (typeof id !== "string") throw new WorkspaceError("Choose a valid meeting.");
          const meeting = state.meetings.find(item => item.id === id);
          if (!meeting || (meeting.archived && !allowedArchived.includes(meeting.id))) {
            throw new WorkspaceError("Choose an active meeting.");
          }
          return meeting.id;
        }))].sort();
      }
    } else if (entityType === "meeting") {
      if (field === "title") value = text(value ?? "", "Meeting title", 200, true);
      if (field === "date") value = date(value ?? "", "Meeting date", true);
      if (field === "time") {
        value = text(value ?? "", "Meeting time", 5);
        if (value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new WorkspaceError("Meeting time must be a valid time.");
      }
      if (field === "attendeeIds") {
        value ??= [];
        if (!Array.isArray(value) || value.length > 100) throw new WorkspaceError("Choose up to 100 attendees.");
        const allowed = existing && "attendeeIds" in existing ? existing.attendeeIds : [];
        value = [...new Set(value.map(item => {
          const id = memberId(item, state, allowed);
          if (!id) throw new WorkspaceError("Choose a valid attendee.");
          return id;
        }))];
      }
      if (["agenda", "minutes", "decisions", "actionItems"].includes(field)) value = text(value ?? "", field === "actionItems" ? "Action items" : field, 30000);
    } else {
      if (field === "name") value = text(value ?? "", "Name", 100, true);
      if (field === "role") value = text(value ?? "", "Role", 100);
    }
    result[field] = value;
  }
  return result;
}

function displayValue(field: string, value: unknown, state: Workspace): string {
  const person = (id: unknown) => state.people.find(member => member.id === id)?.name ?? "Unknown team member";
  if (field === "assigneeId") return value ? person(value) : "Unassigned";
  if (field === "attendeeIds") return Array.isArray(value) ? value.map(person).join(", ") : "";
  if (field === "meetingIds") return Array.isArray(value) ? value.map(id => {
    const meeting = state.meetings.find(item => item.id === id);
    return meeting ? `${meeting.title} (${meeting.date})` : "Unknown meeting";
  }).join("; ") : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value == null ? "" : String(value);
}

export function parseOperation(input: unknown): Operation {
  const body = object(input, "Request");
  if (typeof body.operationId !== "string" || !UUID.test(body.operationId)) throw new WorkspaceError("A valid operation ID is required.");
  if (typeof body.type !== "string" || !/^(task|meeting|person)\.(create|update|archive|restore)$/.test(body.type)) throw new WorkspaceError("Unknown workspace action.");
  const payload = object(body.payload, "Action data");
  const [entityType, action] = body.type.split(".") as [EntityType, string];
  const allowed: readonly string[] = action === "create" ? fields[entityType] : action === "update" ? ["id", ...fields[entityType]] : ["id"];
  if (Object.keys(payload).some(field => !allowed.includes(field))) throw new WorkspaceError("Action data includes an unsupported field.");
  const actor = body.actor == null ? "Team member" : text(body.actor, "Your name", 100) || "Team member";
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== "string") throw new WorkspaceError("The previous update timestamp is invalid.");
  return { operationId: body.operationId, actor, type: body.type as Operation["type"], payload, expectedUpdatedAt: body.expectedUpdatedAt as string | undefined };
}

export function applyOperation(state: Workspace, input: unknown, clock = new Date()): Workspace {
  const operation = parseOperation(input);
  if (state.appliedOperations.includes(operation.operationId)) return state;
  const [entityType, action] = operation.type.split(".") as [EntityType, string];
  const collectionName = entityType === "person" ? "people" : entityType === "task" ? "tasks" : "meetings";
  const collection: Array<Task | Meeting | Person> = state[collectionName];
  const existing = action === "create" ? undefined : collection.find(entity => entity.id === operation.payload.id);
  if (action !== "create" && !existing) throw new WorkspaceError("This item could not be found. Refresh the workspace.", 404, "NOT_FOUND");
  if (existing && operation.expectedUpdatedAt !== existing.updatedAt) {
    throw new WorkspaceError("Someone changed this item while you were editing. Refresh and review their changes before saving.", 409, "EDIT_CONFLICT");
  }
  const timestamp = new Date(Math.max(clock.valueOf(), existing ? new Date(existing.updatedAt).valueOf() + 1 : 0)).toISOString();
  let changedValues: Record<string, unknown>;
  if (action === "archive" || action === "restore") changedValues = { archived: action === "archive" };
  else changedValues = values(entityType, operation.payload, state, existing);
  if (entityType === "person" && typeof changedValues.name === "string" && state.people.some(person => person.id !== existing?.id && !person.archived && person.name.toLocaleLowerCase() === String(changedValues.name).toLocaleLowerCase())) {
    throw new WorkspaceError("An active team member already has this name.");
  }
  const linkingArchivedTask = entityType === "task" && Object.hasOwn(operation.payload, "meetingIds") &&
    Object.keys(operation.payload).every(field => field === "id" || field === "meetingIds");
  if (existing?.archived && action === "update" && !linkingArchivedTask) throw new WorkspaceError("Restore this item before editing it.", 409, "ITEM_ARCHIVED");
  if (entityType === "person" && action === "restore" && existing && "name" in existing && state.people.some(person => person.id !== existing.id && !person.archived && person.name.toLocaleLowerCase() === existing.name.toLocaleLowerCase())) {
    throw new WorkspaceError("An active team member already has this name. Rename that member before restoring this one.");
  }
  const changes: Activity["changes"] = Object.entries(changedValues).flatMap(([field, value]) => {
    const previous = existing ? (existing as unknown as Record<string, unknown>)[field] : undefined;
    if (existing && JSON.stringify(previous) === JSON.stringify(value)) return [];
    return [{ field, from: existing ? displayValue(field, previous, state) : "", to: displayValue(field, value, state) }];
  });
  const next = { ...state, revision: state.revision + 1, appliedOperations: [...state.appliedOperations, operation.operationId] };
  if (existing && changes.length === 0) return next;
  const entity = existing
    ? { ...existing, ...changedValues, updatedAt: timestamp }
    : { id: randomUUID(), archived: false, createdAt: timestamp, updatedAt: timestamp, ...changedValues };
  const title = entityType === "person" ? String((entity as Person).name) : String((entity as Task | Meeting).title);
  const entry: Activity = {
    id: randomUUID(), entityType, entityId: entity.id, entityTitle: title,
    action: action === "create" ? "created" : action === "update" ? "updated" : action === "archive" ? "archived" : "restored",
    actor: operation.actor || "Team member", at: timestamp, changes,
  };
  return {
    ...next,
    [collectionName]: existing ? collection.map(item => item.id === entity.id ? entity : item) : [...collection, entity],
    activity: [entry, ...state.activity],
  } as Workspace;
}

export function decodeWorkspace(value: unknown): Workspace {
  const state = object(value, "Stored workspace");
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || !["tasks", "meetings", "people", "activity", "appliedOperations"].every(field => Array.isArray(state[field]))) {
    throw new WorkspaceError("The stored workspace format is not supported. Your data has not been changed.", 503, "STORAGE_FORMAT_ERROR");
  }
  // Older saved workspaces have no meeting links. Add only the new field,
  // without rewriting IDs, history, timestamps, or the original stored object.
  const tasks = (state.tasks as unknown[]).map(value => {
    const task = object(value, "Stored task");
    if (!Object.hasOwn(task, "meetingIds")) return { ...task, meetingIds: [] };
    if (!Array.isArray(task.meetingIds) || task.meetingIds.some(id => typeof id !== "string")) {
      throw new WorkspaceError("Stored task meeting links are invalid. Your data has not been changed.", 503, "STORAGE_FORMAT_ERROR");
    }
    return task;
  });
  return { ...state, tasks } as unknown as Workspace;
}
