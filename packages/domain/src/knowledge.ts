import { z } from "zod";

export const TimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), {
    message: "Timestamps must be canonical UTC and end in Z",
  })
  .brand<"Timestamp">();

export type Timestamp = z.infer<typeof TimestampSchema>;

export type Known<T> = {
  state: "KNOWN";
  value: T;
  observedAt: Timestamp;
  expiresAt?: Timestamp | undefined;
  evidenceIds: string[];
};

export type Unknown = {
  state: "UNKNOWN";
  reason: string;
  since: Timestamp;
  lastCheckedAt?: Timestamp | undefined;
  retryAfter?: Timestamp | undefined;
};

export type Unsupported = {
  state: "UNSUPPORTED";
  reason: string;
};

export type KnowledgeError = {
  state: "ERROR";
  reason: string;
  observedAt: Timestamp;
  retryable: boolean;
};

export type Knowledge<T> = Known<T> | Unknown | Unsupported | KnowledgeError;

export function knowledgeSchema<TSchema extends z.ZodType>(valueSchema: TSchema) {
  const known = z
    .object({
      state: z.literal("KNOWN"),
      value: valueSchema,
      observedAt: TimestampSchema,
      expiresAt: TimestampSchema.optional(),
      evidenceIds: z.array(z.string().min(1)),
    })
    .strict();
  const unknown = z
    .object({
      state: z.literal("UNKNOWN"),
      reason: z.string().min(1),
      since: TimestampSchema,
      lastCheckedAt: TimestampSchema.optional(),
      retryAfter: TimestampSchema.optional(),
    })
    .strict();
  const unsupported = z
    .object({
      state: z.literal("UNSUPPORTED"),
      reason: z.string().min(1),
    })
    .strict();
  const error = z
    .object({
      state: z.literal("ERROR"),
      reason: z.string().min(1),
      observedAt: TimestampSchema,
      retryable: z.boolean(),
    })
    .strict();

  return z.discriminatedUnion("state", [known, unknown, unsupported, error]);
}

export function timestamp(value: string | Date): Timestamp {
  const rendered = value instanceof Date ? value.toISOString() : value;
  return TimestampSchema.parse(rendered);
}

export function known<T>(
  value: T,
  observedAt: Timestamp,
  evidenceIds: string[],
  expiresAt?: Timestamp,
): Known<T> {
  return {
    state: "KNOWN",
    value,
    observedAt,
    evidenceIds,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export function unknown(reason: string, since: Timestamp): Unknown {
  return { state: "UNKNOWN", reason, since };
}

export function unsupported(reason: string): Unsupported {
  return { state: "UNSUPPORTED", reason };
}

export function knowledgeError(
  reason: string,
  observedAt: Timestamp,
  retryable: boolean,
): KnowledgeError {
  return { state: "ERROR", reason, observedAt, retryable };
}

export function isKnown<T>(knowledge: Knowledge<T>): knowledge is Known<T> {
  return knowledge.state === "KNOWN";
}

export function isFreshAt<T>(knowledge: Knowledge<T>, at: Timestamp): boolean {
  if (!isKnown(knowledge)) return false;
  if (knowledge.expiresAt === undefined) return true;
  return Date.parse(knowledge.expiresAt) >= Date.parse(at);
}

export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
