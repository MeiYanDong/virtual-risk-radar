import { z } from "zod";
import { DecimalStringSchema } from "./decimal";
import { knowledgeSchema } from "./knowledge";

export const ChainProfileSchema = z
  .object({
    chainProfileId: z.string().min(1),
    networkScope: z.string().min(1),
    chainId: knowledgeSchema(z.string().regex(/^\d+$/)),
    virtualTokenAddress: knowledgeSchema(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
    settlementAssetAddress: knowledgeSchema(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
    virtualDecimals: knowledgeSchema(z.number().int().min(0).max(255)),
    virtualSymbol: knowledgeSchema(z.string().min(1)),
    routeIds: knowledgeSchema(z.array(z.string().min(1))),
    version: z.string().min(1),
  })
  .strict();
export type ChainProfile = z.infer<typeof ChainProfileSchema>;

export const WalletProfileSchema = z
  .object({
    walletProfileId: z.string().min(1),
    chainProfileId: z.string().min(1),
    publicAddress: knowledgeSchema(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
    virtualBalance: knowledgeSchema(DecimalStringSchema),
    settlementBalance: knowledgeSchema(DecimalStringSchema),
    tacticalSleevePct: knowledgeSchema(DecimalStringSchema),
  })
  .strict();
export type WalletProfile = z.infer<typeof WalletProfileSchema>;
