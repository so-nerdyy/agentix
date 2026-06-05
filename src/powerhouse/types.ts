// Shared types for the Powerhouse orchestration layer.

export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting-approval"
  | "complete"
  | "rejected"
  | "failed";

export type TaskKind =
  | "user-message" // routed to a conversation PI agent
  | "bash" // requires ApprovalWorkflow
  | "code-edit" // requires ApprovalWorkflow
  | "sandbox-run"; // local sandbox-directory execution; approval-gated by default

export type TaskPriority = "user" | "background";

export interface Task {
  id: string;
  sessionId: string;
  planId?: string;
  stepId?: string;
  dependsOn?: string[];
  kind: TaskKind;
  priority: TaskPriority;
  status: TaskStatus;
  payload: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
  attempts: number;
  maxAttempts: number;
  requiresApproval: boolean;
  approvalId?: string;
  validation?: unknown;
}

export type SessionStatus = "pending" | "active" | "complete" | "failed";

export interface Session {
  id: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  pendingTaskIds: string[];
}

export interface TaskResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export type TaskAction =
  | "cancel"
  | "retry"
  | "restart";
