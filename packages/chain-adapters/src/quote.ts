import {
  knowledgeError,
  unsupported,
  type ChainQuote,
  type Knowledge,
  type Timestamp,
} from "@virtual/domain";

export type QuoteRequest = {
  chainProfileId: string;
  side: ChainQuote["side"];
  amountIn: string;
  requestedAt: Timestamp;
};

export interface QuoteAdapter {
  readonly adapterId: string;
  readonly chainProfileId: string;
  quote(request: QuoteRequest): Promise<Knowledge<ChainQuote>>;
}

export class UnsupportedQuoteAdapter implements QuoteAdapter {
  constructor(
    readonly adapterId: string,
    readonly chainProfileId: string,
    readonly reason: string,
  ) {}

  async quote(_request: QuoteRequest): Promise<Knowledge<ChainQuote>> {
    return unsupported(this.reason);
  }
}

export async function quoteIsolated(
  adapters: QuoteAdapter[],
  requestByChain: ReadonlyMap<string, QuoteRequest>,
  timeoutMs = 3_000,
): Promise<Map<string, Knowledge<ChainQuote>>> {
  const entries = await Promise.all(
    adapters.map(async (adapter): Promise<readonly [string, Knowledge<ChainQuote>]> => {
      const request = requestByChain.get(adapter.chainProfileId);
      if (request === undefined) {
        return [adapter.chainProfileId, unsupported("No quote request for this chain")] as const;
      }
      try {
        const result = await Promise.race([
          adapter.quote(request),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("quote timeout")), timeoutMs);
          }),
        ]);
        return [adapter.chainProfileId, result] as const;
      } catch (error) {
        return [
          adapter.chainProfileId,
          knowledgeError(
            error instanceof Error ? error.message : "quote adapter failed",
            request.requestedAt,
            true,
          ),
        ] as const;
      }
    }),
  );
  return new Map(entries);
}
