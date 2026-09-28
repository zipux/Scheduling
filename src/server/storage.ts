import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * File storage behind an interface (§9): local disk in development, any
 * S3-compatible bucket in production (S3_BUCKET + credentials). Keys are
 * generated server-side; callers never choose paths.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

class LocalStorage implements FileStorage {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Bad key");
    return path.join(this.dir, key);
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes);
    await writeFile(`${f}.meta.json`, JSON.stringify({ contentType }));
  }
  async get(key: string) {
    try {
      const f = this.file(key);
      const [bytes, meta] = await Promise.all([readFile(f), readFile(`${f}.meta.json`, "utf8")]);
      return { bytes: new Uint8Array(bytes), contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch {
      return null;
    }
  }
}

class S3Storage implements FileStorage {
  private client: AwsClient;
  constructor(
    private endpoint: string,
    private bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  }
  private url(key: string) {
    return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: bytes as BodyInit, headers: { "Content-Type": contentType } });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
  }
  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
}

let storage: FileStorage | null = null;

export function fileStorage(): FileStorage {
  if (storage) return storage;
  const { S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = process.env;
  storage =
    S3_BUCKET && S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? new S3Storage(S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION ?? "auto")
      : new LocalStorage(process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".dev-uploads"));
  return storage;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Identifies an image by its magic bytes — never trusts the client's declared type. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
