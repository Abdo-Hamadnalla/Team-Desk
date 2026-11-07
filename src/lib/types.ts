export type Status = "todo" | "progress" | "review" | "done";
export type Priority = "low" | "medium" | "high";

export interface Entity {
  id: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Person extends Entity {
  name: string;
  role: string;
}

export interface Task extends Entity {
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assigneeId: string | null;
  dueDate: string;
  meetingIds: string[];
}

export interface Meeting extends Entity {
  title: string;
  date: string;
  time: string;
  attendeeIds: string[];
  agenda: string;
  minutes: string;
  decisions: string;
  actionItems: string;
}

export interface Activity {
  id: string;
  entityType: "task" | "meeting" | "person";
  entityId: string;
  entityTitle: string;
  action: string;
  actor: string;
  at: string;
  changes: Array<{ field: string; from: string; to: string }>;
}

export interface Workspace {
  schemaVersion: 1;
  revision: number;
  tasks: Task[];
  meetings: Meeting[];
  people: Person[];
  activity: Activity[];
  appliedOperations: string[];
}

export type EntityType = Activity["entityType"];
export type OperationType = `${EntityType}.${"create" | "update" | "archive" | "restore"}`;

export interface Operation {
  operationId: string;
  actor?: string;
  type: OperationType;
  payload: Record<string, unknown>;
  expectedUpdatedAt?: string;
}
