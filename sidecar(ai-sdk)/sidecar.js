import "dotenv/config.js";
import express from "express";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const app = express();
app.use(express.json());

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

  const result = streamText({
    model: sdkModel,
    messages,
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
