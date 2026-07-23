/**
 * Minimal Cloudflare runtime declarations used by this application.
 *
 * Sites injects these bindings in production. Keeping the declarations local
 * makes the application type-check without coupling the source to a generated
 * Wrangler configuration file.
 */
interface Fetcher {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changes: number;
    [key: string]: unknown;
  };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<D1Result>;
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: {
    contentType?: string;
  };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}

interface CloudflareImagesBinding {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: {
        format: string;
        quality?: number;
      }): Promise<{ response(): Response }>;
    };
  };
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    UPLOADS?: R2Bucket;
    IMAGES?: CloudflareImagesBinding;
    [key: string]: unknown;
  };
}
