import { timestamp, type Timestamp } from "@virtual/domain";
import { z } from "zod";

const READ_ONLY_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
  "eth_getBalance",
] as const;
export const ReadOnlyRpcMethodSchema = z.enum(READ_ONLY_METHODS);
export type ReadOnlyRpcMethod = z.infer<typeof ReadOnlyRpcMethodSchema>;

const rpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.number().int(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number().int(), message: z.string() }).passthrough().optional(),
  })
  .passthrough();

export interface ChainTransportAdapter {
  readonly adapterId: string;
  call(method: ReadOnlyRpcMethod, params: unknown[]): Promise<unknown>;
  batchCall?(
    calls: ReadonlyArray<{ method: ReadOnlyRpcMethod; params: unknown[] }>,
  ): Promise<unknown[]>;
  health(): Promise<{
    chainId: string;
    latestBlock: string;
    latencyMs: number;
    observedAt: Timestamp;
  }>;
}

function sanitizedEndpoint(endpoint: URL): string {
  return `${endpoint.protocol}//${endpoint.host}${endpoint.pathname}`;
}

function retryableRpcError(error: { code: number; message: string }): boolean {
  return (
    [-32016, -32005].includes(error.code) ||
    /rate limit|busy|temporarily unavailable/i.test(error.message)
  );
}

export class ReadOnlyJsonRpcTransport implements ChainTransportAdapter {
  readonly adapterId: string;
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #maximumAttempts: number;
  readonly #minimumRetryDelayMs: number;
  readonly #maximumBatchSize: number;
  #requestId = 0;
  #requestTail: Promise<void> = Promise.resolve();

  constructor(input: {
    adapterId: string;
    endpoint: string;
    fetchImplementation?: typeof fetch;
    maximumAttempts?: number;
    minimumRetryDelayMs?: number;
    maximumBatchSize?: number;
  }) {
    this.adapterId = input.adapterId;
    this.#endpoint = new URL(input.endpoint);
    if (!(["http:", "https:"] as const).includes(this.#endpoint.protocol as never)) {
      throw new Error("RPC endpoint must use HTTP or HTTPS");
    }
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#maximumAttempts = input.maximumAttempts ?? 3;
    this.#minimumRetryDelayMs = input.minimumRetryDelayMs ?? 250;
    this.#maximumBatchSize = input.maximumBatchSize ?? 5;
    if (!Number.isInteger(this.#maximumAttempts) || this.#maximumAttempts < 1) {
      throw new RangeError("maximumAttempts must be a positive integer");
    }
    if (!Number.isFinite(this.#minimumRetryDelayMs) || this.#minimumRetryDelayMs < 0) {
      throw new RangeError("minimumRetryDelayMs must be non-negative");
    }
    if (!Number.isInteger(this.#maximumBatchSize) || this.#maximumBatchSize < 1) {
      throw new RangeError("maximumBatchSize must be a positive integer");
    }
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.#requestTail;
    this.#requestTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  #retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);
    }
    return Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000);
  }

  async #wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  async #callOnce(
    safeMethod: ReadOnlyRpcMethod,
    params: unknown[],
    requestId: number,
    attempt: number,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method: safeMethod, params }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (attempt + 1 < this.#maximumAttempts) {
        await this.#wait(Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000));
        return this.#callOnce(safeMethod, params, requestId, attempt + 1);
      }
      throw new Error(
        `Read-only RPC transport failed at ${sanitizedEndpoint(this.#endpoint)}: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }
    if (!response.ok) {
      if ([429, 502, 503, 504].includes(response.status) && attempt + 1 < this.#maximumAttempts) {
        await this.#wait(this.#retryDelay(response, attempt));
        return this.#callOnce(safeMethod, params, requestId, attempt + 1);
      }
      throw new Error(`Read-only RPC returned HTTP ${response.status}`);
    }
    const payload = rpcResponseSchema.parse(await response.json());
    if (payload.error !== undefined) {
      if (retryableRpcError(payload.error) && attempt + 1 < this.#maximumAttempts) {
        await this.#wait(Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000));
        return this.#callOnce(safeMethod, params, requestId, attempt + 1);
      }
      throw new Error(`Read-only RPC error ${payload.error.code}: ${payload.error.message}`);
    }
    if (!("result" in payload)) throw new Error("Read-only RPC response has no result");
    return payload.result;
  }

  async #batchOnce(
    calls: ReadonlyArray<{ method: ReadOnlyRpcMethod; params: unknown[]; id: number }>,
    attempt: number,
  ): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          calls.map(({ id, method, params }) => ({ jsonrpc: "2.0", id, method, params })),
        ),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (attempt + 1 < this.#maximumAttempts) {
        await this.#wait(Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000));
        return this.#batchOnce(calls, attempt + 1);
      }
      throw new Error(
        `Read-only RPC batch transport failed at ${sanitizedEndpoint(this.#endpoint)}: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }
    if (!response.ok) {
      if ([429, 502, 503, 504].includes(response.status) && attempt + 1 < this.#maximumAttempts) {
        await this.#wait(this.#retryDelay(response, attempt));
        return this.#batchOnce(calls, attempt + 1);
      }
      throw new Error(`Read-only RPC batch returned HTTP ${response.status}`);
    }
    const rawPayloads: unknown = await response.json();
    if (!Array.isArray(rawPayloads)) {
      const envelope = z
        .object({ error: z.object({ code: z.number().int(), message: z.string() }) })
        .safeParse(rawPayloads);
      if (envelope.success) {
        if (retryableRpcError(envelope.data.error) && attempt + 1 < this.#maximumAttempts) {
          await this.#wait(Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000));
          return this.#batchOnce(calls, attempt + 1);
        }
        throw new Error(
          `Read-only RPC batch error ${envelope.data.error.code}: ${envelope.data.error.message}`,
        );
      }
    }
    const payloads = z.array(rpcResponseSchema).parse(rawPayloads);
    const retryableError = payloads.find(
      (payload) => payload.error !== undefined && retryableRpcError(payload.error),
    )?.error;
    if (retryableError !== undefined && attempt + 1 < this.#maximumAttempts) {
      await this.#wait(Math.min(this.#minimumRetryDelayMs * 2 ** attempt, 2_000));
      return this.#batchOnce(calls, attempt + 1);
    }
    const byId = new Map(payloads.map((payload) => [payload.id, payload]));
    return calls.map(({ id }) => {
      const payload = byId.get(id);
      if (payload === undefined) throw new Error(`Read-only RPC batch omitted response ${id}`);
      if (payload.error !== undefined) {
        throw new Error(
          `Read-only RPC batch error ${payload.error.code}: ${payload.error.message}`,
        );
      }
      if (!("result" in payload))
        throw new Error(`Read-only RPC batch response ${id} has no result`);
      return payload.result;
    });
  }

  async call(method: ReadOnlyRpcMethod, params: unknown[]): Promise<unknown> {
    const safeMethod = ReadOnlyRpcMethodSchema.parse(method);
    this.#requestId += 1;
    const requestId = this.#requestId;
    return this.#serialized(() => this.#callOnce(safeMethod, params, requestId, 0));
  }

  async batchCall(
    calls: ReadonlyArray<{ method: ReadOnlyRpcMethod; params: unknown[] }>,
  ): Promise<unknown[]> {
    if (calls.length === 0 || calls.length > 50) {
      throw new RangeError("Read-only RPC batch size must be between 1 and 50");
    }
    const validated = calls.map(({ method, params }) => {
      this.#requestId += 1;
      return { method: ReadOnlyRpcMethodSchema.parse(method), params, id: this.#requestId };
    });
    return this.#serialized(async () => {
      const results: unknown[] = [];
      for (let offset = 0; offset < validated.length; offset += this.#maximumBatchSize) {
        results.push(
          ...(await this.#batchOnce(validated.slice(offset, offset + this.#maximumBatchSize), 0)),
        );
        if (offset + this.#maximumBatchSize < validated.length) {
          await this.#wait(this.#minimumRetryDelayMs);
        }
      }
      return results;
    });
  }

  async health(): Promise<{
    chainId: string;
    latestBlock: string;
    latencyMs: number;
    observedAt: Timestamp;
  }> {
    const start = performance.now();
    const [chainIdHex, latestBlockHex] = await this.batchCall([
      { method: "eth_chainId", params: [] },
      { method: "eth_blockNumber", params: [] },
    ]);
    if (typeof chainIdHex !== "string" || typeof latestBlockHex !== "string") {
      throw new TypeError("RPC health response is not hexadecimal text");
    }
    return {
      chainId: BigInt(chainIdHex).toString(),
      latestBlock: BigInt(latestBlockHex).toString(),
      latencyMs: performance.now() - start,
      observedAt: timestamp(new Date()),
    };
  }
}

export function assertReadOnlyRpcMethod(method: string): ReadOnlyRpcMethod {
  return ReadOnlyRpcMethodSchema.parse(method);
}
