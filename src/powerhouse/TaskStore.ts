import { join } from "node:path";
import { PATHS } from "../config/paths.js";
import { JsonFileStore } from "../storage/JsonFileStore.js";
import type { Task } from "./types.js";

interface TaskStoreFile {
  tasks: Task[];
}

export class TaskStore {
  private readonly store: JsonFileStore<TaskStoreFile>;

  constructor(file = join(PATHS.dataDir, "tasks", "tasks.json")) {
    this.store = new JsonFileStore<TaskStoreFile>(file, { tasks: [] });
  }

  upsert(task: Task): void {
    this.store.update((current) => {
      const idx = current.tasks.findIndex((item) => item.id === task.id);
      const next = { ...task };
      if (idx >= 0) current.tasks[idx] = next;
      else current.tasks.push(next);
      return current;
    });
  }

  list(sessionId?: string): Task[] {
    const tasks = this.store.read().tasks;
    return sessionId ? tasks.filter((task) => task.sessionId === sessionId) : tasks;
  }

  get(taskId: string): Task | undefined {
    return this.store.read().tasks.find((task) => task.id === taskId);
  }

  recoverOpen(): Task[] {
    return this.store
      .read()
      .tasks.filter((task) =>
        ["queued", "running", "awaiting-approval"].includes(task.status),
      );
  }
}
