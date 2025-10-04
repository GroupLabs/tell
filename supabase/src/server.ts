import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { extractBearer } from "./middleware/auth.ts";
import { getUserClient, getServiceClient } from "./supabase.ts";
import { computeCostUSD } from "./utils/cost.ts";

const app = express();
app.use(express.json());
app.use(cors({ origin: (_origin, cb) => cb(null, true), credentials: true }));
app.use(extractBearer);

const DecrementBody = z.object({
  model: z.string(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cached_prompt_tokens: z.number().int().nonnegative().optional(),
});

app.post("/usage/decrement", async (req, res) => {
  try {
    const parsed = DecrementBody.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const {
      model,
      prompt_tokens,
      completion_tokens,
      cached_prompt_tokens = 0,
    } = parsed.data;

    const accessToken = (req as any).bearer as string | undefined;
    if (!accessToken)
      return res.status(401).json({ error: "Missing bearer token" });

    const userClient = getUserClient(accessToken);
    const { data: userResp, error: userErr } = await userClient.auth.getUser(
      accessToken
    );
    if (userErr || !userResp?.user?.id)
      return res.status(401).json({ error: "Invalid token" });
    const userId = userResp.user.id;

    const costUSD = computeCostUSD({
      model,
      promptTokens: prompt_tokens,
      completionTokens: completion_tokens,
      cachedPromptTokens: cached_prompt_tokens,
    });

    const svc = getServiceClient();
    const { error: rpcErr } = await svc.rpc("decrement_user_balance", {
      p_user_id: userId,
      p_delta: costUSD,
    });
    if (rpcErr) {
      console.error("decrement_user_balance RPC failed:", rpcErr);
      return res.status(500).json({ error: "Failed to update balance" });
    }

    return res.json({
      ok: true,
      cost_usd: costUSD,
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.get("/credits", async (req, res) => {
  try {
    // 1) Verify user via Supabase access token
    const accessToken = (req as any).bearer as string | undefined;
    if (!accessToken) return res.status(401).json({ error: "Missing bearer token" });

    const userClient = getUserClient(accessToken);
    const { data: userResp, error: userErr } = await userClient.auth.getUser(accessToken);
    if (userErr || !userResp?.user?.id) return res.status(401).json({ error: "Invalid token" });
    const userId = userResp.user.id;

    // 2) Look up current balance
    const svc = getServiceClient();
    const { data: row, error: selErr } = await svc
      .from("user_credits")
      .select("balance_usd")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      console.error("credits lookup failed:", selErr);
      return res.status(500).json({ error: "Failed to fetch credits" });
    }

    // If the user has never been inserted yet, treat as initial balance
    const balance = row?.balance_usd ?? 5.0;

    return res.json({
      balance_usd: Number(balance),
      is_out_of_credit: Number(balance) <= 0
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Internal error" });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`norma-api listening on :${port}`));
