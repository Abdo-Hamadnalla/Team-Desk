import { readWorkspace, updateWorkspace } from "../../../lib/storage";
import { parseOperation, WorkspaceError } from "../../../lib/workspace";
import type { Workspace } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 512 * 1024;

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  // Next can normalize a loopback URL to localhost. Host preserves the actual
  // browser address; on Vercel the platform's forwarded headers identify it.
  const host = (process.env.VERCEL ? request.headers.get("x-forwarded-host") : null) || request.headers.get("host") || url.host;
  const forwardedProtocol = process.env.VERCEL ? request.headers.get("x-forwarded-proto") : null;
  const protocol = forwardedProtocol ? `${forwardedProtocol}:` : url.protocol;
  try {
    if (!["http:", "https:"].includes(protocol) || /[\s,/@?#\\]/.test(host)) throw new Error("Invalid host");
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    throw new WorkspaceError("Open the workspace directly before making changes.", 403, "INVALID_ORIGIN");
  }
}

function workspaceResponse(state: Workspace) {
  // Stream in bounded chunks so retained meeting history can grow beyond the
  // platform's buffered response limit without making the workspace unreadable.
  const bytes = new TextEncoder().encode(JSON.stringify({ state }));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function failure(error: unknown) {
  if (error instanceof WorkspaceError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
  console.error("Workspace storage request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "The workspace could not be saved or loaded. Please try again.", code: "STORAGE_UNAVAILABLE" }, { status: 503, headers });
}

async function boundedJson(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new WorkspaceError("This update is too large.", 413, "REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("Action data is required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new WorkspaceError("This update is too large.", 413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkspaceError("Action data is not valid JSON.");
  }
}

export async function GET() {
  try {
    return workspaceResponse(await readWorkspace());
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== requestOrigin(request)) throw new WorkspaceError("Open the workspace directly before making changes.", 403, "INVALID_ORIGIN");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new WorkspaceError("Open the workspace directly before making changes.", 403, "INVALID_ORIGIN");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new WorkspaceError("Action data must be sent as JSON.", 415, "INVALID_CONTENT_TYPE");
    const operation = parseOperation(await boundedJson(request));
    return workspaceResponse(await updateWorkspace(operation));
  } catch (error) { return failure(error); }
}
