import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Operation, Workspace } from "./types";
import { applyOperation, decodeWorkspace, emptyWorkspace, WorkspaceError } from "./workspace";

const BLOB_PATH = "team-desk/workspace-v1.json";

export interface WorkspaceSnapshot { state: Workspace; version: string | null }
export interface WorkspaceStore {
  read(): Promise<WorkspaceSnapshot>;
  // Return false only for a conditional-write conflict.
  write(state: Workspace, version: string | null): Promise<boolean>;
}

const blobStore: WorkspaceStore = {
  async read() {
    const result = await get(BLOB_PATH, {
      access: "private", useCache: false,
      // Compression can weaken the response ETag, which cannot be used for
      // conditional writes. Read the original representation and its exact tag.
      headers: { "accept-encoding": "identity" },
    });
    if (!result) return { state: emptyWorkspace(), version: null };
    if (result.statusCode !== 200) throw new WorkspaceError("Storage did not return the latest workspace. Please try again.", 503, "STORAGE_UNAVAILABLE");
    if (!result.blob.etag || /^W\//i.test(result.blob.etag)) {
      await result.stream.cancel();
      throw new WorkspaceError("Storage could not verify the latest workspace version. Please try again.", 503, "STORAGE_VERSION_UNAVAILABLE");
    }
    const state = decodeWorkspace(await new Response(result.stream).json());
    return { state, version: result.blob.etag };
  },
  async write(state, version) {
    try {
      await put(BLOB_PATH, JSON.stringify(state), {
        access: "private", contentType: "application/json", addRandomSuffix: false,
        allowOverwrite: version !== null,
        ...(version !== null ? { ifMatch: version } : {}),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      // The SDK reports an already-existing pathname as BlobError on an initial
      // create race. A subsequent fresh read safely retries the semantic action.
      if (version === null && error instanceof Error && /already exists/i.test(error.message)) return false;
      throw error;
    }
  },
};

function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function localFile() {
  if (process.env.VERCEL || (!process.env.LOCAL_DATA_PATH && process.env.NODE_ENV !== "development")) {
    throw new WorkspaceError("Shared storage is not connected yet. Please contact the workspace owner.", 503, "STORAGE_NOT_CONFIGURED");
  }
  // This is runtime-only development data, never an asset for the deployment.
  return path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_DATA_PATH || path.join(process.cwd(), ".data", "workspace.json"));
}

async function readLocal(file: string): Promise<Workspace> {
  try {
    return decodeWorkspace(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkspace();
    throw error;
  }
}

let localQueue: Promise<unknown> = Promise.resolve();

async function updateLocal(operation: Operation): Promise<Workspace> {
  const file = localFile();
  const update = localQueue.catch(() => undefined).then(async () => {
    const state = await readLocal(file);
    const next = applyOperation(state, operation);
    if (next === state) return state;
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", flag: "wx" });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    return next;
  });
  localQueue = update;
  return update;
}

export async function commitOperation(operation: Operation, store: WorkspaceStore): Promise<Workspace> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, version } = await store.read();
    const next = applyOperation(state, operation);
    if (next === state || await store.write(next, version)) return next;
    await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
  }
  throw new WorkspaceError("The workspace is busy. Please try saving again.", 409, "WORKSPACE_BUSY");
}

export async function readWorkspace(): Promise<Workspace> {
  if (isBlobConfigured()) return (await blobStore.read()).state;
  // Keep this guard at the call site: Next replaces NODE_ENV at build time,
  // removing the development-only filesystem implementation from production.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new WorkspaceError("Shared storage is not connected yet. Please contact the workspace owner.", 503, "STORAGE_NOT_CONFIGURED");
  }
  return readLocal(localFile());
}

export async function updateWorkspace(operation: Operation): Promise<Workspace> {
  if (isBlobConfigured()) return commitOperation(operation, blobStore);
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new WorkspaceError("Shared storage is not connected yet. Please contact the workspace owner.", 503, "STORAGE_NOT_CONFIGURED");
  }
  return updateLocal(operation);
}
