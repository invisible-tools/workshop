import { readdir } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

export interface SearchEntry {
  absolutePath: string;
  relativePath: string;
  isDirectory: boolean;
}

export function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

export function matchesGlobPattern(filePath: string, pattern: string) {
  const normalizedPath = toPosixPath(filePath.replace(/\/$/, ""));

  if (path.matchesGlob(normalizedPath, pattern)) {
    return true;
  }

  if (!pattern.includes("/")) {
    return path.matchesGlob(path.basename(normalizedPath), pattern);
  }

  return false;
}

export async function walkSearchTree(
  rootDirectory: string,
  currentDirectory: string,
  visit: (entry: SearchEntry) => Promise<boolean | void>,
): Promise<boolean> {
  const dirents = await readdir(currentDirectory, { withFileTypes: true });
  dirents.sort((left, right) =>
    left.name.toLowerCase().localeCompare(right.name.toLowerCase()),
  );

  for (const dirent of dirents) {
    if (dirent.isDirectory() && IGNORED_DIRECTORIES.has(dirent.name)) {
      continue;
    }

    const absolutePath = path.join(currentDirectory, dirent.name);
    const relativePath = toPosixPath(path.relative(rootDirectory, absolutePath));
    const shouldStop = await visit({
      absolutePath,
      relativePath: dirent.isDirectory() ? `${relativePath}/` : relativePath,
      isDirectory: dirent.isDirectory(),
    });

    if (shouldStop) {
      return true;
    }

    if (dirent.isDirectory()) {
      const stopped = await walkSearchTree(
        rootDirectory,
        absolutePath,
        visit,
      );

      if (stopped) {
        return true;
      }
    }
  }

  return false;
}
