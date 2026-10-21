import { File } from "expo-file-system";

function parse(file: File): unknown {
  const value: unknown = JSON.parse(file.textSync());
  if (value === null || typeof value !== "object") throw new Error("Invalid metadata file.");
  return value;
}

// Synchronous commits cannot interleave in this JS runtime. Never truncate the
// live file: a killed process leaves either the primary or its previous version.
export function writeJson(file: File, value: unknown): void {
  const temporary = new File(`${file.uri}.tmp`), backup = new File(`${file.uri}.bak`);
  temporary.write(JSON.stringify(value));
  parse(temporary);
  let valid = false;
  try { valid = Array.isArray(parse(file)) === Array.isArray(value); } catch { /* preserve the last good backup */ }
  if (valid) {
    if (backup.exists) backup.delete();
    new File(file.uri).move(backup);
  } else if (file.exists) file.delete();
  temporary.move(file);
}

export function readJson<T>(file: File, fallback: T): T {
  for (const candidate of [file, new File(`${file.uri}.bak`)]) {
    try {
      const value = parse(candidate);
      if (fallback === null || Array.isArray(value) === Array.isArray(fallback)) return value as T;
    } catch { /* try the last committed version */ }
  }
  return fallback;
}
