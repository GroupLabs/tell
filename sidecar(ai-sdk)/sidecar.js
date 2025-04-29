import "dotenv/config.js";
import express from "express";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const app = express();
app.use(express.json());

app.post("/sdk-chat", async (req, res) => {
  const {
    messages = [],
    model = "claude-3-7-sonnet-20250219",
    temperature = 0.2,
  } = req.body;

  const result = streamText({
    model: anthropic(model, { apiKey: process.env.ANTHROPIC_API_KEY }),

    messages,
    temperature,
    stream: true,

    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 12_000 },
      },
    },
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
