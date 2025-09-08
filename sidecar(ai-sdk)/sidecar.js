import "dotenv/config.js";
import express from "express";
import { z } from "zod";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { logApiUsage } from "./supabase.js";
import { calculateCost } from "./model-pricing.js";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  // Allow multiple origins
  const allowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Middleware to log API usage after response is sent
app.use((req, res, next) => {
  // Store the original end function
  const originalEnd = res.end;
  
  // Override the end function
  res.end = function(chunk, encoding) {
    // Call the original end function
    originalEnd.apply(res, arguments);
    
    // Only process /sdk-chat endpoints for successful responses
    // Skip logging if we've already sent an error response
    if (req.path === '/sdk-chat' && req.method === 'POST' && res.statusCode < 400) {
      try {
        // Extract data from the request
        const { messages = [], model = "claude-3-7-sonnet-20250219", id = null } = req.body;
        
        // Get user ID from request or header
        const authHeader = req.headers.authorization;
        let userId = id;
        
        if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
          userId = authHeader.substring(7) || 'anonymous';
        }
        
        userId = userId || 'anonymous';
        
        // Estimate tokens
        const inputContent = messages.reduce((acc, msg) => acc + (msg.content || "").length, 0);
        const tokensInput = Math.ceil(inputContent / 4);
        
        // Estimate output tokens (rough estimate based on typical response lengths)
        const tokensOutput = Math.ceil(tokensInput * 1.5);
        
        // Calculate cost using the model pricing module
        const costUsd = calculateCost(model, tokensInput, tokensOutput);
        
        // Log API usage to Supabase
        logApiUsage({
          userId,
          requestType: 'chat',
          model,
          tokensInput,
          tokensOutput,
          costUsd
        }).catch(error => {
          console.error('Error logging API usage after response:', error.message);
          // We can't send an error response here as the response has already been sent
          // In a production environment, you might want to log this to a monitoring system
        });
      } catch (error) {
        console.error('Error in API usage logging middleware:', error.message);
      }
    }
  };
  
  next();
});

app.post("/sdk-chat", async (req, res) => {
  const {
    messages = [],
    model = "claude-3-7-sonnet-20250219",
    temperature = 0.2,
    id = null, // User ID might be passed in the request
  } = req.body;

  // Extract user ID from authorization header if available
  const authHeader = req.headers.authorization;
  let userId = id;

  // If no user ID was provided directly, try to extract from auth header
  // This is just a placeholder - you'll need to adjust based on your auth strategy
  if (!userId && authHeader) {
    // For example, if using Bearer token, extract user ID from token
    // This is simplified; in production you might verify the token
    if (authHeader.startsWith('Bearer ')) {
      // Extract user ID from token or use a default
      userId = authHeader.substring(7) || 'anonymous';
    }
  }

  // If still no user ID, use anonymous
  userId = userId || 'anonymous';
  
  // Calculate approximate input tokens (simplistic estimation)
  const inputContent = messages.reduce((acc, msg) => acc + (msg.content || "").length, 0);
  const tokensInput = Math.ceil(inputContent / 4); // Rough estimate: 4 chars per token
  
  // Estimate output tokens (rough estimate based on typical response lengths)
  const tokensOutput = Math.ceil(tokensInput * 1.5);
  
  // Calculate cost using the model pricing module
  const costUsd = calculateCost(model, tokensInput, tokensOutput);

  // Check if user has enough credits before processing the request
  try {
    // Pre-check to see if the user has enough credits
    await logApiUsage({
      userId,
      requestType: 'credit-check', // Just checking credits, not logging actual usage
      model,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0 // Don't deduct any credits for the check
    });
  } catch (error) {
    // If there's a credit-related error, send it to the client
    console.error('Credit check failed:', error.message);
    return res.status(402).json({ 
      error: true, 
      message: error.message || 'Insufficient credits',
      type: 'credits'
    });
  }

  let sdkModel;
  const lowerModel = model.toLowerCase();
  if (lowerModel.startsWith("claude")) {
    sdkModel = anthropic(model, { apiKey: process.env.ANTHROPIC_API_KEY });
  } else {
    sdkModel = openai(model, { apiKey: process.env.OPENAI_API_KEY });
  }

  const providerOptions = lowerModel.startsWith("claude")
    ? { anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } } }
    : {};

  const tools = {
    executeSQL: {
      description:
        "Run an SQL statement against the current table and return the result.",
      parameters: z.object({
        sql: z.string().describe("The complete SQL query"),
      }),
    },
  };

  const result = streamText({
    model: sdkModel,
    messages,
    maxSteps: 5,
    tools: tools,
    temperature,
    stream: true,
    providerOptions,
  });

  // Get origin from request to use in response headers
  const origin = req.headers.origin;
  const allowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
  const responseOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  // Initialize a variable to track the response content
  let responseContent = '';
  
  try {
    // Use the default handler to pipe the stream to the client
    result.pipeDataStreamToResponse(res, {
      headers: { "Access-Control-Allow-Origin": responseOrigin },
      sendReasoning: true, // forward reasoning chunks to the client
      getErrorMessage: (e) => {
        // Format error messages for the client
        const errorMsg = e instanceof Error ? e.message : JSON.stringify(e);
        console.error('Error in AI response stream:', errorMsg);
        return errorMsg;
      }
      // We've removed the custom chunk processor as it might be causing issues
      // API usage logging will be handled by the middleware instead
    });
  } catch (error) {
    // Handle any errors that occur during streaming
    console.error('Error streaming response:', error.message);
    // If the response hasn't been sent yet, send an error response
    if (!res.headersSent) {
      const errorMessage = error.message || 'An error occurred processing your request';
      res.status(500).json({ 
        error: true, 
        message: errorMessage,
        type: error.message.includes('credits') ? 'credits' : 'processing'
      });
    }
  }
});

// Initialize the server with Supabase integration
import { supabase, getValidUserId } from "./supabase.js";

async function initializeServer() {
  if (supabase) {
    try {
      // Pre-fetch a valid user ID to use for API usage logging
      await getValidUserId();
    } catch (err) {
      console.error('Error initializing Supabase:', err.message);
    }
  }
}

app.listen(3010, async () => {
  console.log("AI-SDK side-car on http://localhost:3010/sdk-chat");
  await initializeServer();
});
