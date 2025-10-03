import type { Request, Response, NextFunction } from "express";

export function extractBearer(req: Request, _res: Response, next: NextFunction) {
  const auth = req.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  (req as any).bearer = m?.[1] || undefined;
  next();
}
