import Decimal from "decimal.js";
import {
  isFreshAt,
  type ChainExecutability,
  type ChainQuote,
  type DecisionMode,
  type Knowledge,
  type Timestamp,
} from "@virtual/domain";
import type { SystemConfig } from "@virtual/config";

export type ChainQuoteInput = {
  chainProfileId: string;
  quote: Knowledge<ChainQuote>;
};

export function evaluateChainExecutability(input: {
  quoteInput: ChainQuoteInput;
  expectedSide: ChainQuote["side"];
  signalReady: boolean;
  mode: DecisionMode;
  economicEvidence: "POSITIVE_EV_NOT_PROVEN" | "PASS" | "FAIL" | "UNKNOWN";
  quoteLimits: SystemConfig["quoteLimits"];
  now: Timestamp;
}): ChainExecutability {
  const { quoteInput } = input;
  if (!input.signalReady) {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "SIGNAL_NOT_READY",
      quote: quoteInput.quote,
      reason: "Market decision conditions are not ready",
      evidenceIds: [],
    };
  }

  if (quoteInput.quote.state === "UNSUPPORTED") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "UNSUPPORTED",
      quote: quoteInput.quote,
      reason: quoteInput.quote.reason,
      evidenceIds: [],
    };
  }
  if (quoteInput.quote.state === "ERROR") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_DATA",
      quote: quoteInput.quote,
      reason: quoteInput.quote.reason,
      evidenceIds: [],
    };
  }
  if (quoteInput.quote.state === "UNKNOWN") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "QUOTE_PENDING",
      quote: quoteInput.quote,
      reason: quoteInput.quote.reason,
      evidenceIds: [],
    };
  }

  const quote = quoteInput.quote.value;
  const evidenceIds = quote.evidenceIds;
  if (
    !isFreshAt(quoteInput.quote, input.now) ||
    Date.parse(quote.expiresAt) < Date.parse(input.now)
  ) {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_DATA",
      quote: quoteInput.quote,
      reason: "Quote is stale or expired",
      evidenceIds,
    };
  }
  if (quote.side !== input.expectedSide) {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_IDENTITY",
      quote: quoteInput.quote,
      reason: "Quote direction does not match the decision",
      evidenceIds,
    };
  }
  if (quote.identityState !== "PASS") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_IDENTITY",
      quote: quoteInput.quote,
      reason: "Chain, token, settlement, or pool identity is not proven",
      evidenceIds,
    };
  }
  if (quote.routeState !== "PASS") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_LIQUIDITY",
      quote: quoteInput.quote,
      reason: "No verified liquid route for the requested quantity",
      evidenceIds,
    };
  }
  if (quote.walletBalanceState !== "PASS") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_DATA",
      quote: quoteInput.quote,
      reason: "Public wallet inventory is unknown or insufficient",
      evidenceIds,
    };
  }
  if (quote.simulationState === "FAIL") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_LIQUIDITY",
      quote: quoteInput.quote,
      reason: "The exact quote route failed read-only simulation",
      evidenceIds,
    };
  }
  if (input.quoteLimits.state === "UNSET") {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_COST",
      quote: quoteInput.quote,
      reason: input.quoteLimits.reason,
      evidenceIds,
    };
  }
  if (
    new Decimal(quote.priceImpactBps).gt(input.quoteLimits.maximumPriceImpactBps) ||
    new Decimal(quote.totalCostPct).gt(input.quoteLimits.maximumRoundTripCostPct) ||
    new Decimal(quote.estimatedGas).gt(input.quoteLimits.maximumGasSettlement)
  ) {
    return {
      chainProfileId: quoteInput.chainProfileId,
      actionState: "BLOCKED_COST",
      quote: quoteInput.quote,
      reason: "Quote exceeds a configured price-impact, cost, or gas limit",
      evidenceIds,
    };
  }

  const actionable =
    input.mode === "LIVE_READ_ONLY" && input.economicEvidence === "PASS"
      ? "ACTIONABLE_WITH_EVIDENCE"
      : "SHADOW_CANDIDATE";
  return {
    chainProfileId: quoteInput.chainProfileId,
    actionState: actionable,
    quote: quoteInput.quote,
    reason:
      actionable === "ACTIONABLE_WITH_EVIDENCE"
        ? "Signal and read-only execution evidence pass"
        : "Execution evidence passes, but the system remains in replay/shadow or EV is unproven",
    evidenceIds,
  };
}
