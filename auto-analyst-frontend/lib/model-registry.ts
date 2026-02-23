/**
 * Model Registry for the Auto-Analyst frontend
 * This file serves as the single source of truth for all model information on the frontend
 */

// Model providers
export const PROVIDERS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "GROQ",
  gemini: "Google Gemini"
};

// Cost per 1K tokens for different models
export const MODEL_COSTS = {
  openai: {
    "o1": { input: 0.015, output: 0.06 },  
    "o1-pro": { input: 0.015, output: 0.6 },
    "o1-mini": { input: 0.00011, output: 0.00044 }, 
    "o3": { input: 0.002, output: 0.008 },
    "o3-mini": { input: 0.00011, output: 0.00044 },
    "gpt-5": { input: 0.00125, output: 0.01 },         // real cost
    "gpt-5-mini": { input: 0.00025, output: 0.002 },   // real cost
    "gpt-5-nano": { input: 0.00005, output: 0.0004 },   // real cost
    "gpt-5.2": { input: 0.00125, output: 0.01 },
    "gpt-5.2-pro": { input: 0.002, output: 0.015 },
    "gpt-5.2-chat-latest": { input: 0.0005, output: 0.002 }
  },
  anthropic: {
    "claude-3-opus-latest": { input: 0.015, output: 0.075 },  
    "claude-3-5-sonnet-latest": { input: 0.003, output: 0.015 }, 
    "claude-3-5-haiku-latest": { input: 0.0008, output: 0.0004 },
    "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
    "claude-sonnet-4-5-20250929": { input: 0.003, output: 0.015 },
    "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
    "claude-opus-4-1-20250805": { input: 0.015, output: 0.075 },
    "claude-opus-4-5-20251101": { input: 0.015, output: 0.075 }
  },
  groq: {
    "deepseek-r1-distill-llama-70b": { input: 0.00075, output: 0.00099 },
    "gpt-oss-120B": { input: 0.00075, output: 0.00099 },
    "gpt-oss-20B": { input: 0.00075, output: 0.00099 }
  },
  gemini: {
    "gemini-2.5-pro-preview-03-25": { input: 0.00015, output: 0.001 },
    "gemini-3-pro": { input: 0.0002, output: 0.001 },
    "gemini-3-flash": { input: 0.0001, output: 0.0005 }
  }
};

// Models by tier
export const MODEL_TIERS = {
  tier1: {
    name: "Basic",
    credits: 1,
    models: [
      "claude-3-5-haiku-latest",
      "gpt-oss-20B"
    ]
  },
  tier2: {
    name: "Standard",
    credits: 3,
    models: [
      "o1-mini",
      "o3-mini",
      "gpt-5-nano"  // added
    ]
  },
  tier3: {
    name: "Premium",
    credits: 5,
    models: [
      "o3",
      "claude-3-5-sonnet-latest",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5-20250929",
      "deepseek-r1-distill-llama-70b",
      "gpt-oss-120B",
      "gemini-2.5-pro-preview-03-25",
      "gemini-3-flash",
      "gpt-5-mini",
      "gpt-5.2-chat-latest"
    ]
  },
  tier4: {
    name: "Premium Plus",
    credits: 20,
    models: [
      "gpt-4.5-preview",
      "o1",
      "o1-pro",
      "claude-3-opus-latest",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250929",
      "gpt-5",
      "gpt-5.2",
      "gemini-3-pro"
    ]
  },
  tier5: {
    name: "Ultimate",
    credits: 50,
    models: [
      "gpt-5.2-pro",
      "claude-opus-4-5-20251101"
    ]
  }
};

// Tier colors for UI components
export const TIER_COLORS = {
  tier1: "#10B981", // Green for Basic tier
  tier2: "#3B82F6", // Blue for Standard tier
  tier3: "#8B5CF6", // Purple for Premium tier
  tier4: "#F59E0B",  // Orange for Premium Plus tier
  tier5: "#EF4444"  // Red for Ultimate tier
};

// Model metadata (display name, context window, etc.)
export const MODEL_METADATA: Record<string, { displayName: string; contextWindow: number }> = {
  // OpenAI
  "o1": { displayName: "o1", contextWindow: 128000 },
  "o1-pro": { displayName: "o1 Pro", contextWindow: 128000 },
  "o1-mini": { displayName: "o1 Mini", contextWindow: 128000 },
  "o3": { displayName: "o3", contextWindow: 128000 },
  "o3-mini": { displayName: "o3 Mini", contextWindow: 128000 },
  "gpt-5": { displayName: "GPT-5", contextWindow: 400000 },
  "gpt-5-mini": { displayName: "GPT-5 Mini", contextWindow: 150000 },
  "gpt-5-nano": { displayName: "GPT-5 Nano", contextWindow: 64000 },
  "gpt-5.2": { displayName: "GPT-5.2", contextWindow: 400000 },
  "gpt-5.2-pro": { displayName: "GPT-5.2 Pro", contextWindow: 400000 },
  "gpt-5.2-chat-latest": { displayName: "GPT-5.2 Chat", contextWindow: 400000 },

  // Anthropic
  "claude-3-opus-latest": { displayName: "Claude 3 Opus", contextWindow: 200000 },
  "claude-3-5-sonnet-latest": { displayName: "Claude 3.5 Sonnet", contextWindow: 200000 },
  "claude-3-5-haiku-latest": { displayName: "Claude 3.5 Haiku", contextWindow: 200000 },
  "claude-sonnet-4-20250514": { displayName: "Claude Sonnet 4", contextWindow: 200000 },
  "claude-sonnet-4-5-20250929": { displayName: "Claude Sonnet 4.5", contextWindow: 200000 },
  "claude-opus-4-20250514": { displayName: "Claude Opus 4", contextWindow: 200000 },
  "claude-opus-4-1-20250805": { displayName: "Claude Opus 4.1", contextWindow: 200000 },
  "claude-opus-4-5-20251101": { displayName: "Claude Opus 4.5", contextWindow: 200000 },

  // GROQ
  "deepseek-r1-distill-llama-70b": { displayName: "DeepSeek R1 Distill Llama 70b", contextWindow: 32768 },
  "gpt-oss-120B": { displayName: "OpenAI gpt oss 120B", contextWindow: 128000 },
  "gpt-oss-20B": { displayName: "OpenAI gpt oss 20B", contextWindow: 128000 },

  // Gemini
  "gemini-2.5-pro-preview-03-25": { displayName: "Gemini 2.5 Pro", contextWindow: 1000000 },
  "gemini-3-pro": { displayName: "Gemini 3 Pro", contextWindow: 1000000 },
  "gemini-3-flash": { displayName: "Gemini 3 Flash", contextWindow: 1000000 }
};

// Type definitions to improve type safety
type Provider = keyof typeof PROVIDERS;
type OpenAIModels = keyof typeof MODEL_COSTS.openai;
type AnthropicModels = keyof typeof MODEL_COSTS.anthropic;
type GroqModels = keyof typeof MODEL_COSTS.groq;
type GeminiModels = keyof typeof MODEL_COSTS.gemini;
type ModelName = OpenAIModels | AnthropicModels | GroqModels | GeminiModels;
type TierId = keyof typeof MODEL_TIERS;

// Model configurations for UI
export const MODEL_PROVIDERS_UI = [
  {
    name: 'openai',
    models: Object.keys(MODEL_COSTS.openai).map(id => ({
      id,
      name: MODEL_METADATA[id]?.displayName || id
    })),
    displayName: PROVIDERS.openai
  },
  {
    name: 'anthropic',
    models: Object.keys(MODEL_COSTS.anthropic).map(id => ({
      id,
      name: MODEL_METADATA[id]?.displayName || id
    })),
    displayName: PROVIDERS.anthropic
  },
  {
    name: 'groq',
    models: Object.keys(MODEL_COSTS.groq).map(id => ({
      id,
      name: MODEL_METADATA[id]?.displayName || id
    })),
    displayName: PROVIDERS.groq
  },
  {
    name: 'gemini',
    models: Object.keys(MODEL_COSTS.gemini).map(id => ({
      id, 
      name: MODEL_METADATA[id]?.displayName || id
    })),
    displayName: PROVIDERS.gemini
  }
];

// Helper functions

/**
 * Get the provider for a given model
 */
export function getProviderForModel(modelName: string): Provider | "Unknown" {
  if (!modelName) {
    return "Unknown";
  }
  
  modelName = modelName.toLowerCase();
  
  for (const [provider, models] of Object.entries(MODEL_COSTS)) {
    if (Object.keys(models).some(model => model.includes(modelName))) {
      return provider as Provider;
    }
  }
  
  return "Unknown";
}

/**
 * Get the tier for a given model
 */
export function getModelTier(modelName: string): TierId {
  for (const [tierId, tierInfo] of Object.entries(MODEL_TIERS)) {
    if (tierInfo.models.includes(modelName)) {
      return tierId as TierId;
    }
  }
  return "tier1"; // Default to tier1 if not found
}

/**
 * Calculate cost for using a model based on tokens
 */
export function calculateCost(modelName: string, inputTokens: number, outputTokens: number): number {
  if (!modelName) {
    return 0;
  }
  
  // Convert tokens to thousands
  const inputTokensInThousands = inputTokens / 1000;
  const outputTokensInThousands = outputTokens / 1000;
  
  // Get model provider
  const modelProvider = getProviderForModel(modelName);
  
  // Handle case where model is not found
  if (modelProvider === "Unknown") {
    return 0;
  }
  
  const providerCosts = MODEL_COSTS[modelProvider as Provider];
  if (!providerCosts) {
    return 0;
  }
  
  // Safe type checking
  if (!(modelName in providerCosts)) {
    return 0;
  }
  
  // Type assertion for TypeScript
  const costs = providerCosts as Record<string, { input: number; output: number }>;
  
  return (
    inputTokensInThousands * costs[modelName].input +
    outputTokensInThousands * costs[modelName].output
  );
}

/**
 * Get the credit cost for a model
 */
export function getModelCreditCost(modelName: string): number {
  const tierId = getModelTier(modelName);
  return MODEL_TIERS[tierId].credits;
}

/**
 * Get the display name for a model
 */
export function getDisplayName(modelName: string): string {
  return MODEL_METADATA[modelName]?.displayName || modelName;
}

/**
 * Get the context window size for a model
 */
export function getContextWindow(modelName: string): number {
  return MODEL_METADATA[modelName]?.contextWindow || 4096;
}

/**
 * Get all models for a specific provider
 */
export function getAllModelsForProvider(provider: string): string[] {
  const providerCosts = MODEL_COSTS[provider as Provider];
  if (!providerCosts) {
    return [];
  }
  return Object.keys(providerCosts);
}

/**
 * Get all models for a specific tier
 */
export function getModelsByTier(tierId: string): string[] {
  return MODEL_TIERS[tierId as TierId]?.models || [];
}
