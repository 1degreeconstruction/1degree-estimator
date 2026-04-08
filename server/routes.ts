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
    const publicRoutes = [
      { method: "GET", pattern: /^\/api\/estimates\/public\// },
      { method: "POST", pattern: /^\/api\/estimates\/public\/.*\/sign$/ },
      { method: "GET", pattern: /^\/api\/reviews$/ },
      { method: "GET", pattern: /^\/api\/places\// },
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

      const [salesRep, items, milestones, events] = await Promise.all([
        storage.getSalesRep(estimate.salesRepId),
        storage.getLineItems(id),
        storage.getMilestones(id),
        storage.getEvents(id),
      ]);

      res.json({ ...estimate, salesRep, lineItems: items, milestones, events });
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
          await storage.createLineItem({
            estimateId: estimate.id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            customPhaseLabel: item.customPhaseLabel || null,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
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
        sentAt: isSending ? now : undefined,
      });

      if (!estimate) return res.status(404).json({ error: "Not found" });

      // Replace line items
      await storage.deleteLineItemsByEstimate(id);
      if (items && items.length > 0) {
        for (const item of items) {
          await storage.createLineItem({
            estimateId: id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            customPhaseLabel: item.customPhaseLabel || null,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
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
  app.get("/api/places/autocomplete", async (req, res) => {
    const input = (req.query.input as string) || "";
    if (!input || input.length < 3) return res.json({ predictions: [] });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({ predictions: [] });

    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:us&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json() as any;
      res.json({ predictions: data.predictions || [] });
    } catch {
      res.json({ predictions: [] });
    }
  });

  app.get("/api/places/detail", async (req, res) => {
    const placeId = (req.query.place_id as string) || "";
    if (!placeId) return res.json({});

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({});

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=address_components,formatted_address&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json() as any;
      res.json(data);
    } catch {
      res.json({});
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
- First milestone is always "Deposit upon acceptance" — amount should be lesser of $1,000 or 10% of total CLIENT price (which is subCost * 2 + 3% allowance)
- Remaining milestones based on construction phases
- Milestone amounts must sum to total CLIENT price (remember: the system doubles your sub costs and adds 3%)
- Calculate: totalClientPrice = (sum of all subCosts * 2) * 1.03
- Then set deposit = min(1000, totalClientPrice * 0.10)
- Distribute remaining (totalClientPrice - deposit) across 2-3 milestones, front-loaded

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
  "lineItems": [
    {
      "phaseGroup": "general_conditions|demolition|framing|mep|insulation_drywall_paint|tile_finish_carpentry|permit_design|planning|other",
      "customPhaseLabel": "only if phaseGroup is other, otherwise null",
      "scopeDescription": "detailed scope text with bullet points",
      "subCost": number,
      "isGrouped": true/false
    }
  ],
  "milestones": [
    { "milestoneName": "string", "amount": number }
  ],
  "notesInternal": "internal notes"
}`;

  app.post("/api/ai/generate-estimate", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        system: AI_SYSTEM_PROMPT,
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
      res.json(parsed);
    } catch (err: any) {
      console.error("AI generation error:", err);
      res.status(500).json({ error: err.message || "AI generation failed" });
    }
  });

  return httpServer;
}
