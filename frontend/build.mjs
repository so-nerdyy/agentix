import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, "src");
const distDir = resolve(__dirname, "dist");

const requiredFiles = ["index.html", "app.js", "styles.css"];

async function assertRequiredSources() {
  for (const file of requiredFiles) {
    const filePath = join(srcDir, file);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`missing frontend source file: ${filePath}`);
    }
  }
}

async function copySourceTree(source, target) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copySourceTree(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
}

await assertRequiredSources();
await rm(distDir, { recursive: true, force: true });
await copySourceTree(srcDir, distDir);
console.log(`Built frontend dashboard: ${srcDir} -> ${distDir}`);
