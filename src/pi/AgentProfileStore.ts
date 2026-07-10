import { JsonFileStore } from "../storage/JsonFileStore.js";
import { PATHS } from "../config/paths.js";

export interface CommandAgentProfile {
  id: string;
  kind: string;
  description?: string;
  enabled: boolean;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
}

interface AgentProfileFile {
  profiles: CommandAgentProfile[];
}

function normalizeProfile(profile: CommandAgentProfile): CommandAgentProfile | null {
  if (!profile.id?.trim() || !profile.kind?.trim()) return null;
  if (!Array.isArray(profile.command) || profile.command.length === 0) return null;
  const command = profile.command.map((part) => String(part)).filter(Boolean);
  if (command.length === 0) return null;
  return {
    id: profile.id.trim(),
    kind: profile.kind.trim(),
    description: profile.description?.trim() || undefined,
    enabled: profile.enabled !== false,
    command,
    cwd: profile.cwd?.trim() || undefined,
    timeoutMs: Number.isFinite(profile.timeoutMs) && profile.timeoutMs! > 0
      ? Math.min(profile.timeoutMs!, 10 * 60_000)
      : 60_000,
  };
}

export class AgentProfileStore {
  private readonly store: JsonFileStore<AgentProfileFile>;

  constructor(file = PATHS.agentProfilesFile) {
    this.store = new JsonFileStore(file, { profiles: [] });
  }

  list(): CommandAgentProfile[] {
    return this.store
      .read()
      .profiles
      .map((profile) => normalizeProfile(profile))
      .filter((profile): profile is CommandAgentProfile => Boolean(profile));
  }

  enabled(): CommandAgentProfile[] {
    return this.list().filter((profile) => profile.enabled);
  }

  upsert(profile: CommandAgentProfile): CommandAgentProfile {
    const normalized = normalizeProfile(profile);
    if (!normalized) {
      throw new Error("invalid agent profile");
    }
    this.store.update((current) => ({
      profiles: [
        ...current.profiles.filter((item) => item.id !== normalized.id),
        normalized,
      ],
    }));
    return normalized;
  }

  setEnabled(id: string, enabled: boolean): CommandAgentProfile | undefined {
    let updated: CommandAgentProfile | undefined;
    this.store.update((current) => ({
      profiles: current.profiles.map((profile) => {
        if (profile.id !== id) return profile;
        updated = { ...profile, enabled };
        return updated;
      }),
    }));
    return updated ? normalizeProfile(updated) ?? undefined : undefined;
  }

  remove(id: string): CommandAgentProfile | undefined {
    let removed: CommandAgentProfile | undefined;
    this.store.update((current) => ({
      profiles: current.profiles.filter((profile) => {
        if (profile.id !== id) return true;
        removed = normalizeProfile(profile) ?? undefined;
        return false;
      }),
    }));
    return removed;
  }
}
