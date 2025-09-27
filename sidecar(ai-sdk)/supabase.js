import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


export async function logApiUsage({
  userId,
  requestType,
  model,
  tokensInput = 0,
  tokensOutput = 0,
  costUsd,
}) {  
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Invalid userId');
  }
  if (costUsd < 0) {
    throw new Error('costUsd must be non-negative');
  }

  await supabase
    .from('api_usage')
    .insert(
      [{
        user_id: userId,
        request_type: requestType,
        model,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        cost_usd: costUsd,
      }],
      { returning: 'minimal' }
    )
    .throwOnError();
}
