const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;

export function resolveOutputLimit(value?: number): number {
  const configured = Number(value ?? process.env.AGENTIX_PROCESS_OUTPUT_LIMIT_BYTES);
  if (!Number.isFinite(configured)) return DEFAULT_OUTPUT_LIMIT_BYTES;
  return Math.min(16 * 1024 * 1024, Math.max(1024, Math.floor(configured)));
}

export class OutputBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly limitBytes = DEFAULT_OUTPUT_LIMIT_BYTES) {}

  append(value: Buffer | string): void {
    if (this.bytes >= this.limitBytes) {
      this.truncated = true;
      return;
    }
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = this.limitBytes - this.bytes;
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.bytes += remaining;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.bytes).toString("utf-8");
  }
}
