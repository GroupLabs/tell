import "dotenv/config.js";
import express from "express";
import { z } from "zod";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/sdk-chat", async (req, res) => {
  const {
    messages = [],
    model = "claude-3-7-sonnet-20250219",
    temperature = 0.2,
  } = req.body;

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
        "Run a SQL query for immediate results without adding it to the transformation pipeline. Use for exploratory queries, data inspection, or when users want to see results right away.",
      parameters: z.object({
        sql: z.string().describe("The complete DuckDB-compatible SQL query. CRITICAL: Use proper SQL syntax only - no English phrases! Use: = (not 'equals'), < (not 'less than'), > (not 'greater than'), BETWEEN x AND y (not 'IS BETWEEN' or 'is around'), LIKE '%pattern%' (not 'contains'), IS NULL/IS NOT NULL only. Example: WHERE age BETWEEN 20 AND 30 (correct), NOT WHERE age IS BETWEEN 20 AND 30 (wrong)"),
      }),
    },
    addTransformation: {
      description:
        "Add a SQL transformation step to the data pipeline. Use when users want to filter, transform, or process data as part of their workflow.",
      parameters: z.object({
        sql: z.string().describe("The SQL query for the transformation. Use 'previous_step' to reference the output of the last transformation, or reference other transformation outputs by their alias names."),
        outputAlias: z.string().describe("A meaningful name for this transformation step using underscores (e.g., 'filtered_data', 'high_value_orders', 'aggregated_results')"),
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

  result.pipeDataStreamToResponse(res, {
    headers: { "Access-Control-Allow-Origin": "http://localhost:3000" },
    sendReasoning: true, // forward reasoning chunks to the client
    getErrorMessage: (e) =>
      e instanceof Error ? e.message : JSON.stringify(e),
  });
});

app.listen(3010, () =>
  console.log("AI-SDK side-car on http://localhost:3010/sdk-chat"),
);
