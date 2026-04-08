export function normalizeToLF(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function detectLineEnding(value: string): "\n" | "\r\n" {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

export function restoreLineEndings(value: string, lineEnding: "\n" | "\r\n") {
  return lineEnding === "\r\n" ? value.replace(/\n/g, "\r\n") : value;
}

export function stripBom(value: string) {
  return value.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: value.slice(1) }
    : { bom: "", text: value };
}

export function isProbablyBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}
