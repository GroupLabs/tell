const openAiModels = {
  // O1 models
  'o1': {
    inputPrice: 0.000015,
    outputPrice: 0.00006,
    description: 'O1 - Latest OpenAI model'
  },
  'o1-mini': {
    inputPrice: 0.0000025,
    outputPrice: 0.0000075,
    description: 'O1 Mini - Smaller, cost-effective version of O1'
  },
  'o1-preview': {
    inputPrice: 0.000005,
    outputPrice: 0.000015,
    description: 'O1 Preview - Preview version of O1'
  },
  
  // O3 models
  'o3': {
    inputPrice: 0.000001,
    outputPrice: 0.000003,
    description: 'O3 - Standard performance model'
  },
  'o3-mini': {
    inputPrice: 0.0000005,
    outputPrice: 0.0000015,
    description: 'O3 Mini - Smaller, cost-effective version of O3'
  }
};

/**
 * Anthropic model pricing (as of September 2025)
 */
const anthropicModels = {
  // Claude Opus 4.1
  'claude-opus-4.1': {
    inputPrice: 0.00001,
    outputPrice: 0.00003,
    description: 'Claude Opus 4.1 - Latest Claude Opus model'
  },
  
  // Claude Opus 4.0
  'claude-opus-4.0': {
    inputPrice: 0.00001,
    outputPrice: 0.00003,
    description: 'Claude Opus 4.0 - Previous Claude Opus model'
  },
  
  // Claude Sonnet 4.0
  'claude-sonnet-4.0': {
    inputPrice: 0.000003,
    outputPrice: 0.000015,
    description: 'Claude Sonnet 4.0 - Balanced Claude model'
  }
};

/**
 * Combine all models into a single map
 */
const modelPricing = {
  ...openAiModels,
  ...anthropicModels
};

/**
 * Get pricing information for a specific model
 * 
 * @param {string} model - The model name
 * @returns {object} - Pricing information object
 * @throws {Error} - If model pricing information is not found
 */
function getModelPricing(model) {
  const lowerModel = model.toLowerCase();
  
  // Try exact match
  if (modelPricing[lowerModel]) {
    return modelPricing[lowerModel];
  }
  
  // Try matching by prefix
  for (const key of Object.keys(modelPricing)) {
    if (lowerModel.startsWith(key)) {
      return modelPricing[key];
    }
  }
  
  // Throw error if no pricing information found
  throw new Error(`Pricing information not found for model: ${model}`);
}

/**
 * Calculate cost for API usage
 * 
 * @param {string} model - The model name
 * @param {number} tokensInput - Number of input tokens
 * @param {number} tokensOutput - Number of output tokens
 * @returns {number} - The cost in USD
 * @throws {Error} - If model pricing information is not found
 */
function calculateCost(model, tokensInput, tokensOutput) {
  // getModelPricing will throw an error if model not found
  const pricing = getModelPricing(model);
  
  return (tokensInput * pricing.inputPrice) + (tokensOutput * pricing.outputPrice);
}

/**
 * Get all model pricing information
 * 
 * @returns {object} - Full model pricing map
 */
function getAllModelPricing() {
  return modelPricing;
}

export { getModelPricing, calculateCost, getAllModelPricing };
