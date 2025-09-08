import { createClient } from '@supabase/supabase-js';
import "dotenv/config.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load .env file manually if process.env is empty
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  try {
    // First try to load from current directory
    const localEnvPath = path.resolve(__dirname, './.env');
    
    if (fs.existsSync(localEnvPath)) {
      const envContent = fs.readFileSync(localEnvPath, 'utf8');
      const envVars = envContent.split('\n').reduce((acc, line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          acc[match[1].trim()] = match[2].trim();
        }
        return acc;
      }, {});
      
      supabaseUrl = envVars.SUPABASE_URL;
      supabaseKey = envVars.SUPABASE_SERVICE_KEY || envVars.SUPABASE_ANON_KEY;
    }
    
    // If still not found, try parent directory
    if (!supabaseUrl || !supabaseKey) {
      const parentEnvPath = path.resolve(__dirname, '../.env');
      
      if (fs.existsSync(parentEnvPath)) {
        const envContent = fs.readFileSync(parentEnvPath, 'utf8');
        const envVars = envContent.split('\n').reduce((acc, line) => {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match) {
            acc[match[1].trim()] = match[2].trim();
          }
          return acc;
        }, {});
        
        supabaseUrl = supabaseUrl || envVars.SUPABASE_URL;
        supabaseKey = supabaseKey || envVars.SUPABASE_SERVICE_KEY || envVars.SUPABASE_ANON_KEY;
      }
    }
  } catch (err) {
    console.error('Error loading .env file:', err.message);
  }
}

// Create client only if we have valid credentials
let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    console.error('Error creating Supabase client:', err.message);
  }
}

export { supabase };

/**
 * Validates if a string is a valid UUID
 * @param {string} id - The string to validate
 * @returns {boolean} - True if the string is a valid UUID
 */
function isValidUuid(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Get a valid user ID from the users table
 * @returns {Promise<string|null>} - A valid user ID or null if not found
 */
export async function getValidUserId() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (error || !data || data.length === 0) {
      return null;
    }
    
    return data[0].id;
  } catch (err) {
    console.error('Error fetching user ID:', err.message);
    return null;
  }
}

// Cache for valid user ID to avoid repeated database queries
let cachedValidUserId = null;

/**
 * Updates a user's credit balance by deducting the cost of an API request
 * @param {string} userId - The user ID
 * @param {number} costUsd - The cost to deduct in USD
 * @returns {Promise<boolean>} - True if update was successful, false otherwise
 */
export async function updateUserCreditBalance(userId, costUsd) {
  if (!supabase || !userId) {
    return false;
  }

  try {
    // Get the current balance
    const { data: userData, error: fetchError } = await supabase
      .from('user_credits')
      .select('balance_usd')
      .eq('user_id', userId)
      .single();

    if (fetchError || !userData) {
      console.error('Error fetching user credit balance:', fetchError?.message || 'No user found');
      return false;
    }

    // Calculate new balance with proper decimal precision
    const currentBalance = parseFloat(userData.balance_usd);
    const costAmount = parseFloat(costUsd);
    
    // Use toFixed(6) to preserve 6 decimal places and convert back to number
    const newBalance = Number((currentBalance - costAmount).toFixed(6));

    // Update the balance
    const { error: updateError } = await supabase
      .from('user_credits')
      .update({ balance_usd: newBalance })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Error updating user credit balance:', updateError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error updating user credit balance:', err.message);
    return false;
  }
}

/**
 * Log API usage to Supabase and update user credit balance
 * @param {Object} params - The parameters for logging API usage
 * @param {string} params.userId - The user ID
 * @param {string} params.requestType - The type of request (e.g., 'chat')
 * @param {string} params.model - The model used (e.g., 'claude-3-7-sonnet')
 * @param {number} params.tokensInput - The number of input tokens
 * @param {number} params.tokensOutput - The number of output tokens (estimated)
 * @param {number} params.costUsd - The cost in USD
 * @returns {Promise<void>}
 */
export async function logApiUsage({ userId, requestType, model, tokensInput, tokensOutput, costUsd }) {
  // If Supabase client is not initialized, return silently
  if (!supabase) {
    return;
  }
  
  try {
    // Determine the user ID to use for logging
    let actualUserId = userId;
    
    // If the provided user ID is not a valid UUID, use a cached valid user ID
    if (!isValidUuid(userId)) {
      actualUserId = cachedValidUserId || await getValidUserId();
      
      // If we found a valid user ID, cache it for future use
      if (actualUserId) {
        cachedValidUserId = actualUserId;
      } else {
        return; // No valid user ID available
      }
    }
    
    // Check if user has enough credits before proceeding
    const { data: userData, error: fetchError } = await supabase
      .from('user_credits')
      .select('balance_usd')
      .eq('user_id', actualUserId)
      .single();

    if (fetchError) {
      console.error('Error fetching user credit balance:', fetchError.message);
      throw new Error('Unable to verify credit balance');
    }
    
    // Check if balance is less than or equal to zero
    if (!userData || parseFloat(userData.balance_usd) <= 0) {
      throw new Error('You have run out of credits. Please add more credits to continue.');
    }
    
    // Insert the API usage record
    await supabase
      .from('api_usage')
      .insert([
        {
          user_id: actualUserId,
          request_type: requestType,
          model,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd
        }
      ]);
    
    // Update the user's credit balance
    await updateUserCreditBalance(actualUserId, costUsd);
  } catch (err) {
    console.error('Error logging API usage:', err.message);
    // Re-throw the error to propagate it to the caller
    throw err;
  }
}
