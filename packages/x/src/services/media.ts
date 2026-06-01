// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";

const UPLOAD_URL = "https://upload.twitter.com/i/media/upload.json";
const CHUNK_SIZE = 1024 * 1024; // 1 MiB chunk size
const MAX_PROCESSING_WAIT_SECS = 120;

interface MediaKind {
  mime: string;
  category: string;
}

function detectMediaKind(path: string): MediaKind {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return { mime: "image/jpeg", category: "tweet_image" };
    case "png":
      return { mime: "image/png", category: "tweet_image" };
    case "webp":
      return { mime: "image/webp", category: "tweet_image" };
    case "gif":
      return { mime: "image/gif", category: "tweet_gif" };
    case "mp4":
      return { mime: "video/mp4", category: "tweet_video" };
    case "mov":
      return { mime: "video/quicktime", category: "tweet_video" };
    default:
      throw new Error(
        `Unsupported media extension: ${ext} (allowed: jpg, jpeg, png, webp, gif, mp4, mov)`
      );
  }
}

/** Upload a local media file and return its media_id string. */
export async function uploadMedia(client: XClient, filePath: string, alt?: string): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Media file not found: ${filePath}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length === 0) {
    throw new Error(`Media file is empty: ${filePath}`);
  }

  const kind = detectMediaKind(filePath);
  const mediaId = await mediaInit(client, bytes.length, kind);

  // APPEND chunks
  let segmentIndex = 0;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    await mediaAppend(client, mediaId, segmentIndex, chunk, kind.mime);
    segmentIndex++;
  }

  const finalizeJson = await mediaFinalize(client, mediaId);
  await awaitProcessing(client, mediaId, finalizeJson);

  if (alt) {
    await mediaMetadata(client, mediaId, alt);
  }

  return mediaId;
}

async function mediaInit(client: XClient, totalBytes: number, kind: MediaKind): Promise<string> {
  const form = new URLSearchParams();
  form.append("command", "INIT");
  form.append("total_bytes", totalBytes.toString());
  form.append("media_type", kind.mime);
  form.append("media_category", kind.category);

  const res = await client.request(UPLOAD_URL, {
    method: "POST",
    body: form.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const json = await res.json();
  checkErrors(json, res.status);
  const mediaId = json.media_id_string || (json.media_id ? String(json.media_id) : "");
  if (!mediaId) {
    throw new Error("media INIT response missing media_id_string");
  }
  return mediaId;
}

async function mediaAppend(
  client: XClient,
  mediaId: string,
  segmentIndex: number,
  chunk: Uint8Array,
  mime: string
): Promise<void> {
  const form = new FormData();
  form.append("command", "APPEND");
  form.append("media_id", mediaId);
  form.append("segment_index", segmentIndex.toString());
  
  // Create file Blob for multi-part append
  const blob = new Blob([chunk as any], { type: mime });
  form.append("media", blob, "media");

  const res = await client.request(UPLOAD_URL, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`media APPEND failed: HTTP ${res.status} ${text.substring(0, 160)}`);
  }
}

async function mediaFinalize(client: XClient, mediaId: string): Promise<any> {
  const form = new URLSearchParams();
  form.append("command", "FINALIZE");
  form.append("media_id", mediaId);

  const res = await client.request(UPLOAD_URL, {
    method: "POST",
    body: form.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const json = await res.json();
  checkErrors(json, res.status);
  return json;
}

async function awaitProcessing(client: XClient, mediaId: string, finalizeJson: any): Promise<void> {
  let pi = finalizeJson.processing_info;
  let waited = 0;

  while (pi) {
    const state = pi.state;
    if (state === "succeeded") {
      return;
    }
    if (state === "failed") {
      const msg = pi.error?.message || "media processing failed";
      throw new Error(`Media processing error: ${msg}`);
    }

    const checkAfter = Math.min(Math.max(pi.check_after_secs || 1, 1), 10);
    if (waited + checkAfter > MAX_PROCESSING_WAIT_SECS) {
      throw new Error(`Media processing timed out after ${waited}s`);
    }

    await new Promise((resolve) => setTimeout(resolve, checkAfter * 1000));
    waited += checkAfter;

    // Check status
    const url = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;
    const res = await client.request(url, { method: "GET" });
    const json = await res.json();
    checkErrors(json, res.status);
    pi = json.processing_info;
  }
}

async function mediaMetadata(client: XClient, mediaId: string, altText: string): Promise<void> {
  const url = "https://x.com/i/api/1.1/media/metadata/create.json";
  const body = {
    media_id: mediaId,
    alt_text: { text: altText },
  };

  const res = await client.request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`media metadata failed: HTTP ${res.status} ${text.substring(0, 160)}`);
  }
}

function checkErrors(json: any, status: number): void {
  if (json?.errors && json.errors.length > 0) {
    const first = json.errors[0];
    throw new Error(`X API error ${first.code}: ${first.message}`);
  }
  if (status >= 400) {
    throw new Error(`HTTP ${status} from media upload`);
  }
}
