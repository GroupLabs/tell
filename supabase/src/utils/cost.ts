export type ModelPrice = {
  inputPerM: number;        // USD per 1M input tokens
  outputPerM: number;       // USD per 1M output tokens
  cachedInputPerM?: number; // optional: cached input rate
};

const PRICES: Record<string, ModelPrice> = {
  "gpt-5-mini":      { inputPerM: 0.25, outputPerM: 2.0,  cachedInputPerM: 0.025 },
  "gpt-5-thinking":  { inputPerM: 1.25, outputPerM: 10.0, cachedInputPerM: 0.125 },
  // add more models as needed
};

export function computeCostUSD(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
}): number {
  const price = PRICES[args.model] ?? PRICES["gpt-5-mini"];
  const cached = Math.max(0, args.cachedPromptTokens ?? 0);
  const uncached = Math.max(0, args.promptTokens - cached);

  const inputUSD  = (uncached / 1_000_000) * price.inputPerM;
  const cachedUSD = price.cachedInputPerM ? (cached / 1_000_000) * price.cachedInputPerM : 0;
  const outputUSD = (args.completionTokens / 1_000_000) * price.outputPerM;

  // round to 6 decimals (micro-dollars)
  return Math.round((inputUSD + cachedUSD + outputUSD) * 1e6) / 1e6;
}
