import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = ["index.html", "app.js", "styles.css"] as const;

function readFrontendFile(area: "src" | "dist", file: typeof files[number]): string {
  return readFileSync(join(root, "frontend", area, file), "utf-8");
}

describe("frontend dashboard build surface", () => {
  it("keeps generated dashboard assets in sync with source", () => {
    for (const file of files) {
      expect(readFrontendFile("dist", file)).toBe(readFrontendFile("src", file));
    }
  });

  it("preserves the interactive Agentix control surface", () => {
    const html = readFrontendFile("src", "index.html");
    const app = readFrontendFile("src", "app.js");

    expect(html).toContain("Command palette");
    expect(html).toContain('data-view="scheduler"');
    expect(html).toContain('data-view="gateway"');
    expect(html).toContain('data-view="approvals"');
    expect(html).toContain('id="composeForm"');
    expect(app).toContain("new EventSource");
    expect(app).toContain("Authorization: `Bearer ${state.sessionToken}`");
    expect(app).toContain("/execute/stream");
    expect(app).toContain("/scheduler/jobs");
    expect(app).toContain("/gateway");
    expect(app).toContain("/support/bundle");
    expect(app).toContain("data-action=\"approve");
    expect(app).toContain("data-action=\"restart-task-detail");
  });
});
