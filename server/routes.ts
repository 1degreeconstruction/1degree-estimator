import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { format, addDays } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cors from "cors";
import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface User {
      id: number;
      googleId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      role: string;
      isActive: boolean;
      createdAt: Date;
      lastLoginAt: Date | null;
    }
  }
}

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-1degree";

const PRE_APPROVED_EMAILS: Record<string, string> = {
  "1degreeconstruction@gmail.com": "admin",
  "david@1degreeconstruction.com": "admin",
  "thai@1degreeconstruction.com": "admin",
  "oliver@1degreeconstruction.com": "admin",
};

// JWT Auth middleware
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string; role: string };
    const user = await storage.getUser(payload.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });
    req.user = user as Express.User;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string; role: string };
    const user = await storage.getUser(payload.userId);
    if (!user || !user.isActive || user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.user = user as Express.User;
    return next();
  } catch {
    return res.status(403).json({ error: "Forbidden" });
  }
}

function generateUniqueId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateEstimateNumber(): Promise<string> {
  const now = new Date();
  const dateStr = format(now, "yyyyMMdd");
  const existing = await storage.getEstimates();
  const todayEstimates = existing.filter(e => {
    const num = typeof e.estimateNumber === "string" ? e.estimateNumber : String(e.estimateNumber);
    return num.includes(dateStr);
  });
  const seq = String(todayEstimates.length + 1).padStart(3, "0");
  return `1DC-${dateStr}-${seq}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // CORS — must be before other middleware
  app.set("trust proxy", 1);

  app.use(cors({
    origin: process.env.FRONTEND_URL || "https://1degree-estimator.vercel.app",
    credentials: true,
  }));

  // Passport (no session — just for Google OAuth handshake)
  app.use(passport.initialize());

  // Google OAuth Strategy
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || "124225853613-okfnb5gconblb1bhtr4tnloj3n4d77m8.apps.googleusercontent.com",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "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",
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "https://onedegree-estimator.onrender.com/auth/google/callback",
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || "";
        const name = profile.displayName || "";
        const avatarUrl = profile.photos?.[0]?.value || null;

        // Look up existing user
        let user = await storage.getUserByGoogleId(googleId);

        if (user) {
          // Update last login
          user = await storage.updateUser(user.id, { lastLoginAt: new Date() });
          return done(null, user as Express.User);
        }

        // New user — check if pre-approved
        const preApprovedRole = PRE_APPROVED_EMAILS[email.toLowerCase()];
        const isActive = !!preApprovedRole;
        const role = preApprovedRole || "estimator";

        const newUser = await storage.createUser({
          googleId,
          email,
          name,
          avatarUrl,
          role,
          isActive,
          createdAt: new Date(),
          lastLoginAt: new Date(),
        });

        return done(null, newUser as Express.User);
      } catch (err) {
        return done(err as Error);
      }
    }
  ));

  // --- Auth Routes ---

  app.get("/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }));

  app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login", session: false }),
    (req, res) => {
      const user = req.user as Express.User;
      const frontendUrl = process.env.FRONTEND_URL || "https://1degree-estimator.vercel.app";

      if (!user.isActive) {
        return res.redirect(`${frontendUrl}/#/?error=pending_approval`);
      }

      // Issue a JWT valid for 7 days
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.redirect(`${frontendUrl}/#/auth/callback?token=${token}`);
    }
  );

  app.get("/auth/me", requireAuth as any, (req, res) => {
    return res.json(req.user);
  });

  // --- API Auth Middleware ---
  // Apply requireAuth to all /api/* routes except the public ones
  app.use("/api", (req, res, next) => {
    // Public routes — no auth needed
    // req.path inside app.use("/api") is relative — "/api" prefix is stripped
    const publicRoutes = [
      { method: "GET", pattern: /^\/estimates\/public\// },
      { method: "POST", pattern: /^\/estimates\/public\/.*\/sign$/ },
      { method: "GET", pattern: /^\/reviews$/ },
      { method: "GET", pattern: /^\/places\// },
      { method: "GET", pattern: /^\/sales-reps$/ },
    ];

    for (const route of publicRoutes) {
      if (req.method === route.method && route.pattern.test(req.path)) {
        return next();
      }
    }

    return (requireAuth as any)(req, res, next);
  });

  // Sales Reps
  app.get("/api/sales-reps", async (_req, res) => {
    try {
      const reps = await storage.getSalesReps();
      res.json(reps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Estimates - list (supports ?mine=true)
  app.get("/api/estimates", async (req, res) => {
    try {
      const mine = req.query.mine === "true";
      const userId = mine && req.user ? (req.user as Express.User).id : undefined;

      const estimatesList = await storage.getEstimates(userId);
      const reps = await storage.getSalesReps();
      const usersList = await storage.listUsers();

      const enriched = estimatesList.map(e => ({
        ...e,
        salesRep: reps.find(r => r.id === e.salesRepId),
        createdByUser: usersList.find(u => u.id === e.createdByUserId),
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Estimates - get one by ID
  app.get("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Not found" });

      const [salesRep, items, milestones, events, allBreakdowns] = await Promise.all([
        storage.getSalesRep(estimate.salesRepId),
        storage.getLineItems(id),
        storage.getMilestones(id),
        storage.getEvents(id),
        storage.getBreakdownsByEstimate(id),
      ]);

      // Attach breakdowns to each line item
      const breakdownsByLineItem: Record<number, any[]> = {};
      for (const bd of allBreakdowns) {
        if (!breakdownsByLineItem[bd.lineItemId]) breakdownsByLineItem[bd.lineItemId] = [];
        breakdownsByLineItem[bd.lineItemId].push(bd);
      }
      const itemsWithBreakdowns = items.map(item => ({
        ...item,
        breakdowns: breakdownsByLineItem[item.id] || [],
      }));

      res.json({ ...estimate, salesRep, lineItems: itemsWithBreakdowns, milestones, events });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Estimates - get by unique ID (client-facing, PUBLIC)
  app.get("/api/estimates/public/:uniqueId", async (req, res) => {
    try {
      const estimate = await storage.getEstimateByUniqueId(req.params.uniqueId);
      if (!estimate) return res.status(404).json({ error: "Not found" });

      // Log view event
      if (estimate.status === "sent") {
        await storage.updateEstimate(estimate.id, {
          status: "viewed",
          viewedAt: new Date(),
        });
        await storage.createEvent({
          estimateId: estimate.id,
          eventType: "viewed",
          timestamp: new Date(),
          metadata: req.ip || null,
        });
      }

      const [salesRep, items, milestones] = await Promise.all([
        storage.getSalesRep(estimate.salesRepId),
        storage.getLineItems(estimate.id),
        storage.getMilestones(estimate.id),
      ]);

      // Strip internal costs for client view
      const clientItems = items.map(({ subCost, ...item }) => item);

      res.json({
        ...estimate,
        totalSubCost: undefined,
        salesRep,
        lineItems: clientItems,
        milestones,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pricing History endpoints
  app.post("/api/pricing-history", async (req, res) => {
    try {
      const { trade, scopeKeyword, subCost, city, estimateId } = req.body;
      if (!trade || !scopeKeyword || subCost === undefined) {
        return res.status(400).json({ error: "trade, scopeKeyword, subCost are required" });
      }
      await storage.logPricing([{ trade, scopeKeyword, subCost, city, source: "user_edit", estimateId }]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/pricing-history", async (req, res) => {
    try {
      const trade = req.query.trade as string;
      if (!trade) return res.status(400).json({ error: "trade query param required" });
      const rows = await storage.getRecentPricing(trade, 10);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pricing Assistant Chat
  app.post("/api/pricing-chat", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory = [] } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      // Gather all recent pricing history (up to 100 rows)
      const pricingRows = await storage.getAllRecentPricing(100);
      const pricingContext = pricingRows.length > 0
        ? pricingRows.map(r => {
            const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "unknown";
            return `${r.trade} | ${r.scopeKeyword} | $${r.subCost} | ${r.city || ""} | ${r.source} | ${date}`;
          }).join("\n")
        : "No pricing history available yet.";

      // Gather recent 20 projects
      const allEstimates = await storage.getEstimates();
      const recentEstimates = allEstimates.slice(0, 20);
      const projectContext = recentEstimates.length > 0
        ? recentEstimates.map(e => {
            const date = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "unknown";
            return `#${e.estimateNumber} | ${e.clientName} | ${e.projectAddress}, ${e.city} | $${e.totalSubCost?.toFixed(0) || 0} sub | ${e.status} | ${date}`;
          }).join("\n")
        : "No projects available yet.";

      const systemPrompt = `You are the pricing assistant for 1 Degree Construction. You have access to the company's historical pricing database and project records.

Your job:
- Answer questions about past pricing on specific projects
- Compare costs across trades, projects, and time periods
- Help the estimator understand cost trends
- Suggest pricing for new work based on historical data

PRICING DATA (from completed projects):
${pricingContext}

PROJECT LIST:
${projectContext}

RULES:
1. Always cite which project/date your numbers come from
2. If you don't have data for something, say so — don't guess
3. Keep responses concise and direct
4. If the user asks to UPDATE or CHANGE a price in the database, respond with your recommendation but include a JSON block at the END of your message in this exact format:
   ===PROPOSED_CHANGE===
   {"trade": "...", "scopeKeyword": "...", "subCost": ..., "city": "...", "reason": "..."}
   ===END_CHANGE===
5. NEVER propose changes unless the user explicitly asks to update/change/set a price
6. Only ONE change at a time — never batch updates
7. Changes must be reasonable — never more than 50% different from the most recent price for that trade unless the user provides clear justification`;

      // Keep last 10 messages of conversation history
      const trimmedHistory = conversationHistory.slice(-10);

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          ...trimmedHistory.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user", content: message },
        ],
      });

      const rawReply = response.content[0].type === "text" ? response.content[0].text : "";

      // Parse proposed change if present
      let proposedChange: { trade: string; scopeKeyword: string; subCost: number; city: string; reason: string } | undefined;
      let reply = rawReply;

      const changeMatch = rawReply.match(/===PROPOSED_CHANGE===([\/\S\s]*?)===END_CHANGE===/m);
      if (changeMatch) {
        try {
          proposedChange = JSON.parse(changeMatch[1].trim());
          // Remove the block from the displayed reply
          reply = rawReply.replace(/===PROPOSED_CHANGE===([\/\S\s]*?)===END_CHANGE===/m, "").trim();
        } catch {
          // If parse fails, leave reply as-is
        }
      }

      res.json({ reply, proposedChange });
    } catch (err: any) {
      console.error("Pricing chat error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Manual pricing history update (admin or estimator)
  app.post("/api/pricing-history/update", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user || (user.role !== "admin" && user.role !== "estimator")) {
        return res.status(403).json({ error: "Forbidden: admin or estimator role required" });
      }
      const { trade, scopeKeyword, subCost, city, reason } = req.body;
      if (!trade || !scopeKeyword || subCost === undefined) {
        return res.status(400).json({ error: "trade, scopeKeyword, and subCost are required" });
      }
      await storage.logPricing([{
        trade,
        scopeKeyword,
        subCost: Number(subCost),
        city: city || undefined,
        source: "manual_update",
      }]);
      res.json({ success: true, message: `Pricing updated: ${trade} / ${scopeKeyword} = $${subCost}${reason ? ` (${reason})` : ""}` });
    } catch (err: any) {
      console.error("Pricing update error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Create estimate
  app.post("/api/estimates", async (req, res) => {
    try {
      const { lineItems: items, milestones, ...estimateData } = req.body;

      const now = new Date();
      const estimateNumber = await generateEstimateNumber();
      const uniqueId = generateUniqueId();

      // Calculate totals
      let totalSubCost = 0;
      if (items) {
        for (const item of items) {
          totalSubCost += item.subCost || 0;
        }
      }
      const totalBeforeAllowance = totalSubCost * 2;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      const totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      const depositAmount = Math.min(1000, Math.round(totalClientPrice * 0.1 * 100) / 100);

      const currentUserId = req.user ? (req.user as Express.User).id : null;

      const estimate = await storage.createEstimate({
        estimateNumber,
        uniqueId,
        clientName: estimateData.clientName || "",
        clientEmail: estimateData.clientEmail || "",
        clientPhone: estimateData.clientPhone || "",
        projectAddress: estimateData.projectAddress || "",
        city: estimateData.city || "",
        state: estimateData.state || "CA",
        zip: estimateData.zip || "",
        salesRepId: estimateData.salesRepId || 0,
        status: estimateData.status || "draft",
        createdAt: now,
        validUntil: addDays(now, 45).toISOString(),
        totalSubCost,
        totalClientPrice,
        allowanceAmount,
        depositAmount,
        permitRequired: estimateData.permitRequired || false,
        notesInternal: estimateData.notesInternal || null,
        projectInclusions: estimateData.projectInclusions || null,
        projectExclusions: estimateData.projectExclusions || null,
        sentAt: estimateData.status === "sent" ? now : null,
        viewedAt: null,
        approvedAt: null,
        signatureName: null,
        signatureTimestamp: null,
        createdByUserId: currentUserId,
      });

      // Create line items
      if (items && items.length > 0) {
        for (const item of items) {
          const createdItem = await storage.createLineItem({
            estimateId: estimate.id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            customPhaseLabel: item.customPhaseLabel || null,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
          // Create breakdowns for grouped items
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (let bdIdx = 0; bdIdx < item.breakdowns.length; bdIdx++) {
              const bd = item.breakdowns[bdIdx];
              await storage.createBreakdown({
                lineItemId: createdItem.id,
                tradeName: bd.tradeName,
                subCost: bd.subCost || 0,
                notes: bd.notes || null,
                sortOrder: bdIdx,
              });
            }
          }
        }
      }

      // Create milestones
      if (milestones && milestones.length > 0) {
        for (const m of milestones) {
          await storage.createMilestone({
            estimateId: estimate.id,
            milestoneName: m.milestoneName,
            amount: m.amount,
            sortOrder: m.sortOrder,
          });
        }
      }

      // Log event
      await storage.createEvent({
        estimateId: estimate.id,
        eventType: "created",
        timestamp: now,
        metadata: null,
      });

      if (estimateData.status === "sent") {
        await storage.createEvent({
          estimateId: estimate.id,
          eventType: "sent",
          timestamp: now,
          metadata: null,
        });
      }

      // Log pricing history for each line item
      if (items && items.length > 0) {
        const pricingEntries = items.map((item: any) => ({
          trade: item.phaseGroup || "other",
          scopeKeyword: (item.scopeDescription || "").slice(0, 50),
          subCost: item.subCost || 0,
          city: estimateData.city || "",
          source: (estimateData as any)._aiGenerated ? "ai_generated" : "user_edit",
          estimateId: estimate.id,
        }));
        await storage.logPricing(pricingEntries).catch(() => {});

        // Also log breakdown-level pricing for grouped items
        const breakdownEntries: Array<{ trade: string; scopeKeyword: string; subCost: number; city?: string; source: string; estimateId?: number }> = [];
        for (const item of items) {
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (const bd of item.breakdowns) {
              if (bd.tradeName && bd.subCost > 0) {
                breakdownEntries.push({
                  trade: bd.tradeName,
                  scopeKeyword: item.phaseGroup || "other",
                  subCost: bd.subCost,
                  city: estimateData.city || "",
                  source: "breakdown_manual",
                  estimateId: estimate.id,
                });
              }
            }
          }
        }
        if (breakdownEntries.length > 0) {
          await storage.logPricing(breakdownEntries).catch(() => {});
        }
      }

      res.json(estimate);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update estimate
  app.put("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { lineItems: items, milestones, ...estimateData } = req.body;

      // Calculate totals
      let totalSubCost = 0;
      if (items) {
        for (const item of items) {
          totalSubCost += item.subCost || 0;
        }
      }
      const totalBeforeAllowance = totalSubCost * 2;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      const totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      const depositAmount = Math.min(1000, Math.round(totalClientPrice * 0.1 * 100) / 100);

      const now = new Date();
      const existing = await storage.getEstimate(id);
      const wasDraft = existing?.status === "draft";
      const isSending = estimateData.status === "sent" && wasDraft;

      const estimate = await storage.updateEstimate(id, {
        clientName: estimateData.clientName || "",
        clientEmail: estimateData.clientEmail || "",
        clientPhone: estimateData.clientPhone || "",
        projectAddress: estimateData.projectAddress || "",
        city: estimateData.city || "",
        state: estimateData.state || "CA",
        zip: estimateData.zip || "",
        salesRepId: estimateData.salesRepId || 0,
        status: estimateData.status,
        totalSubCost,
        totalClientPrice,
        allowanceAmount,
        depositAmount,
        permitRequired: estimateData.permitRequired || false,
        notesInternal: estimateData.notesInternal || null,
        projectInclusions: estimateData.projectInclusions !== undefined ? estimateData.projectInclusions : null,
        projectExclusions: estimateData.projectExclusions !== undefined ? estimateData.projectExclusions : null,
        sentAt: isSending ? now : undefined,
      });

      if (!estimate) return res.status(404).json({ error: "Not found" });

      // Replace line items (deleteLineItemsByEstimate also cascades breakdowns)
      await storage.deleteLineItemsByEstimate(id);
      if (items && items.length > 0) {
        for (const item of items) {
          const createdItem = await storage.createLineItem({
            estimateId: id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            customPhaseLabel: item.customPhaseLabel || null,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
          // Create breakdowns for grouped items
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (let bdIdx = 0; bdIdx < item.breakdowns.length; bdIdx++) {
              const bd = item.breakdowns[bdIdx];
              await storage.createBreakdown({
                lineItemId: createdItem.id,
                tradeName: bd.tradeName,
                subCost: bd.subCost || 0,
                notes: bd.notes || null,
                sortOrder: bdIdx,
              });
            }
          }
        }
      }

      // Replace milestones
      await storage.deleteMilestonesByEstimate(id);
      if (milestones && milestones.length > 0) {
        for (const m of milestones) {
          await storage.createMilestone({
            estimateId: id,
            milestoneName: m.milestoneName,
            amount: m.amount,
            sortOrder: m.sortOrder,
          });
        }
      }

      if (isSending) {
        await storage.createEvent({
          estimateId: id,
          eventType: "sent",
          timestamp: now,
          metadata: null,
        });
      }

      // Log pricing history for each line item
      if (items && items.length > 0) {
        const pricingEntries = items.map((item: any) => ({
          trade: item.phaseGroup || "other",
          scopeKeyword: (item.scopeDescription || "").slice(0, 50),
          subCost: item.subCost || 0,
          city: estimateData.city || "",
          source: (estimateData as any)._aiGenerated ? "ai_generated" : "user_edit",
          estimateId: id,
        }));
        await storage.logPricing(pricingEntries).catch(() => {});

        // Also log breakdown-level pricing for grouped items
        const breakdownEntries: Array<{ trade: string; scopeKeyword: string; subCost: number; city?: string; source: string; estimateId?: number }> = [];
        for (const item of items) {
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (const bd of item.breakdowns) {
              if (bd.tradeName && bd.subCost > 0) {
                breakdownEntries.push({
                  trade: bd.tradeName,
                  scopeKeyword: item.phaseGroup || "other",
                  subCost: bd.subCost,
                  city: estimateData.city || "",
                  source: "breakdown_manual",
                  estimateId: id,
                });
              }
            }
          }
        }
        if (breakdownEntries.length > 0) {
          await storage.logPricing(breakdownEntries).catch(() => {});
        }
      }

      res.json(estimate);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Client sign estimate (PUBLIC)
  app.post("/api/estimates/public/:uniqueId/sign", async (req, res) => {
    try {
      const estimate = await storage.getEstimateByUniqueId(req.params.uniqueId);
      if (!estimate) return res.status(404).json({ error: "Not found" });

      const { signatureName } = req.body;
      if (!signatureName) return res.status(400).json({ error: "Signature name required" });

      const now = new Date();
      const updated = await storage.updateEstimate(estimate.id, {
        status: "approved",
        approvedAt: now,
        signatureName,
        signatureTimestamp: now,
      });

      await storage.createEvent({
        estimateId: estimate.id,
        eventType: "approved",
        timestamp: now,
        metadata: JSON.stringify({ ip: req.ip, signatureName }),
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update status
  app.patch("/api/estimates/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const estimate = await storage.updateEstimate(id, { status });
      if (!estimate) return res.status(404).json({ error: "Not found" });

      await storage.createEvent({
        estimateId: id,
        eventType: status,
        timestamp: new Date(),
        metadata: null,
      });

      res.json(estimate);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reviews data (PUBLIC)
  app.get("/api/reviews", (_req, res) => {
    res.json({
      google: {
        rating: 4.9,
        count: 327,
        url: "https://goo.gl/maps/yNKcRVoyc7qEwWrE6",
      },
      yelp: {
        rating: 5.0,
        count: null,
        url: "https://www.yelp.com/biz/1-degree-construction-pleasanton",
        badge: "5-star rated",
      },
      houzz: {
        rating: null,
        count: null,
        url: "https://www.houzz.com/pro/1degreeconstruction",
        badge: "Featured Pro",
      },
    });
  });

  // Admin routes
  app.get("/api/admin/users", requireAdmin as any, async (_req, res) => {
    try {
      const usersList = await storage.listUsers();
      res.json(usersList);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/users/:id/approve", requireAdmin as any, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const user = await storage.updateUser(id, { isActive: true });
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/users/:id/role", requireAdmin as any, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { role } = req.body;
      if (!["admin", "estimator", "viewer"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const user = await storage.updateUser(id, { role });
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin as any, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const user = await storage.updateUser(id, { isActive: false });
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google Places Autocomplete proxy (no auth required for UX, key stays server-side)
  // Free address autocomplete via OpenStreetMap Nominatim — no API key needed
  app.get("/api/places/autocomplete", async (req, res) => {
    const input = (req.query.input as string) || "";
    if (!input || input.length < 3) return res.json({ predictions: [] });

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&addressdetails=1&countrycodes=us&limit=6`,
        { headers: { "User-Agent": "1DegreeConstructionEstimator/1.0" } }
      );
      const results = await response.json() as any[];

      const predictions = results
        .filter((r: any) => r.address?.road || r.address?.house_number)
        .map((r: any, i: number) => {
          const a = r.address || {};
          const houseNum = a.house_number || "";
          const road = a.road || "";
          const street = [houseNum, road].filter(Boolean).join(" ");
          const city = a.city || a.town || a.village || a.hamlet || "";
          const state = a.state || "";
          const stateAbbr = state === "California" ? "CA" : state.slice(0, 2).toUpperCase();
          const zip = a.postcode || "";

          return {
            place_id: `osm_${i}`,
            description: `${street}, ${city}, ${stateAbbr} ${zip}`.trim(),
            address: street,
            city: city,
            state: stateAbbr,
            zip: zip,
          };
        });

      res.json({ predictions });
    } catch {
      res.json({ predictions: [] });
    }
  });

  // AI estimate generation
  const AI_SYSTEM_PROMPT = `You are the estimating AI for 1 Degree Construction, a general contractor based in Los Angeles, CA. You generate construction estimates using REAL pricing data from our sub bid history, internal cost records, and LA market research.

CRITICAL: All costs you output are SUB COSTS (what we pay the subcontractor). The system auto-applies 100% markup to calculate client pricing. Do NOT double the rates yourself.

=== MASTER SCOPING RULE (NON-NEGOTIABLE) ===
NEVER scope or charge a client for work that has not been specifically identified and confirmed. Every line item and its cost MUST be tied to known, verified work.

If there is potential additional work that has NOT been verified (e.g., hidden conditions behind walls, unknown structural issues, unconfirmed scope, possible code violations, dry rot, mold, termite damage), do NOT include it as a priced line item. Instead:
1. Mention it in the scope description as a POTENTIAL condition that may require a change order
2. Use language like: "Any unforeseen conditions discovered during [demo/rough-in/etc.] including but not limited to [dry rot, mold, code violations, structural deficiencies] will be addressed via written change order."
3. The 3% allowance covers minor unforeseen items only
4. Anything beyond the allowance requires a formal written change order before work begins

The scope must reflect ONLY what we can confirm and charge for RIGHT NOW. Do not pad estimates with speculative work. Do not assume conditions that haven't been inspected. If the project involves opening walls, always note that hidden conditions are excluded and will be change-ordered if discovered.

=== GEOGRAPHIC ADJUSTMENTS ===
All rates below are Central LA baseline. Adjust by location:
- Central LA (Hollywood, Silver Lake, Echo Park, Los Feliz): 1.00x (baseline)
- San Fernando Valley (Encino, Sherman Oaks, Tarzana, Van Nuys): 0.90x
- Stevenson Ranch / Santa Clarita: 0.88x
- Westside / Century City / Beverly Hills: 1.10x
- Malibu / Pacific Palisades (coastal): 1.25x
- Encino / Sherman Oaks: 0.95x

=== PRICING REFERENCE (SUB COSTS — Central LA baseline) ===

GENERAL CONDITIONS:
- Small project (1 bathroom, cosmetic): $400-600
- Medium project (1-2 rooms, full remodel): $800-1,200
- Large project (kitchen + bath, multi-room): $1,500-2,500
- Includes: floor protection, dust containment, dumpster, broom clean, dedicated PM, client group chat

PERMIT/DESIGN (when applicable):
- Simple permit (bathroom/kitchen remodel): $1,500-3,000
- Complex permit (ADU, addition, structural): $5,000-15,000
- Architectural plans: $3,000-8,000
- Structural engineering: $2,000-5,000
- Title 24 energy calculations: $500-1,500

DEMOLITION (L+M including haul-away):
- Guest bathroom demo: $1,250/room (invoice-verified)
- Primary/master bathroom demo: $2,250/room
- Small kitchen demo: $1,500/room
- Large kitchen demo: $2,500/room
- General interior demo: $10/SF
- Wall demolition: $10/LF
- Window/exterior door demo: $150/item
- Interior door demo: $50/item
- Fireplace surround/box/chimney: $600/each
- Water heater removal: $250/item

FRAMING (L+M — lumber, hardware, plates, brackets included):
- Bathroom framing: $1,000/room
- Kitchen framing (with hood): $2,400/room
- Wall framing: $35/LF
- Door framing: $350/door
- New addition framing: $75/SF (includes seismic/shear — LA specific)

ELECTRICAL (L+M — GC-grade devices included):
- Bathroom electrical rough-in: $1,100/room (invoice: $1,080 pre-discount)
- Kitchen electrical rough-in: $1,500/room
- Recessed LED light: $130/each (invoice-verified)
- Standard outlet: $125/each
- GFCI outlet: $125/each
- Switch: $150/each
- Switch with dimmer: $125/each
- J-box (install only): $160/each
- Exhaust fan (install only — client supplies): $300/each
- Main panel upgrade (200A): $4,000/each
- Sub panel (100A): $2,500/each
- 220V circuit: $500/each
- Sconce installation (install only — client supplies fixture): $180/each

PLUMBING (L+M — rough materials included):
- Bathroom rough plumbing, same location: $3,000/room (MARKET RATE — old CSV of $1,250 is outdated)
- Bathroom rough plumbing, new location: $6,500/room
- Kitchen rough plumbing, same location: $3,000/room
- Kitchen rough plumbing, new location: $5,000/room
- Kitchen + master bath full (rough + finish): $6,500 (invoice-verified, Figueroa Plumbing)
- Toilet install only: $225/each
- Sink install only: $250/each
- Basic tub install only: $500/each
- Steam shower install: $3,000/each
- Full house repipe (1500 SF): $15,000
- New sewer line to street: $250/LF
- Sewer line replace (trench): $85/LF
- BBQ gas line: $1,000/each

INSULATION:
- Attic insulation: $4/SF (L+M)
- Wall & crawl space insulation: $8/SF of house (L+M)

DRYWALL (L+M — sheets, tape, mud, screws included):
- Drywall + taping (Level 4): $8/SF
- Drywall + skim coat (Level 5): $9/SF
- Remodel patching: $500/area
- Invoice reference: Renovate It Remodeling charged $2,050 for kitchen + bathroom drywall + patch + prime

PAINT (L+M — GC-grade paint included):
- Interior per room: $1,200/room
- Interior whole home: $8/SF of home
- Exterior: $4/SF (labor only — add paint material cost)

TILE (LABOR ONLY — client supplies all tile materials):
- Floor tile (standard ceramic 12x24+): $15/SF
- Shower/tub wall tile: $20/SF
- Shower pan tile: $25/SF
- Backsplash tile: $20/SF
- Note: VIP Construction charged $3,700 for bathroom wall + kitchen backsplash (~$47/SF blended — this was high)

FINISH CARPENTRY / CABINETRY (LABOR ONLY — client supplies materials):
- Interior door installation: $250/door
- Pocket door installation: $350/door
- Door hardware installation: $125/set
- Cabinet hardware installation: $500/kitchen
- Baseboard/casing: varies by LF

GLASS:
- Shower enclosure (material + labor): $2,000/each
- Glass railing (labor only): $450/item

WATERPROOFING:
- Hot mop shower pan: $700/shower
- Deck waterproofing (full system): $4,200 (invoice reference)

ROOFING (L+M):
- Asphalt shingle: $5/SF
- Clay roofing: $18/SF
- Standing seam metal (no demo): $10/SF
- Torched down: $5/SF

CABINET REFINISHING:
- Kitchen cabinet refinishing (sand, prime, 2 coats): $3,000/kitchen (invoice reference)

STUCCO (L+M — excludes paint):
- Stucco repair (weep screed, wire, scratch, brown, texture match): $2,400 (invoice reference)

HVAC (LABOR ONLY — equipment separate):
- AC unit installation: varies, typically $8,000-12,000 with equipment

=== ESTIMATE STRUCTURE RULES ===
1. Line items follow construction sequence: permit_design → planning → general_conditions → demolition → framing → mep → insulation_drywall_paint → tile_finish_carpentry → other
2. General Conditions is ALWAYS included as the first or early line item
3. For "mep" phase: describe Mechanical, Electrical, and Plumbing scopes INDEPENDENTLY in the scopeDescription, but use ONE collective subCost. Set isGrouped: true.
4. For "insulation_drywall_paint" phase: describe Insulation, Drywall, and Paint scopes INDEPENDENTLY, ONE collective subCost. Set isGrouped: true.
5. For "tile_finish_carpentry" phase: describe Tile/Stone, Cabinetry Install, and Finish Carpentry/Millwork/Baseboard scopes INDEPENDENTLY, ONE collective subCost. Set isGrouped: true.
6. All other phases (demolition, framing, etc.) use isGrouped: false.
7. Permit is required for everything EXCEPT: interior paint only, flooring only, cosmetic/refinishing work only.

=== PAYMENT SCHEDULE RULES ===
- Always top-heavy (front-load payments)
- First milestone is always "Deposit upon acceptance" — amount should be lesser of $1,000 or 10% of total CLIENT price
- Calculate: totalClientPrice = (sum of all subCosts * 2) * 1.03
- Then set deposit = min(1000, totalClientPrice * 0.10)

PROGRESS PAYMENTS:
- Break payments down by actual construction phases — NOT lumped together
- Each major phase gets its own milestone. Examples:
  • Deposit upon acceptance
  • Completion of Demolition
  • Completion of Framing
  • Completion of MEP (Mechanical, Electrical, Plumbing)
  • Completion of Insulation, Drywall & Paint
  • Completion of Tile & Finish Carpentry
  • Final Walkthrough & Project Closeout (Retention)
- For smaller projects with fewer phases, combine logically but never lump more than 2 phases into one payment
- Payment schedule should be top-heavy: earlier milestones should be larger amounts

ROUND NUMBERS RULE:
- All progress payment amounts MUST be clean, round numbers for easy invoicing
- Round to the nearest $500 for payments over $5,000 (e.g., $12,500 not $12,347)
- Round to the nearest $100 for payments under $5,000 (e.g., $3,200 not $3,187)
- Put ALL the leftover "ugly" cents/dollars into the final retention payment ONLY
- The retention payment is the ONLY one that can have non-round numbers

RETENTION (FINAL PAYMENT) RULE:
- Default: 10% of total client price
- Maximum: 15% of total client price
- If rounding the progress payments pushes retention above 15%, split the excess between the last two payments
- Label the final milestone as: "Final Walkthrough & Project Closeout (10% Retention)" or similar
- Retention is released upon substantial completion — not held for punch list items

Milestone amounts MUST sum to exactly totalClientPrice. The retention absorbs all rounding differences.

=== SCOPE WRITING RULES ===
- Write scope descriptions in bullet point format using bullet character •
- Be specific about what is included in each trade
- Always note "Glass and all hardware supplied by client" or "Tile materials supplied by client" for labor-only trades
- For finish materials: 1 Degree does NOT supply finish materials (fixtures, tile, countertops, hardware, appliances). Always note client responsibility.
- Use professional but clear language
- Include relevant technical details (e.g., "minimum 5/8 inch flat threshold required" for glass)

=== INTERNAL NOTES ===
In notesInternal, include:
- Which rates came from invoice history vs market research
- Any rates with low confidence that should be verified with a real sub bid
- Geographic adjustment applied
- Any scope assumptions made

=== PROJECT-SPECIFIC INCLUSIONS & EXCLUSIONS ===
For every estimate, generate project-specific inclusions and exclusions tailored to the actual scope of work. These are IN ADDITION to the company's standard inclusions/exclusions/terms which are always shown separately.

Project Inclusions should list what IS specifically included for THIS project based on the scope. Be specific and clear. Examples:
• Full demolition of existing bathroom including tile, fixtures, and drywall
• New rough plumbing for relocated shower and vanity
• Installation of client-supplied tile on shower walls and floor
• GC-grade recessed LED lighting (6 fixtures)

Project Exclusions should list what is NOT included that the client might expect or ask about for this type of project. Be proactive — anticipate questions. Examples:
• Shower glass enclosure (client to source and coordinate separately)
• Decorative light fixtures — GC-grade recessed LEDs included; decorative sconces, pendants by client
• Heated flooring system
• Custom tile patterns — straight lay included, herringbone/diagonal/mosaic excluded
• Permit fees and inspection costs

Format: One item per line, starting with bullet character •
Learn from previous estimates — check pricing_history and existing estimates to see what inclusions/exclusions are commonly used for similar project types.

=== TRADE BREAKDOWN RULE ===
For grouped phases (mep, insulation_drywall_paint, tile_finish_carpentry), ALWAYS include a "breakdowns" array with per-trade sub costs. The sum of breakdowns must equal the line item subCost.
- mep breakdowns: Plumbing, Electrical, HVAC
- insulation_drywall_paint breakdowns: Insulation, Drywall, Paint
- tile_finish_carpentry breakdowns: Tile/Stone, Cabinetry, Finish Carpentry

Return ONLY valid JSON in this exact format:
{
  "clientName": "",
  "clientEmail": "",
  "clientPhone": "",
  "projectAddress": "",
  "city": "",
  "state": "CA",
  "zip": "",
  "permitRequired": true/false,
  "projectInclusions": "bullet-separated list of project-specific inclusions",
  "projectExclusions": "bullet-separated list of project-specific exclusions",
  "lineItems": [
    {
      "phaseGroup": "general_conditions|demolition|framing|mep|insulation_drywall_paint|tile_finish_carpentry|permit_design|planning|other",
      "customPhaseLabel": "only if phaseGroup is other, otherwise null",
      "scopeDescription": "detailed scope text with bullet points",
      "subCost": number,
      "isGrouped": true/false,
      "breakdowns": [
        { "tradeName": "string", "subCost": number, "notes": "" }
      ]
    }
  ],
  "milestones": [
    { "milestoneName": "string", "amount": number }
  ],
  "notesInternal": "internal notes"
}
Note: "breakdowns" is required for isGrouped=true line items. For non-grouped items, omit or set breakdowns to [].
`;

  const AI_REWRITE_SYSTEM_PROMPT = `You are the estimating AI for 1 Degree Construction. You are editing an EXISTING estimate.

CRITICAL: All costs are SUB COSTS (what we pay the subcontractor). The system auto-applies 100% markup.

=== REWRITE RULES (editing an existing estimate) ===
1. ONLY change what the user explicitly asks to change
2. Keep all unchanged line items EXACTLY as they are — same scope text, same prices
3. Do not rephrase or reformat scope descriptions that weren't mentioned
4. Do not adjust prices that weren't questioned
5. If the user says "add X" — add it, keep everything else identical
6. If the user says "change the price of X" — change only that price
7. Return the COMPLETE estimate JSON (all line items, not just changes)
8. Always return updated projectInclusions and projectExclusions (preserve existing ones unless specifically asked to change them)

=== PROJECT-SPECIFIC INCLUSIONS & EXCLUSIONS ===
For every estimate, generate project-specific inclusions and exclusions tailored to the actual scope of work. These are IN ADDITION to the company's standard inclusions/exclusions/terms which are always shown separately.

Project Inclusions should list what IS specifically included for THIS project based on the scope. Be specific and clear. Examples:
• Full demolition of existing bathroom including tile, fixtures, and drywall
• New rough plumbing for relocated shower and vanity
• Installation of client-supplied tile on shower walls and floor
• GC-grade recessed LED lighting (6 fixtures)

Project Exclusions should list what is NOT included that the client might expect or ask about for this type of project. Be proactive — anticipate questions. Examples:
• Shower glass enclosure (client to source and coordinate separately)
• Decorative light fixtures — GC-grade recessed LEDs included; decorative sconces, pendants by client
• Heated flooring system
• Custom tile patterns — straight lay included, herringbone/diagonal/mosaic excluded
• Permit fees and inspection costs

Format: One item per line, starting with bullet character •

=== TRADE BREAKDOWN RULE ===
For grouped phases (mep, insulation_drywall_paint, tile_finish_carpentry), ALWAYS include a "breakdowns" array with per-trade sub costs. The sum of breakdowns must equal the line item subCost.
- mep breakdowns: Plumbing, Electrical, HVAC
- insulation_drywall_paint breakdowns: Insulation, Drywall, Paint
- tile_finish_carpentry breakdowns: Tile/Stone, Cabinetry, Finish Carpentry

Return ONLY valid JSON in this exact format:
{
  "clientName": "",
  "clientEmail": "",
  "clientPhone": "",
  "projectAddress": "",
  "city": "",
  "state": "CA",
  "zip": "",
  "permitRequired": true/false,
  "projectInclusions": "bullet-separated list of project-specific inclusions",
  "projectExclusions": "bullet-separated list of project-specific exclusions",
  "lineItems": [
    {
      "phaseGroup": "general_conditions|demolition|framing|mep|insulation_drywall_paint|tile_finish_carpentry|permit_design|planning|other",
      "customPhaseLabel": "only if phaseGroup is other, otherwise null",
      "scopeDescription": "detailed scope text with bullet points",
      "subCost": number,
      "isGrouped": true/false,
      "breakdowns": [
        { "tradeName": "string", "subCost": number, "notes": "" }
      ]
    }
  ],
  "milestones": [
    { "milestoneName": "string", "amount": number }
  ],
  "notesInternal": "internal notes"
}
Note: "breakdowns" is required for isGrouped=true line items. For non-grouped items, omit or set breakdowns to [].
`;

  app.post("/api/ai/generate-estimate", async (req, res) => {
    try {
      const { prompt, estimateId } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const isEditMode = !!estimateId;
      let existingEstimate: any = null;
      let existingLineItems: any[] = [];
      let aiLog = "";

      // Fetch existing estimate context if editing
      if (isEditMode) {
        const id = parseInt(String(estimateId));
        existingEstimate = await storage.getEstimate(id);
        if (existingEstimate) {
          existingLineItems = await storage.getLineItems(id);
          aiLog = existingEstimate.aiLog || "";
        }
      }

      // Gather relevant pricing history based on prompt keywords
      let pricingContext = "";
      try {
        const tradeKeywords = ["demolition", "framing", "mep", "insulation_drywall_paint", "tile_finish_carpentry", "general_conditions", "permit_design"];
        const mentionedTrades = tradeKeywords.filter(t =>
          prompt.toLowerCase().includes(t.replace(/_/g, " ").split(" ")[0])
        );
        // Always include a few common trades
        const tradesToQuery = Array.from(new Set([...mentionedTrades, "demolition", "mep"])).slice(0, 3);

        const pricingRows: string[] = [];
        for (const trade of tradesToQuery) {
          const rows = await storage.getRecentPricing(trade, 5);
          for (const row of rows) {
            const dateStr = row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : "";
            pricingRows.push(`${row.trade} | ${row.scopeKeyword} | $${row.subCost} | ${row.city || ""} | ${dateStr}`);
          }
        }

        if (pricingRows.length > 0) {
          const contextStr = pricingRows.slice(0, 8).join("\n");
          // Keep under 500 chars
          pricingContext = "\nRECENT PRICING DATA (from your actual projects):\n" + contextStr + "\n";
        }
      } catch {
        // pricing history lookup failure is non-fatal
      }

      // Build the final user prompt with injected context
      let finalPrompt = prompt;
      let systemPrompt = AI_SYSTEM_PROMPT;

      if (isEditMode && existingEstimate) {
        systemPrompt = AI_REWRITE_SYSTEM_PROMPT;

        // Build compact existing line items context (50 chars per scope)
        const compactItems = existingLineItems
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(li => `${li.phaseGroup} | ${li.scopeDescription || ""} | $${li.subCost}`)
          .join("\n");

        // Limit ai_log to last 500 chars
        const recentLog = aiLog;

        // Build context block, total capped at 2000 chars
        let contextBlock = "";
        contextBlock += "EXISTING ESTIMATE CONTEXT BELOW. Make MINIMAL changes — only modify what the user specifically asked to change. Keep all other line items, prices, and scope descriptions exactly as they are. Do not rewrite the entire estimate.\n\n";
        contextBlock += `CLIENT: ${existingEstimate.clientName || ""} | ${existingEstimate.city || ""}\n`;
        contextBlock += `CURRENT LINE ITEMS:\n${compactItems}\n`;
        if (recentLog) {
          contextBlock += `\nAI INTERACTION LOG (recent):\n${recentLog}\n`;
        }
        if (pricingContext) {
          contextBlock += pricingContext;
        }

        // Cap total context at 2000 chars
        contextBlock = contextBlock.slice(0, 2000);

        finalPrompt = contextBlock + "\nUSER REQUEST: " + prompt;
      } else {
        // New estimate: just append pricing context to prompt
        if (pricingContext) {
          finalPrompt = pricingContext + "\n" + prompt;
        }
      }

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{ role: "user", content: finalPrompt }],
        system: systemPrompt,
      });

      // Extract text content from the response
      const textBlock = message.content.find((block: any) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).json({ error: "No text response from AI" });
      }

      // Parse the JSON from the response
      const responseText = textBlock.text;
      // Try to extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "Could not parse AI response as JSON" });
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Append to ai_log if estimateId was provided
      if (estimateId) {
        try {
          const id = parseInt(String(estimateId));
          const now = new Date();
          const dateStr = now.toISOString().slice(0, 10);
          const timeStr = now.toTimeString().slice(0, 5);
          const promptSummary = prompt.slice(0, 100);
          const logEntry = `[${dateStr} ${timeStr}] GEN: ${promptSummary}\n`;
          await storage.updateEstimateAiLog(id, logEntry);
        } catch {
          // non-fatal
        }
      }

      res.json(parsed);
    } catch (err: any) {
      console.error("AI generation error:", err);
      res.status(500).json({ error: err.message || "AI generation failed" });
    }
  });

  // AI Breakdown endpoint — break a grouped line item total into per-trade amounts
  app.post("/api/ai/breakdown", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const { phaseGroup, totalSubCost, scopeDescription, city } = req.body;
      if (!phaseGroup || totalSubCost === undefined) {
        return res.status(400).json({ error: "phaseGroup and totalSubCost are required" });
      }

      // Get recent pricing history for context
      let pricingContext = "No recent pricing data available.";
      try {
        const pricingRows = await storage.getAllRecentPricing(30);
        if (pricingRows.length > 0) {
          const lines = pricingRows.map(r =>
            `${r.trade} | ${r.scopeKeyword} | $${r.subCost} | ${r.city || ""}`
          ).join("\n");
          pricingContext = `RECENT PRICING DATA:\n${lines}`;
        }
      } catch {
        // non-fatal
      }

      const prompt = `Break down this ${phaseGroup} total sub cost of $${totalSubCost} into per-trade amounts.

Scope: ${(scopeDescription || "").slice(0, 500) || "Not provided"}
Location: ${city || "Los Angeles"}

${pricingContext}

Return ONLY valid JSON array with no extra text or markdown:
[{"tradeName": "Plumbing", "subCost": 3000}, {"tradeName": "Electrical", "subCost": 2500}, ...]

The sum MUST equal exactly $${totalSubCost}. Use realistic proportions based on the scope and any pricing history provided. Include only the trades relevant to ${phaseGroup}.`;

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b: any) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).json({ error: "No text response from AI" });
      }

      // Parse JSON array from response
      const rawText = textBlock.text.trim();
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "Could not parse AI response as JSON array" });
      }

      const breakdowns = JSON.parse(jsonMatch[0]) as Array<{ tradeName: string; subCost: number }>;

      // Normalize so sum equals totalSubCost exactly
      const rawSum = breakdowns.reduce((s, b) => s + (b.subCost || 0), 0);
      let normalizedBreakdowns = breakdowns.map(b => ({
        tradeName: b.tradeName,
        subCost: Math.round(b.subCost || 0),
        notes: "",
      }));
      if (rawSum !== 0 && Math.abs(rawSum - totalSubCost) > 1) {
        const scale = totalSubCost / rawSum;
        let runningSum = 0;
        normalizedBreakdowns = normalizedBreakdowns.map((b, i) => {
          if (i === normalizedBreakdowns.length - 1) {
            return { ...b, subCost: Math.round(totalSubCost - runningSum) };
          }
          const scaled = Math.round(b.subCost * scale);
          runningSum += scaled;
          return { ...b, subCost: scaled };
        });
      }

      res.json({ breakdowns: normalizedBreakdowns });
    } catch (err: any) {
      console.error("AI breakdown error:", err);
      res.status(500).json({ error: err.message || "AI breakdown failed" });
    }
  });

  // Market rates reference data
  const MARKET_RATES: Record<string, Record<string, { low: number; mid: number; high: number; unit: string }>> = {
    "Plumbing": {
      "bathroom_same": { low: 2500, mid: 3500, high: 5200, unit: "per room" },
      "bathroom_new": { low: 5500, mid: 7500, high: 18000, unit: "per room" },
      "kitchen_same": { low: 2000, mid: 3500, high: 6000, unit: "per room" },
    },
    "Electrical": {
      "bathroom": { low: 800, mid: 1500, high: 3000, unit: "per room" },
      "kitchen": { low: 1200, mid: 2000, high: 4000, unit: "per room" },
    },
    "Demolition": {
      "bathroom_guest": { low: 800, mid: 1200, high: 1400, unit: "per room" },
      "bathroom_primary": { low: 1400, mid: 2200, high: 4500, unit: "per room" },
      "kitchen_small": { low: 900, mid: 1500, high: 2800, unit: "per room" },
    },
    "HVAC": {
      "system": { low: 4000, mid: 8000, high: 12000, unit: "per system" },
    },
    "Drywall": {
      "per_sf_l4": { low: 4.75, mid: 5.75, high: 6.75, unit: "per SF L+M" },
      "per_sf_l5": { low: 5.50, mid: 6.50, high: 7.75, unit: "per SF L+M" },
    },
    "Paint": {
      "per_room": { low: 500, mid: 1000, high: 1800, unit: "per room" },
    },
    "Insulation": {
      "wall": { low: 4, mid: 6, high: 8, unit: "per SF" },
    },
    "Tile/Stone": {
      "floor": { low: 7, mid: 12, high: 20, unit: "per SF labor" },
      "shower_wall": { low: 10, mid: 16, high: 25, unit: "per SF labor" },
    },
    "Framing": {
      "bathroom": { low: 600, mid: 1200, high: 2500, unit: "per room L+M" },
      "kitchen": { low: 1800, mid: 2800, high: 4500, unit: "per room L+M" },
    },
  };

  app.get("/api/market-rates", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const trade = (req.query.trade as string || "").trim();
      if (!trade) {
        return res.json({ rates: null, tradeName: trade });
      }

      // Case-insensitive partial match
      const tradeLower = trade.toLowerCase();
      const matchedKey = Object.keys(MARKET_RATES).find(k =>
        k.toLowerCase() === tradeLower ||
        k.toLowerCase().includes(tradeLower) ||
        tradeLower.includes(k.toLowerCase())
      );

      if (!matchedKey) {
        return res.json({ rates: null, tradeName: trade });
      }

      const subRates = MARKET_RATES[matchedKey];
      // Aggregate: use the overall min low, max high, and average mid
      const allRates = Object.values(subRates);
      const low = Math.min(...allRates.map(r => r.low));
      const high = Math.max(...allRates.map(r => r.high));
      const mid = Math.round(allRates.reduce((s, r) => s + r.mid, 0) / allRates.length);
      const unit = allRates[0].unit;

      res.json({ rates: { low, mid, high, unit }, tradeName: matchedKey, subRates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
