import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release packaging files", () => {
  it("exposes release manifest and checksum-aware installers", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    const shell = readFileSync(join(process.cwd(), "install.sh"), "utf-8");
    const powershell = readFileSync(join(process.cwd(), "install.ps1"), "utf-8");
    const manifest = readFileSync(join(process.cwd(), "scripts", "release-manifest.mjs"), "utf-8");
    const smoke = readFileSync(join(process.cwd(), "scripts", "release-smoke.mjs"), "utf-8");
    const verifier = readFileSync(join(process.cwd(), "scripts", "verify-public-release.mjs"), "utf-8");
    const releaseWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "release.yml"), "utf-8");
    const ciWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf-8");
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf-8");
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf-8");

    expect(pkg.scripts.prepack).toBe("npm run build");
    expect(pkg.scripts["release:manifest"]).toBe("node scripts/release-manifest.mjs");
    expect(pkg.scripts["release:verify"]).toBe("node scripts/verify-public-release.mjs");
    expect(shell).toContain("AGENTIX_EXPECTED_SHA256");
    expect(shell).toContain("AGENTIX_VERSION");
    expect(shell).toContain("Checksum mismatch");
    expect(powershell).toContain("AGENTIX_EXPECTED_SHA256");
    expect(powershell).toContain("AGENTIX_VERSION");
    expect(powershell).toContain("Checksum mismatch");
    expect(powershell).toContain("Get-AgentixFileSha256");
    expect(powershell).toContain("System.Security.Cryptography.SHA256");
    expect(manifest).toContain("createHash");
    expect(manifest).toContain("sha256");
    expect(smoke).toContain("smokeInstallerChecksum");
    expect(smoke).toContain("smokeVersionedReleaseInstall");
    expect(smoke).toContain("tampered release artifact");
    expect(smoke).toContain("AGENTIX_RELEASE_BASE_URL");
    expect(smoke).toContain("verify-public-release.mjs");
    expect(smoke).toContain("installHermesPythonDependencies");
    expect(smoke).toContain("pip\", \"install\"");
    expect(verifier).toContain("verifyNpm");
    expect(verifier).toContain("verifyGitHubRelease");
    expect(verifier).toContain("verifyInstaller");
    expect(verifier).toContain("AGENTIX_VERIFY_SKIP_NPM");
    expect(releaseWorkflow).toContain("npm publish --provenance");
    expect(releaseWorkflow).toContain(".release/*-manifest.json");
    expect(dockerfile).toContain("dist/cli.js");
    expect(dockerfile).toContain("\"server\"");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(compose).toContain("AGENTIX_SESSION_TOKEN");
    expect(ciWorkflow).toContain("docker build -t agentix:ci .");
  });
});
