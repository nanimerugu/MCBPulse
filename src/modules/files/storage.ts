import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The storage seam (blueprint §6: "Object Storage"; §21 rule 13: "Keep
 * external integrations behind adapters").
 *
 * Unlike the Connect and AI adapters, this one is REAL: the shipped local
 * adapter actually writes bytes to disk, so uploads and downloads genuinely
 * work. Object storage is a swap of this file, not a change anywhere else.
 *
 * Files land OUTSIDE the repository, under FILE_STORAGE_DIR (defaulting to
 * `.storage` beside the project). Putting user uploads inside `public/`
 * would let Next serve them directly from our own origin, which is exactly
 * the stored-XSS route the validation layer exists to close — every read
 * goes through an authorised route instead.
 */

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

export interface FileStorage {
  readonly name: string;
  put(key: string, bytes: Buffer): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

function rootDir(): string {
  return process.env.FILE_STORAGE_DIR ?? path.join(process.cwd(), ".storage");
}

/** Belt and braces: a key must never escape the root, whatever produced it. */
function resolveWithin(root: string, key: string): string {
  const full = path.resolve(root, key);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing a storage key that escapes the storage root");
  }
  return full;
}

class LocalDiskStorage implements FileStorage {
  readonly name = "local-disk";

  async put(key: string, bytes: Buffer): Promise<StoredObject> {
    const full = resolveWithin(rootDir(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return {
      storageKey: key,
      sizeBytes: bytes.byteLength,
      // Stored so a later read can prove the bytes are the ones written.
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(resolveWithin(rootDir(), key));
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(resolveWithin(rootDir(), key), { force: true });
  }
}

const local: FileStorage = new LocalDiskStorage();

export function getFileStorage(): FileStorage {
  return local;
}

export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
