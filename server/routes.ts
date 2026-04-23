import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { pricingHistory } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { format, addDays } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";
import {
  sendGmailEmail,
  buildEstimateEmail,
  buildFollowUpEmail,
  buildClientViewedEmail,
  buildClientSignedEmail,
  pollTeamInbox,
} from "./emailService";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cors from "cors";
import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import Tesseract from "tesseract.js";
// sharp removed — Render free tier can't build native bindings
import { PDFParse } from "pdf-parse";

// Supabase client for file storage
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG, and PNG files are allowed"));
    }
  },
});

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
  "1dcestimatesdonotreply@gmail.com": "admin",
};

// JWT Auth middleware
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string; role: string; orgId?: number; orgRole?: string };
    const user = await storage.getUser(payload.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });
    req.user = user as Express.User;
    (req as any).orgId = payload.orgId || 1;
    (req as any).orgRole = payload.orgRole || user.role;
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

function getStreetInitials(address: string): string {
  // Extract street number and street name initials
  // "6255 Gaston Pl" -> "6255GP"
  // "585 Roosevelt Ct" -> "585RC"
  const parts = address.trim().split(/\s+/);
  const streetNum = parts[0]?.replace(/\D/g, '') || '';
  const nameInitials = parts.slice(1)
    .filter(w => w.length > 0)
    .map(w => w[0].toUpperCase())
    .join('');
  return `${streetNum}${nameInitials}`;
}

function getClientInitials(name: string): string {
  // "Minji Kim" -> "MK", "Eddie Nolasco" -> "EN"
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('');
}

async function generateEstimateNumber(clientName: string, projectAddress: string, orgId?: number): Promise<string> {
  const now = new Date();
  const dateStr = format(now, "MMddyyyy");
  const streetInit = getStreetInitials(projectAddress);
  const clientInit = getClientInitials(clientName);

  // Count existing estimates for this client
  const existing = await storage.getEstimates(undefined, orgId);
  const clientEstimates = existing.filter(e =>
    e.clientName?.toLowerCase() === clientName.toLowerCase()
  );
  const count = clientEstimates.length + 1;

  // Format: 585RC-MK-04082026-1
  return `${streetInit}-${clientInit}-${dateStr}-${count}`;
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
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || "";
        const name = profile.displayName || "";
        const avatarUrl = profile.photos?.[0]?.value || null;

        // Look up existing user
        let user = await storage.getUserByGoogleId(googleId);

        if (user) {
          // Update last login + store fresh tokens
          const tokenUpdates: Partial<User> = { lastLoginAt: new Date(), googleAccessToken: accessToken };
          if (refreshToken) tokenUpdates.googleRefreshToken = refreshToken;
          // Re-check membership in case user was added to an org after initial sign-in
          if (!user.isActive) {
            const memCheck = await db.execute(sql`
              SELECT 1 FROM org_memberships WHERE user_id = ${user.id} AND is_active = true LIMIT 1
            `);
            if (memCheck.rows.length > 0) tokenUpdates.isActive = true;
          }
          user = await storage.updateUser(user.id, tokenUpdates);
          return done(null, user as Express.User);
        }

        // New user — check if pre-approved OR has a pending org membership
        const preApprovedRole = PRE_APPROVED_EMAILS[email.toLowerCase()];
        // Also check if this email was invited to any org
        const pendingMembership = await db.execute(sql`
          SELECT m.role FROM org_memberships m JOIN users u ON u.id = m.user_id
          WHERE u.email = ${email.toLowerCase()} AND m.is_active = true LIMIT 1
        `);
        const hasMembership = pendingMembership.rows.length > 0;
        const isActive = !!preApprovedRole || hasMembership;
        const role = preApprovedRole || (hasMembership ? (pendingMembership.rows[0] as any).role : "estimator");

        // Check if a placeholder user exists (from invite)
        const existingByEmail = await storage.getUserByEmail(email);
        let newUser;
        if (existingByEmail) {
          // Update placeholder with real Google credentials
          newUser = await storage.updateUser(existingByEmail.id, {
            googleId, name, avatarUrl, role, isActive,
            lastLoginAt: new Date(),
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken || null,
          });
        } else {
          newUser = await storage.createUser({
            googleId, email, name, avatarUrl, role, isActive,
            createdAt: new Date(),
            lastLoginAt: new Date(),
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken || null,
          });
        }

        return done(null, newUser as Express.User);
      } catch (err) {
        return done(err as Error);
      }
    }
  ));

  // ─── Usage Tracker Helper ───────────────────────────────────────────────
  async function trackUsage(service: string, action: string, userId?: number, metadata?: string) {
    db.execute(sql`INSERT INTO usage_stats (service, action, user_id, metadata, created_at) VALUES (${service}, ${action}, ${userId || null}, ${metadata || null}, NOW())`).catch(() => {});
  }

  // ─── Global Error Logger ─────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      if (res.statusCode >= 400 && body?.error) {
        const userId = (req as any).user?.id || null;
        db.execute(sql`INSERT INTO error_log (route, method, status, error_message, user_id, created_at)
          VALUES (${req.originalUrl}, ${req.method}, ${res.statusCode}, ${String(body.error).slice(0, 2000)}, ${userId}, NOW())`
        ).catch(() => {});
      }
      return originalJson(body);
    };
    next();
  });

  // --- Auth Routes ---

  app.get("/auth/google", passport.authenticate("google", {
    scope: ["profile", "email", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.readonly"],
    accessType: "offline",
    prompt: "consent",
    session: false,
  } as any));

  app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login", session: false }),
    async (req, res) => {
      const user = req.user as Express.User;
      const frontendUrl = process.env.FRONTEND_URL || "https://1degree-estimator.vercel.app";

      if (!user.isActive) {
        return res.redirect(`${frontendUrl}/#/?error=pending_approval`);
      }

      // Look up org membership for JWT
      const memRows = await db.execute(sql`
        SELECT org_id, role FROM org_memberships
        WHERE user_id = ${user.id} AND is_active = true
        ORDER BY created_at LIMIT 1
      `);
      const orgId = memRows.rows.length > 0 ? (memRows.rows[0] as any).org_id : 1;
      const orgRole = memRows.rows.length > 0 ? (memRows.rows[0] as any).role : user.role;

      // Issue a JWT valid for 7 days
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role, orgId, orgRole },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.redirect(`${frontendUrl}/#/auth/callback?token=${token}`);
    }
  );

  app.get("/auth/me", requireAuth as any, (req, res) => {
    const { googleAccessToken, googleRefreshToken, ...safe } = req.user as any;
    return res.json(safe);
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
      { method: "GET", pattern: /^\/estimates\/public\/.*\/messages$/ },
      { method: "POST", pattern: /^\/estimates\/public\/.*\/messages$/ },
      { method: "POST", pattern: /^\/estimates\/public\/.*\/track-download$/ },
    ];

    for (const route of publicRoutes) {
      if (req.method === route.method && route.pattern.test(req.path)) {
        return next();
      }
    }

    return (requireAuth as any)(req, res, next);
  });

  // Sales Reps
  app.get("/api/sales-reps", async (req, res) => {
    try {
      const reps = await storage.getSalesReps((req as any).orgId);
      res.json(reps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Daily Color System ──────────────────────────────────────────────

  function generateDailyColor(dateStr: string, recentColors: string[]): string {
    // Generate candidates deterministically from date seed
    const seed = dateStr.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const candidates: string[] = [];
    for (let i = 0; i < 20; i++) {
      const h = ((seed * 137 + i * 97) % 360);
      const s = 55 + ((seed * 13 + i * 31) % 30); // 55-85%
      const l = 45 + ((seed * 7 + i * 19) % 20);  // 45-65%
      // HSL to hex
      const hslToHex = (h: number, s: number, l: number) => {
        s /= 100; l /= 100;
        const k = (n: number) => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
        return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, "0")).join("")}`;
      };
      candidates.push(hslToHex(h, s, l));
    }

    // Color distance function (RGB euclidean)
    const hexToRgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const colorDist = (a: string, b: string) => {
      const [r1, g1, b1] = hexToRgb(a);
      const [r2, g2, b2] = hexToRgb(b);
      return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
    };

    // Score each candidate: maximize contrast vs recent colors (yesterday weighted highest)
    let bestColor = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
      let score = 0;
      if (recentColors.length > 0) {
        score += colorDist(c, recentColors[0]) * 3; // yesterday = 3x weight
      }
      for (let i = 1; i < recentColors.length; i++) {
        score += colorDist(c, recentColors[i]);
      }
      // Penalize too-similar to any recent
      const minDist = recentColors.length > 0 ? Math.min(...recentColors.map(r => colorDist(c, r))) : 999;
      if (minDist < 80) score -= 500;
      if (score > bestScore) { bestScore = score; bestColor = c; }
    }
    return bestColor;
  }

  // GET /api/daily-color?date=YYYY-MM-DD (defaults to today)
  app.get("/api/daily-color", async (req, res) => {
    try {
      const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      // Check if color already exists — immutable once set
      const existing = await db.execute(sql`SELECT hex_color FROM daily_colors WHERE date = ${dateStr}`);
      if (existing.rows.length > 0) {
        return res.json({ date: dateStr, color: (existing.rows[0] as any).hex_color });
      }

      // Fetch last 5 days of colors for contrast comparison
      const recent = await db.execute(sql`SELECT hex_color FROM daily_colors ORDER BY date DESC LIMIT 5`);
      const recentColors = recent.rows.map((r: any) => r.hex_color);

      // Generate and persist
      const color = generateDailyColor(dateStr, recentColors);
      await db.execute(sql`INSERT INTO daily_colors (date, hex_color) VALUES (${dateStr}, ${color}) ON CONFLICT (date) DO NOTHING`);

      res.json({ date: dateStr, color });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/daily-colors?from=YYYY-MM-DD&to=YYYY-MM-DD — batch fetch
  app.get("/api/daily-colors", async (req, res) => {
    try {
      const rows = await db.execute(sql`SELECT date, hex_color FROM daily_colors ORDER BY date DESC LIMIT 60`);
      const map: Record<string, string> = {};
      for (const r of rows.rows as any[]) map[r.date] = r.hex_color;
      res.json(map);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Estimates - list (supports ?mine=true)
  app.get("/api/estimates", async (req, res) => {
    try {
      const mine = req.query.mine === "true";
      const userId = mine && req.user ? (req.user as Express.User).id : undefined;

      const estimatesList = await storage.getEstimates(userId, (req as any).orgId);
      const reps = await storage.getSalesReps((req as any).orgId);
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

      // Check if this is a team preview (authenticated user) vs real client view
      let isTeamPreview = false;
      try {
        const authHeader = req.headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
          if (payload.userId) isTeamPreview = true;
        }
      } catch { /* not authenticated = real client */ }

      if (!isTeamPreview) {
        // Log view event — first view changes status, every view logs activity
        const viewedAt = new Date();
        if (estimate.status === "sent") {
          await storage.updateEstimate(estimate.id, { status: "viewed", viewedAt });
        }

        // Capture viewer details
        const viewerIp = req.headers["x-forwarded-for"] || req.ip || "unknown";
        const userAgent = req.headers["user-agent"] || "";
        const referer = req.headers["referer"] || "";
        const isMobile = /mobile|iphone|android/i.test(userAgent);
        const browser = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/i)?.[1] || "Unknown";
        const viewMeta = JSON.stringify({ ip: viewerIp, userAgent: userAgent.slice(0, 200), browser, isMobile, referer: referer.slice(0, 200) });

        await storage.createEvent({ estimateId: estimate.id, eventType: "viewed", timestamp: viewedAt, metadata: viewMeta }).catch(() => {});
        await storage.logEmail({
          estimateId: estimate.id,
          recipientEmail: "team",
          fromEmail: estimate.clientEmail || "",
          fromName: estimate.clientName,
          subject: `\uD83D\uDC40 ${estimate.clientName} viewed estimate ${estimate.estimateNumber}`,
          bodyPreview: `${estimate.clientName} opened from ${browser}${isMobile ? " (mobile)" : ""} · IP: ${typeof viewerIp === "string" ? viewerIp : (viewerIp as string[])[0]}`,
          direction: "inbound",
          emailType: "internal_notification",
          status: "received",
          isRead: false,
          sentAt: viewedAt,
        }).catch(() => {});
      }

      const [salesRep, items, milestones] = await Promise.all([
        storage.getSalesRep(estimate.salesRepId),
        storage.getLineItems(estimate.id),
        storage.getMilestones(estimate.id),
      ]);

      // Strip internal costs for client view
      const clientItems = items.map(({ subCost, ...item }) => item);

      // Pre-calculate all discount display values server-side
      const e = estimate as any;
      const hasApparentDiscount = e.apparentDiscountType && e.apparentDiscountValue > 0;
      const hasRealDiscount = e.realDiscountType && e.realDiscountValue > 0;
      let originalTotal = estimate.totalClientPrice;
      let totalSavings = 0;

      if (hasApparentDiscount) {
        if (e.apparentDiscountType === "percent") {
          originalTotal = Math.round(estimate.totalClientPrice / (1 - e.apparentDiscountValue / 100) * 100) / 100;
        } else {
          originalTotal = estimate.totalClientPrice + e.apparentDiscountValue;
        }
        totalSavings = originalTotal - estimate.totalClientPrice;
      }
      if (hasRealDiscount) {
        if (e.realDiscountType === "percent") {
          const preReal = Math.round(estimate.totalClientPrice / (1 - e.realDiscountValue / 100) * 100) / 100;
          totalSavings += preReal - estimate.totalClientPrice;
          if (!hasApparentDiscount) originalTotal = preReal;
        } else {
          totalSavings += e.realDiscountValue;
          if (!hasApparentDiscount) originalTotal = estimate.totalClientPrice + e.realDiscountValue;
        }
      }

      const savingsPctRaw = originalTotal > 0 ? (totalSavings / originalTotal) * 100 : 0;
      const savingsPct = Math.round(savingsPctRaw * 10) / 10;

      // Pre-calculate discounted price per line item
      const clientItemsWithDiscount = clientItems.map((item: any) => {
        if (totalSavings > 0 && originalTotal > 0) {
          const share = item.clientPrice / originalTotal;
          const itemSavings = Math.round(totalSavings * share * 100) / 100;
          return { ...item, originalPrice: item.clientPrice, discountedPrice: Math.round((item.clientPrice - itemSavings) * 100) / 100 };
        }
        return { ...item, originalPrice: item.clientPrice, discountedPrice: item.clientPrice };
      });

      res.json({
        ...estimate,
        totalSubCost: undefined,
        salesRep,
        lineItems: clientItemsWithDiscount,
        milestones,
        // Discount display values — no client-side math needed
        discount: totalSavings > 0 ? {
          originalTotal,
          totalSavings,
          savingsPct,
          savingsPctLabel: savingsPct % 1 === 0 ? savingsPct.toFixed(0) : savingsPct.toFixed(1),
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Google Calendar ────────────────────────────────────────────────────

  app.get("/api/calendar/recent", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      if (!user.googleAccessToken) return res.status(403).json({ error: "No Google token. Sign out and back in." });

      const { OAuth2Client } = await import("google-auth-library");
      const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID || "124225853613-okfnb5gconblb1bhtr4tnloj3n4d77m8.apps.googleusercontent.com",
        process.env.GOOGLE_CLIENT_SECRET || "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"
      );
      client.setCredentials({ access_token: user.googleAccessToken, refresh_token: user.googleRefreshToken || undefined });

      const { token } = await client.getAccessToken();
      const days = parseInt(req.query.days as string) || 7;
      const timeMin = new Date(Date.now() - days * 86400000).toISOString();
      const timeMax = new Date().toISOString();

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=30`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!calRes.ok) {
        const body = await calRes.text();
        return res.status(calRes.status).json({ error: `Calendar API ${calRes.status}: ${body.slice(0, 200)}` });
      }

      const calData = await calRes.json();
      const events = (calData.items || []).map((e: any) => {
        // Extract useful info from event
        const attendees = (e.attendees || []).filter((a: any) => !a.self).map((a: any) => ({
          name: a.displayName || "",
          email: a.email || "",
        }));

        // Try to extract address from location
        const location = e.location || "";

        // Try to extract phone from description
        const desc = e.description || "";
        const phoneMatch = desc.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);

        return {
          id: e.id,
          summary: e.summary || "(No title)",
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location,
          description: desc.slice(0, 500),
          attendees,
          phone: phoneMatch ? phoneMatch[1] : null,
        };
      });

      // Most recent first
      events.reverse();
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ai/recalc-milestones — AI fills in amounts for milestone names
  app.post("/api/ai/recalc-milestones", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const { totalClientPrice, milestones } = req.body;
      if (!totalClientPrice || !milestones?.length) return res.status(400).json({ error: "totalClientPrice and milestones required" });

      const total = Number(totalClientPrice);
      const count = milestones.length;

      // Deposit: lesser of $1,000 or 10%
      const deposit = Math.min(1000, Math.round(total * 0.1 * 100) / 100);

      // Retention: 10% of total
      const retention = Math.round(total * 0.1 * 100) / 100;

      // Progress budget
      const progressBudget = total - deposit - retention;
      const progressCount = Math.max(count - 2, 1); // exclude deposit + retention

      // Distribute top-heavy: first progress gets more, last gets less
      const progressAmounts: number[] = [];
      let remaining = progressBudget;
      for (let i = 0; i < progressCount; i++) {
        const weight = (progressCount - i) / ((progressCount * (progressCount + 1)) / 2);
        let amt = progressBudget * weight;
        // Round to nearest $500 if >$5K, $100 if <$5K
        amt = amt >= 5000 ? Math.round(amt / 500) * 500 : Math.round(amt / 100) * 100;
        progressAmounts.push(amt);
        remaining -= amt;
      }

      // Build result keeping original names
      const result = milestones.map((m: any, i: number) => {
        if (i === 0) return { name: m.name, amount: deposit };
        if (i === count - 1) {
          // Retention absorbs all rounding
          const othersSum = deposit + progressAmounts.reduce((s, a) => s + a, 0);
          return { name: m.name, amount: Math.round((total - othersSum) * 100) / 100 };
        }
        return { name: m.name, amount: progressAmounts[i - 1] || 0 };
      });

      res.json({ milestones: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/calendar/parse-event — AI extracts client info from calendar event
  app.post("/api/calendar/parse-event", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const { event } = req.body;
      if (!event) return res.status(400).json({ error: "event is required" });

      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: `Extract client contact information from this calendar event. The event may contain a client's name, email, phone number, and project address in various formats — in the title, description, location, or attendee list.

Calendar event:
Title: ${event.summary || ""}
Location: ${event.location || ""}
Description: ${event.description || ""}
Attendees: ${JSON.stringify(event.attendees || [])}

Return ONLY a JSON object with these fields (use empty string if not found):
{"clientName": "", "clientEmail": "", "clientPhone": "", "projectAddress": "", "city": "", "state": "", "zip": ""}

Rules:
- Ignore any 1 Degree Construction team emails (david@, thai@, oliver@, 1degree)
- The client name should be a person's name, not a company or event title
- If the location looks like a street address, use it as projectAddress and parse city/state/zip
- Phone numbers can appear anywhere in the description
- Return ONLY the JSON, no explanation`
        }],
      });

      trackUsage("claude_ai", "parse_calendar_event", (req as any).user?.id);
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(422).json({ error: "Could not parse" });
      res.json(JSON.parse(jsonMatch[0]));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Contacts / Client Directory ───────────────────────────────────────────

  app.get("/api/contacts", requireAuth as any, async (req: Request, res: Response) => {
    try { res.json(await storage.getContacts((req as any).orgId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/contacts/search", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || "";
      res.json(await storage.searchContacts(q, (req as any).orgId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/contacts/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const contact = await storage.getContact(parseInt(req.params.id));
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const estimates = await storage.getEstimatesForContact(contact.name, contact.email || undefined, (req as any).orgId);
      res.json({ contact, estimates });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/contacts", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      const contact = await storage.createContact({ ...req.body, createdByUserId: user.id, createdAt: new Date() });
      res.json(contact);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/contacts/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const contact = await storage.updateContact(parseInt(req.params.id), req.body);
      if (!contact) return res.status(404).json({ error: "Not found" });
      res.json(contact);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/contacts/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      await storage.deleteContact(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/estimates/:id — delete an estimate and all related data
  app.delete("/api/estimates/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user as User;
      if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      await storage.deleteEstimate(id);
      res.json({ ok: true, deleted: estimate.estimateNumber });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Estimate Chat/Messages ────────────────────────────────────────────────

  // GET messages for an estimate (PUBLIC - client can see)
  app.get("/api/estimates/public/:uniqueId/messages", async (req, res) => {
    try {
      const estimate = await storage.getEstimateByUniqueId(req.params.uniqueId);
      if (!estimate) return res.status(404).json({ error: "Not found" });
      const messages = await storage.getMessages(estimate.id);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST message from CLIENT (PUBLIC - no auth)
  app.post("/api/estimates/public/:uniqueId/messages", async (req, res) => {
    try {
      const estimate = await storage.getEstimateByUniqueId(req.params.uniqueId);
      if (!estimate) return res.status(404).json({ error: "Not found" });
      const { senderName, message } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: "Message required" });

      const msg = await storage.createMessage({
        estimateId: estimate.id,
        senderType: "client",
        senderName: senderName || estimate.clientName || "Client",
        message: message.trim(),
        isRead: false,
        createdAt: new Date(),
      });

      // Log to inbox so team sees it
      await storage.logEmail({
        estimateId: estimate.id,
        recipientEmail: "team",
        fromEmail: estimate.clientEmail || "",
        fromName: senderName || estimate.clientName,
        subject: `\uD83D\uDCAC New message on estimate ${estimate.estimateNumber}`,
        bodyPreview: message.trim().slice(0, 300),
        direction: "inbound",
        emailType: "client_reply",
        status: "received",
        isRead: false,
        sentAt: new Date(),
      }).catch(() => {});

      // Email all sales reps about the new message (from team inbox account)
      try {
        const teamAccessToken = await storage.getConfig("team_access_token");
        const teamRefreshToken = await storage.getConfig("team_refresh_token");
        const teamEmail = await storage.getConfig("team_gmail_email");
        if (teamAccessToken && teamEmail) {
          const reps = await storage.getSalesReps((req as any).orgId);
          const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
          const chatUrl = `${appUrl}/#/chat`;
          const clientLabel = senderName || estimate.clientName || "A client";

          for (const rep of reps) {
            const html = `<div style="font-family:sans-serif;max-width:600px;">
              <p style="margin:0 0 12px;font-size:15px;color:#333;"><strong>${clientLabel}</strong> sent a message on estimate <strong>${estimate.estimateNumber}</strong>:</p>
              <div style="background:#f5f5f5;border-left:3px solid #e87722;padding:12px 16px;margin:0 0 20px;border-radius:4px;">
                <p style="margin:0;font-size:14px;color:#555;white-space:pre-wrap;">${message.trim()}</p>
              </div>
              <p style="margin:0 0 4px;font-size:13px;color:#888;">Project: ${estimate.projectAddress}</p>
              <a href="${chatUrl}" style="display:inline-block;margin-top:12px;background:#e87722;color:#fff;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">Reply in App</a>
            </div>`;

            await sendGmailEmail({
              senderName: "1 Degree Estimates",
              senderEmail: teamEmail,
              accessToken: teamAccessToken,
              refreshToken: teamRefreshToken,
              to: rep.email,
              subject: `New message from ${clientLabel} - ${estimate.estimateNumber}`,
              html,
            }).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }

      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET messages for an estimate (TEAM - auth required, by estimate ID)
  app.get("/api/estimates/:id/messages", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const messages = await storage.getMessages(id);
      // Mark client messages as read when team views them
      await storage.markMessagesRead(id, "client");
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST message from TEAM (auth required)
  app.post("/api/estimates/:id/messages", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user as User;
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ error: "Message required" });

      const msg = await storage.createMessage({
        estimateId: id,
        senderType: "team",
        senderName: user.name,
        senderUserId: user.id,
        message: message.trim(),
        isRead: false,
        createdAt: new Date(),
      });

      // Email the client that the team responded
      try {
        const estimate = await storage.getEstimate(id);
        if (estimate?.clientEmail) {
          const teamAccessToken = await storage.getConfig("team_access_token");
          const teamRefreshToken = await storage.getConfig("team_refresh_token");
          const teamEmail = await storage.getConfig("team_gmail_email");
          if (teamAccessToken && teamEmail) {
            const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
            const viewUrl = `${appUrl}/#/estimate/${estimate.uniqueId}`;
            const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#0a0a0a;padding:24px 32px;border-radius:8px 8px 0 0;">
                <div style="color:#e87722;font-size:20px;font-weight:700;">1 Degree Construction</div>
              </div>
              <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin:0 0 8px;font-size:15px;color:#333;">Hi ${estimate.clientName},</p>
                <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
                  ${user.name} from 1 Degree Construction responded to your message regarding estimate <strong>${estimate.estimateNumber}</strong>.
                </p>
                <div style="background:#f5f5f5;border-left:3px solid #e87722;padding:12px 16px;margin:0 0 24px;border-radius:4px;">
                  <p style="margin:0;font-size:14px;color:#555;white-space:pre-wrap;">${message.trim()}</p>
                </div>
                <div style="text-align:center;">
                  <a href="${viewUrl}" style="display:inline-block;background:#e87722;color:#fff;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">View Estimate & Reply</a>
                </div>
              </div>
            </div>`;

            const emailResult = await sendGmailEmail({
              senderName: "1 Degree Construction",
              senderEmail: teamEmail,
              accessToken: teamAccessToken,
              refreshToken: teamRefreshToken,
              to: estimate.clientEmail,
              subject: `1DC Direct Line Responded! - ${estimate.estimateNumber}`,
              html,
            }).catch((err: any) => { console.error("[chat-reply-email]", err.message); return null; });
            console.log(`[chat-reply-email] to=${estimate.clientEmail} result=${emailResult?.messageId || "FAILED"}`);
          }
        }
      } catch (err: any) { console.error("[chat-reply-email] outer:", err.message); }

      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET unread client message count (for team sidebar badge)
  app.get("/api/messages/unread", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const unread = await storage.getUnreadClientMessages((req as any).orgId);
      res.json({ count: unread.length, messages: unread });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Email Routes ──────────────────────────────────────────────────────────

  // POST /api/estimates/:id/send-email — send estimate to client
  app.post("/api/estimates/:id/send-email", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user as User;
      if (!user.googleAccessToken) {
        return res.status(403).json({ error: "No Gmail token. Please sign out and sign back in to grant email access." });
      }

      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      // Support multiple recipients: from body, or fall back to estimate's client email
      const extraEmails: string[] = req.body.emails || [];
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const allRecipients = [...new Set([estimate.clientEmail, ...extraEmails].filter(Boolean))] 
        .filter(e => emailRegex.test(e)) as string[];
      if (allRecipients.length === 0) return res.status(400).json({ error: "No recipient emails" });

      const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
      const viewUrl = `${appUrl}/#/estimate/${estimate.uniqueId}`;

      const { subject, html } = buildEstimateEmail({
        clientName: estimate.clientName,
        senderName: user.name,
        estimateNumber: estimate.estimateNumber,
        projectAddress: estimate.projectAddress,
        totalClientPrice: estimate.totalClientPrice,
        viewUrl,
        validUntil: estimate.validUntil || "",
      });

      const results: string[] = [];
      for (const recipient of allRecipients) {
        const { messageId } = await sendGmailEmail({
          senderName: user.name,
          senderEmail: user.email,
          accessToken: user.googleAccessToken,
          refreshToken: user.googleRefreshToken || null,
          to: recipient,
          subject,
          html,
        });
        results.push(messageId);

        await storage.logEmail({
          estimateId: id,
          sentByUserId: user.id,
          recipientEmail: recipient,
          fromEmail: user.email,
          fromName: user.name,
          subject,
          bodyPreview: `Estimate ${estimate.estimateNumber} sent to ${recipient}`,
          gmailMessageId: messageId,
          direction: "outbound",
          emailType: "estimate",
          status: "sent",
          isRead: true,
        });
      }

      // Mark estimate as sent if it was a draft
      if (estimate.status === "draft") {
        await storage.updateEstimate(id, { status: "sent", sentAt: new Date() });
      }

      // Capture version snapshot — same format as client-facing API response
      try {
        const snapItems = await storage.getLineItems(id);
        const snapMilestones = await storage.getPaymentMilestones(id);
        const snapEstimate = await storage.getEstimate(id);
        if (snapEstimate) {
          // Compute discount display values (mirrors public endpoint)
          const se = snapEstimate as any;
          const hasApp = se.apparentDiscountType && se.apparentDiscountValue > 0;
          const hasReal = se.realDiscountType && se.realDiscountValue > 0;
          let snapOriginal = snapEstimate.totalClientPrice;
          let snapSavings = 0;
          if (hasApp) {
            snapOriginal = se.apparentDiscountType === "percent"
              ? Math.round(snapEstimate.totalClientPrice / (1 - se.apparentDiscountValue / 100) * 100) / 100
              : snapEstimate.totalClientPrice + se.apparentDiscountValue;
            snapSavings = snapOriginal - snapEstimate.totalClientPrice;
          }
          if (hasReal) {
            if (se.realDiscountType === "percent") {
              const pre = Math.round(snapEstimate.totalClientPrice / (1 - se.realDiscountValue / 100) * 100) / 100;
              snapSavings += pre - snapEstimate.totalClientPrice;
              if (!hasApp) snapOriginal = pre;
            } else {
              snapSavings += se.realDiscountValue;
              if (!hasApp) snapOriginal = snapEstimate.totalClientPrice + se.realDiscountValue;
            }
          }
          const sPctRaw = snapOriginal > 0 ? (snapSavings / snapOriginal) * 100 : 0;
          const sPct = Math.round(sPctRaw * 10) / 10;

          const snapLineItems = snapItems.map((item: any) => {
            if (snapSavings > 0 && snapOriginal > 0) {
              const share = item.clientPrice / snapOriginal;
              const iSav = Math.round(snapSavings * share * 100) / 100;
              return { ...item, originalPrice: item.clientPrice, discountedPrice: Math.round((item.clientPrice - iSav) * 100) / 100 };
            }
            return { ...item, originalPrice: item.clientPrice, discountedPrice: item.clientPrice };
          });

          const discount = snapSavings > 0 ? { originalTotal: snapOriginal, totalSavings: snapSavings, savingsPct: sPct, savingsPctLabel: sPct % 1 === 0 ? sPct.toFixed(0) : sPct.toFixed(1) } : null;

          const versionCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM estimate_versions WHERE estimate_id = ${id}`);
          const nextVersion = parseInt((versionCount.rows[0] as any).cnt) + 1;
          await db.execute(sql`
            INSERT INTO estimate_versions (estimate_id, version_number, snapshot_json, changed_by_user_id, changed_at, change_summary, org_id)
            VALUES (${id}, ${nextVersion}, ${JSON.stringify({ estimate: snapEstimate, lineItems: snapLineItems, milestones: snapMilestones, discount })}::jsonb, ${user.id}, NOW(), ${`Sent to ${allRecipients.join(", ")}`}, ${se.orgId || 1})
          `);
        }
      } catch (snapErr: any) {
        console.error("[version-snapshot]", snapErr.message, snapErr.stack);
        try {
          await db.execute(sql`INSERT INTO error_log (route, method, status, error_message, stack, user_id, org_id) VALUES (${'version-snapshot'}, ${'POST'}, ${500}, ${snapErr.message || 'unknown'}, ${snapErr.stack?.slice(0, 2000) || ''}, ${user.id}, ${(req as any).orgId || 1})`);
        } catch {}
      }

      await storage.logActivity({
        estimateId: id,
        userId: user.id,
        action: "email_sent",
        details: `Estimate emailed to ${allRecipients.join(", ")} by ${user.name}`,
      });

      res.json({ ok: true, sentTo: allRecipients, messageIds: results });
    } catch (err: any) {
      console.error("[send-email] error:", err);
      res.status(500).json({ error: err.message || "Failed to send email" });
    }
  });

  // GET /api/estimates/:id/versions — get version history
  app.get("/api/estimates/:id/versions", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const versions = await db.execute(sql`
        SELECT v.*, u.name as changed_by_name
        FROM estimate_versions v LEFT JOIN users u ON u.id = v.changed_by_user_id
        WHERE v.estimate_id = ${id}
        ORDER BY v.version_number DESC
      `);
      res.json(versions.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/estimates/:id/versions/:versionNumber — get a single version's snapshot
  app.get("/api/estimates/:id/versions/:versionNumber", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const vNum = parseInt(req.params.versionNumber);
      const result = await db.execute(sql`
        SELECT v.*, u.name as changed_by_name
        FROM estimate_versions v LEFT JOIN users u ON u.id = v.changed_by_user_id
        WHERE v.estimate_id = ${id} AND v.version_number = ${vNum}
      `);
      if (result.rows.length === 0) return res.status(404).json({ error: "Version not found" });
      const version = result.rows[0] as any;
      // Return the snapshot in the same shape as the public estimate endpoint
      const snap = version.snapshot_json;
      res.json({
        ...snap.estimate,
        totalSubCost: undefined,
        salesRep: snap.estimate?.salesRep || null,
        lineItems: snap.lineItems || [],
        milestones: snap.milestones || [],
        discount: snap.discount || null,
        _version: { number: version.version_number, changedAt: version.changed_at, changedBy: version.changed_by_name, summary: version.change_summary },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/estimates/public/:uniqueId/track-download — track PDF download (public, no auth)
  app.post("/api/estimates/public/:uniqueId/track-download", async (req: Request, res: Response) => {
    try {
      const estimate = await storage.getEstimateByUniqueId(req.params.uniqueId);
      if (!estimate) return res.status(404).json({ error: "Not found" });

      const userAgent = req.headers["user-agent"] || "";
      const ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
      const meta = JSON.stringify({ ip: typeof ip === "string" ? ip : ip[0], userAgent: userAgent.slice(0, 200), versionNumber: req.body?.versionNumber || "current", source: "client" });
      await storage.createEvent({ estimateId: estimate.id, eventType: "pdf_downloaded", timestamp: new Date(), metadata: meta }).catch(() => {});

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/estimates/:id/track-download — track PDF download
  app.post("/api/estimates/:id/track-download", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { versionNumber } = req.body;
      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Not found" });

      // Log download event
      const userAgent = req.headers["user-agent"] || "";
      const ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
      const meta = JSON.stringify({ ip: typeof ip === "string" ? ip : ip[0], userAgent: userAgent.slice(0, 200), versionNumber: versionNumber || "current" });
      await storage.createEvent({ estimateId: id, eventType: "pdf_downloaded", timestamp: new Date(), metadata: meta }).catch(() => {});

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/estimates/:id/send-followup — manual follow-up email
  app.post("/api/estimates/:id/send-followup", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user as User;
      if (!user.googleAccessToken) {
        return res.status(403).json({ error: "No Gmail token. Please sign out and sign back in." });
      }

      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Not found" });
      if (!estimate.clientEmail) return res.status(400).json({ error: "No client email" });

      const daysSinceSent = estimate.sentAt
        ? Math.floor((Date.now() - new Date(estimate.sentAt).getTime()) / 86400000)
        : 0;

      const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
      const viewUrl = `${appUrl}/#/estimate/${estimate.uniqueId}`;

      const { subject, html } = buildFollowUpEmail({
        clientName: estimate.clientName,
        senderName: user.name,
        estimateNumber: estimate.estimateNumber,
        projectAddress: estimate.projectAddress,
        viewUrl,
        daysSinceSent,
      });

      const { messageId } = await sendGmailEmail({
        senderName: user.name,
        senderEmail: user.email,
        accessToken: user.googleAccessToken,
        refreshToken: user.googleRefreshToken || null,
        to: estimate.clientEmail,
        subject,
        html,
      });

      await storage.logEmail({
        estimateId: id,
        sentByUserId: user.id,
        recipientEmail: estimate.clientEmail,
        subject,
        bodyPreview: `Follow-up sent for estimate ${estimate.estimateNumber}`,
        gmailMessageId: messageId,
        emailType: "follow_up_1",
        status: "sent",
      });

      await storage.logActivity({
        estimateId: id,
        userId: user.id,
        action: "email_sent",
        details: `Follow-up email sent to ${estimate.clientEmail} by ${user.name}`,
      });

      res.json({ ok: true, messageId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/estimates/:id/emails — email history for an estimate
  app.get("/api/estimates/:id/emails", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const emails = await storage.getEmailsForEstimate(id);
      res.json(emails);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/inbox — all emails across all estimates (team shared inbox)
  app.get("/api/inbox", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const emails = await storage.getAllEmails(limit, (req as any).orgId);
      const unreadCount = await storage.getUnreadEmailCount((req as any).orgId);

      // Build estimate lookup for client names
      const allEstimates = await storage.getEstimates(undefined, (req as any).orgId);
      const estMap: Record<number, { clientName: string; estimateNumber: string }> = {};
      for (const e of allEstimates) {
        estMap[e.id] = { clientName: e.clientName, estimateNumber: e.estimateNumber };
      }

      res.json({ emails, unreadCount, estimates: estMap });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/inbox/poll — pull new inbound replies from the team Gmail
  app.post("/api/inbox/poll", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const accessToken  = await storage.getConfig("team_access_token");
      const refreshToken = await storage.getConfig("team_refresh_token");
      if (!accessToken) return res.status(400).json({ error: "Team Gmail not connected. Go to Settings to connect." });

      const messages = await pollTeamInbox({ accessToken, refreshToken });

      let saved = 0;
      for (const msg of messages) {
        // Try to match estimate number from subject (e.g. "Re: Your Estimate ... — 585RC-OK-..."
        const estNumMatch = msg.subject.match(/([A-Z0-9]+-[A-Z]+-\d{8}-\d+)/i);
        let estimateId: number | null = null;
        if (estNumMatch) {
          const est = await storage.getEstimates(undefined, (req as any).orgId);
          const matched = est.find(e => e.estimateNumber === estNumMatch[1]);
          if (matched) estimateId = matched.id;
        }

        await storage.upsertEmailByMessageId(msg.messageId, {
          estimateId: estimateId ?? undefined,
          recipientEmail: "1dcestimatesdonotreply@gmail.com",
          fromEmail: msg.fromEmail,
          fromName: msg.fromName,
          subject: msg.subject,
          bodyPreview: msg.bodyText.slice(0, 300),
          bodyHtml: msg.bodyHtml || msg.bodyText,
          gmailMessageId: msg.messageId,
          gmailThreadId: msg.threadId,
          direction: "inbound",
          emailType: "client_reply",
          status: "received",
          isRead: false,
          sentAt: msg.date,
        });
        saved++;
      }

      res.json({ polled: messages.length, saved });
    } catch (err: any) {
      console.error("[inbox/poll] error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/inbox/:id/read — mark email as read
  app.post("/api/inbox/:id/read", requireAuth as any, async (req: Request, res: Response) => {
    try {
      await storage.markEmailRead(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/inbox/connect-team-gmail — admin stores team OAuth tokens
  app.post("/api/inbox/connect-team-gmail", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      if (user.role !== "admin" && user.role !== "viewer") return res.status(403).json({ error: "Admin only" });
      if (!user.googleAccessToken) return res.status(400).json({ error: "Sign out and back in with Gmail permissions first." });

      // Store this admin user's tokens as the team inbox token
      await storage.setConfig("team_access_token", user.googleAccessToken);
      if (user.googleRefreshToken) await storage.setConfig("team_refresh_token", user.googleRefreshToken);
      await storage.setConfig("team_gmail_email", user.email);

      res.json({ ok: true, connectedAs: user.email });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/inbox/status — is team Gmail connected?
  app.get("/api/inbox/status", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const email = await storage.getConfig("team_gmail_email");
      const unread = await storage.getUnreadEmailCount((req as any).orgId);
      res.json({ connected: !!email, connectedAs: email, unreadCount: unread });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/estimates/:id/reply — reply to a client from any team member
  app.post("/api/estimates/:id/reply", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user as User;
      if (!user.googleAccessToken) return res.status(403).json({ error: "No Gmail token. Sign out and back in." });

      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ error: "Not found" });
      if (!estimate.clientEmail) return res.status(400).json({ error: "No client email" });

      const { message, subject, threadId } = req.body;
      if (!message) return res.status(400).json({ error: "message is required" });

      const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
      const viewUrl = `${appUrl}/#/estimate/${estimate.uniqueId}`;

      const replySubject = subject || `Re: Your Estimate from 1 Degree Construction - ${estimate.estimateNumber}`;
      const html = `
        <div style="font-family:sans-serif;max-width:600px;">
          <p>${message.replace(/\n/g, "<br>")}</p>
          <br>
          <p style="color:#888;font-size:13px;">---<br>
            <strong>${user.name}</strong> | 1 Degree Construction<br>
            <a href="${viewUrl}" style="color:#e87722;">View your estimate</a>
          </p>
        </div>`;

      const { messageId, threadId: newThreadId } = await sendGmailEmail({
        senderName: user.name,
        senderEmail: user.email,
        accessToken: user.googleAccessToken,
        refreshToken: user.googleRefreshToken || null,
        to: estimate.clientEmail,
        subject: replySubject,
        html,
        threadId,
      });

      await storage.logEmail({
        estimateId: id,
        sentByUserId: user.id,
        recipientEmail: estimate.clientEmail,
        fromEmail: user.email,
        fromName: user.name,
        subject: replySubject,
        bodyPreview: message.slice(0, 300),
        gmailMessageId: messageId,
        gmailThreadId: newThreadId,
        direction: "outbound",
        emailType: "follow_up_1",
        status: "sent",
        isRead: true,
      });

      await storage.logActivity({ estimateId: id, userId: user.id, action: "email_sent", details: `Reply sent to ${estimate.clientEmail} by ${user.name}` });
      res.json({ ok: true, messageId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // Pricing History endpoints
  app.post("/api/pricing-history", async (req, res) => {
    try {
      const { trade, scopeKeyword, subCost, city, estimateId, markupRate, salesRepId } = req.body;
      if (!trade || !scopeKeyword || subCost === undefined) {
        return res.status(400).json({ error: "trade, scopeKeyword, subCost are required" });
      }
      const mr = typeof markupRate === "number" ? markupRate : 100;
      const cp = Math.round(subCost * (1 + mr / 100) * 100) / 100;
      await storage.logPricing([{ trade, scopeKeyword, subCost, clientPrice: cp, markupRate: mr, city, source: "user_edit", estimateId, salesRepId }]);
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
      const { message, conversationHistory = [], estimateId } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      // Gather all recent pricing history (up to 100 rows)
      const pricingRows = await storage.getAllRecentPricing(100);
      const pricingContext = pricingRows.length > 0
        ? pricingRows.map(r => {
            const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "unknown";
            const markup = r.markupRate != null ? `${r.markupRate}%` : "";
            const cp = r.clientPrice != null ? `$${r.clientPrice}` : "";
            return `${r.trade} | ${r.scopeKeyword} | sub:$${r.subCost} | client:${cp} | markup:${markup} | ${r.city || ""} | ${r.source} | ${date}`;
          }).join("\n")
        : "No pricing history available yet.";

      // Gather recent 20 projects
      const allEstimates = await storage.getEstimates(undefined, (req as any).orgId);
      const recentEstimates = allEstimates.slice(0, 20);
      const projectContext = recentEstimates.length > 0
        ? recentEstimates.map(e => {
            const date = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "unknown";
            return `#${e.estimateNumber} | ${e.clientName} | ${e.projectAddress}, ${e.city} | $${e.totalSubCost?.toFixed(0) || 0} sub | ${e.status} | ${date}`;
          }).join("\n")
        : "No projects available yet.";

      // If estimateId provided, gather linked PO data for this estimate
      let linkedPOContext = "";
      if (estimateId) {
        const parsedEstimateId = parseInt(estimateId);
        if (!isNaN(parsedEstimateId)) {
          const [directPOs, linkedPOs] = await Promise.all([
            storage.getPurchaseOrders(parsedEstimateId),
            storage.getLinkedPurchaseOrders(parsedEstimateId),
          ]);
          const seenIds = new Set<number>();
          const allPOs = [];
          for (const po of [...directPOs, ...linkedPOs]) {
            if (!seenIds.has(po.id)) { seenIds.add(po.id); allPOs.push(po); }
          }
          if (allPOs.length > 0) {
            const poLines = allPOs.map(po => {
              const parsed = po.parsedData as { subName?: string; total?: number; items?: Array<{ trade?: string; description?: string; amount?: number }> } | null;
              const subName = parsed?.subName || po.filename;
              const total = parsed?.total ? `$${parsed.total.toFixed(0)}` : "unknown total";
              const trades = (parsed?.items || []).map((i: { trade?: string; description?: string; amount?: number }) =>
                `${i.trade || "general"}: ${i.description || ""} $${i.amount?.toFixed(0) || 0}`
              ).join("; ");
              const date = po.createdAt ? new Date(po.createdAt).toISOString().slice(0, 10) : "unknown";
              return `PO from ${subName} | ${total} | ${po.status} | ${date} | Items: ${trades || "(no items)"}` +
                (po.estimateId !== parsedEstimateId ? " [linked from another project]" : "");
            }).join("\n");
            linkedPOContext = `\n\nPURCHASE ORDERS LINKED TO THIS ESTIMATE:\n${poLines}`;
          }
        }
      }

      const systemPrompt = `You are the pricing assistant for 1 Degree Construction. You have access to the company's historical pricing database and project records.

Your job:
- Answer questions about past pricing on specific projects
- Compare costs across trades, projects, and time periods
- Help the estimator understand cost trends
- Suggest pricing for new work based on historical data
- Reference specific purchase orders and vendor quotes when available

PRICING DATA (from completed projects):
${pricingContext}

PROJECT LIST:
${projectContext}${linkedPOContext}

RULES:
1. Always cite which project/date your numbers come from
2. If you don't have data for something, say so — don't guess
3. Keep responses concise and direct
4. When purchase orders are available, prefer citing them directly: "Based on the PO from [sub name], [trade] cost $X"
5. If the user asks to UPDATE or CHANGE a price in the database, respond with your recommendation but include a JSON block at the END of your message in this exact format:
   ===PROPOSED_CHANGE===
   {"trade": "...", "scopeKeyword": "...", "subCost": ..., "city": "...", "reason": "..."}
   ===END_CHANGE===
6. NEVER propose changes unless the user explicitly asks to update/change/set a price
7. Only ONE change at a time — never batch updates
8. Changes must be reasonable — never more than 50% different from the most recent price for that trade unless the user provides clear justification`;

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

      trackUsage("claude_ai", "pricing_chat", (req as any).user?.id);
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
      const { trade, scopeKeyword, subCost, city, reason, markupRate } = req.body;
      if (!trade || !scopeKeyword || subCost === undefined) {
        return res.status(400).json({ error: "trade, scopeKeyword, and subCost are required" });
      }
      const mr = typeof markupRate === "number" ? markupRate : 100;
      const cp = Math.round(Number(subCost) * (1 + mr / 100) * 100) / 100;
      await storage.logPricing([{
        trade,
        scopeKeyword,
        subCost: Number(subCost),
        clientPrice: cp,
        markupRate: mr,
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
      const estimateNumber = await generateEstimateNumber(
        estimateData.clientName || "Unknown",
        estimateData.projectAddress || "Unknown",
        (req as any).orgId
      );
      const uniqueId = generateUniqueId();

      // Calculate totals
      let totalSubCost = 0;
      if (items) {
        for (const item of items) {
          totalSubCost += item.subCost || 0;
        }
      }
      const markupRate = typeof estimateData.markupRate === "number" ? estimateData.markupRate : 100;
      const markupMultiplier = 1 + markupRate / 100;
      const totalBeforeAllowance = Math.round(totalSubCost * markupMultiplier * 100) / 100;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      let totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      // Apply real discount (actually reduces total)
      if (estimateData.realDiscountType === "percent" && estimateData.realDiscountValue > 0) {
        totalClientPrice = Math.round(totalClientPrice * (1 - estimateData.realDiscountValue / 100) * 100) / 100;
      } else if (estimateData.realDiscountType === "dollar" && estimateData.realDiscountValue > 0) {
        totalClientPrice = Math.round((totalClientPrice - estimateData.realDiscountValue) * 100) / 100;
      }
      const depositAmount = Math.min(1000, Math.round(totalClientPrice * 0.1 * 100) / 100);

      const currentUserId = req.user ? (req.user as Express.User).id : null;

      // Get today's color (immutable once generated)
      const todayStr = now.toISOString().slice(0, 10);
      let dayColor = "";
      const existingColor = await db.execute(sql`SELECT hex_color FROM daily_colors WHERE date = ${todayStr}`);
      if (existingColor.rows.length > 0) {
        dayColor = (existingColor.rows[0] as any).hex_color;
      } else {
        const recentC = await db.execute(sql`SELECT hex_color FROM daily_colors ORDER BY date DESC LIMIT 5`);
        dayColor = generateDailyColor(todayStr, recentC.rows.map((r: any) => r.hex_color));
        await db.execute(sql`INSERT INTO daily_colors (date, hex_color) VALUES (${todayStr}, ${dayColor}) ON CONFLICT (date) DO NOTHING`);
      }

      const estimate = await storage.createEstimate({
        orgId: (req as any).orgId || 1,
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
        markupRate,
        apparentDiscountType: estimateData.apparentDiscountType || null,
        apparentDiscountValue: estimateData.apparentDiscountValue || null,
        realDiscountType: estimateData.realDiscountType || null,
        realDiscountValue: estimateData.realDiscountValue || null,
        sentAt: estimateData.status === "sent" ? now : null,
        viewedAt: null,
        approvedAt: null,
        signatureName: null,
        signatureTimestamp: null,
        createdByUserId: currentUserId,
        dayColor: dayColor || null,
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
            clientPrice: Math.round(item.subCost * markupMultiplier * 100) / 100,
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
          clientPrice: Math.round((item.subCost || 0) * markupMultiplier * 100) / 100,
          markupRate,
          city: estimateData.city || "",
          source: (estimateData as any)._aiGenerated ? "ai_generated" : "user_edit",
          estimateId: estimate.id,
          salesRepId: estimateData.salesRepId || undefined,
        }));
        await storage.logPricing(pricingEntries).catch(() => {});

        // Also log breakdown-level pricing for grouped items
        const breakdownEntries: Array<{ trade: string; scopeKeyword: string; subCost: number; clientPrice?: number; markupRate?: number; city?: string; source: string; estimateId?: number; salesRepId?: number }> = [];
        for (const item of items) {
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (const bd of item.breakdowns) {
              if (bd.tradeName && bd.subCost > 0) {
                breakdownEntries.push({
                  trade: bd.tradeName,
                  scopeKeyword: item.phaseGroup || "other",
                  subCost: bd.subCost,
                  clientPrice: Math.round(bd.subCost * markupMultiplier * 100) / 100,
                  markupRate,
                  city: estimateData.city || "",
                  source: "breakdown_manual",
                  estimateId: estimate.id,
                  salesRepId: estimateData.salesRepId || undefined,
                });
              }
            }
          }
        }
        if (breakdownEntries.length > 0) {
          await storage.logPricing(breakdownEntries).catch(() => {});
        }
      }

      // Auto-save client to contacts directory
      if (estimateData.clientName) {
        const existing = await storage.searchContacts(estimateData.clientName, (req as any).orgId);
        if (!existing.find(c => c.name.toLowerCase() === estimateData.clientName.toLowerCase())) {
          await storage.createContact({
            name: estimateData.clientName,
            email: estimateData.clientEmail || null,
            phone: estimateData.clientPhone || null,
            address: estimateData.projectAddress || null,
            city: estimateData.city || null,
            state: estimateData.state || null,
            zip: estimateData.zip || null,
            createdByUserId: currentUserId,
            createdAt: new Date(),
          }).catch(() => {});
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
      const markupRate = typeof estimateData.markupRate === "number" ? estimateData.markupRate : 100;
      const markupMultiplier = 1 + markupRate / 100;
      const totalBeforeAllowance = Math.round(totalSubCost * markupMultiplier * 100) / 100;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      let totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      // Apply real discount (actually reduces total)
      if (estimateData.realDiscountType === "percent" && estimateData.realDiscountValue > 0) {
        totalClientPrice = Math.round(totalClientPrice * (1 - estimateData.realDiscountValue / 100) * 100) / 100;
      } else if (estimateData.realDiscountType === "dollar" && estimateData.realDiscountValue > 0) {
        totalClientPrice = Math.round((totalClientPrice - estimateData.realDiscountValue) * 100) / 100;
      }
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
        markupRate,
        apparentDiscountType: estimateData.apparentDiscountType !== undefined ? estimateData.apparentDiscountType : undefined,
        apparentDiscountValue: estimateData.apparentDiscountValue !== undefined ? estimateData.apparentDiscountValue : undefined,
        realDiscountType: estimateData.realDiscountType !== undefined ? estimateData.realDiscountType : undefined,
        realDiscountValue: estimateData.realDiscountValue !== undefined ? estimateData.realDiscountValue : undefined,
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
            clientPrice: Math.round(item.subCost * markupMultiplier * 100) / 100,
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
          clientPrice: Math.round((item.subCost || 0) * markupMultiplier * 100) / 100,
          markupRate,
          city: estimateData.city || "",
          source: (estimateData as any)._aiGenerated ? "ai_generated" : "user_edit",
          estimateId: id,
          salesRepId: estimateData.salesRepId || undefined,
        }));
        await storage.logPricing(pricingEntries).catch(() => {});

        // Also log breakdown-level pricing for grouped items
        const breakdownEntries: Array<{ trade: string; scopeKeyword: string; subCost: number; clientPrice?: number; markupRate?: number; city?: string; source: string; estimateId?: number; salesRepId?: number }> = [];
        for (const item of items) {
          if (item.isGrouped && item.breakdowns && item.breakdowns.length > 0) {
            for (const bd of item.breakdowns) {
              if (bd.tradeName && bd.subCost > 0) {
                breakdownEntries.push({
                  trade: bd.tradeName,
                  scopeKeyword: item.phaseGroup || "other",
                  subCost: bd.subCost,
                  clientPrice: Math.round(bd.subCost * markupMultiplier * 100) / 100,
                  markupRate,
                  city: estimateData.city || "",
                  source: "breakdown_manual",
                  estimateId: id,
                  salesRepId: estimateData.salesRepId || undefined,
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

      // Log to shared inbox so whole team sees it
      await storage.logEmail({
        estimateId: estimate.id,
        recipientEmail: "team",
        fromEmail: estimate.clientEmail || "",
        fromName: estimate.clientName,
        subject: `🎉 ${estimate.clientName} signed estimate ${estimate.estimateNumber}`,
        bodyPreview: `${estimate.clientName} accepted the estimate for ${estimate.projectAddress}. Total: $${estimate.totalClientPrice.toLocaleString()}. Signed by: ${signatureName}`,
        direction: "inbound",
        emailType: "internal_notification",
        status: "received",
        isRead: false,
        sentAt: now,
      }).catch(() => {});

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
      res.json(usersList.map(({ googleAccessToken, googleRefreshToken, ...safe }) => safe));
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

CRITICAL: All costs you output are SUB COSTS (what we pay the subcontractor). The system auto-applies the estimate's markup rate (default 100%) to calculate client pricing. Do NOT apply markup yourself.

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
- DO NOT calculate the total yourself. The system provides the exact totalClientPrice. Use THAT number.
- Deposit = min(1000, totalClientPrice * 0.10)

PROGRESS PAYMENTS:
- NEVER group phases together in a single payment. Each trade/phase gets its OWN separate payment milestone.
- This makes each individual payment feel smaller and ties it to visible progress the client can see.
- The dollar amounts are SYMBOLIC — they do not need to match the actual cost of that trade. Spread the total evenly-ish across milestones with round numbers, keeping it top-heavy.
- Example for a bathroom remodel:
  • Deposit upon acceptance — $1,000
  • Completion of Demolition — $3,500
  • Completion of Framing — $3,000
  • Completion of Plumbing Rough-In — $3,000
  • Completion of Electrical Rough-In — $2,500
  • Completion of HVAC — $2,500
  • Completion of Insulation — $2,000
  • Completion of Drywall — $2,000
  • Completion of Paint — $1,500
  • Completion of Tile & Stone — $1,500
  • Completion of Finish Carpentry — $1,500
  • Final Walkthrough & Project Closeout (10% Retention) — $2,870
- For smaller projects (e.g., cosmetic, glass install), use fewer milestones but still keep them individual — never "Demo + Framing" as one line
- Payment schedule should be top-heavy: earlier milestones get slightly larger amounts

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

Milestone amounts MUST sum to EXACTLY the totalClientPrice provided by the system. The retention absorbs all rounding differences.
CRITICAL: If you sum up your milestone amounts and get MORE than totalClientPrice, the final payment goes NEGATIVE which is invalid. Always verify: sum of all milestones == totalClientPrice. Start by subtracting the deposit from the total, then distribute the remainder across progress payments + retention.

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

CRITICAL: All costs are SUB COSTS (what we pay the subcontractor). The system auto-applies the estimate's markup rate (default 100%).

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
      const { prompt, estimateId, currentFormData, calendarEvent } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      // Build calendar cross-check context
      let calendarContext = "";
      if (calendarEvent || currentFormData) {
        calendarContext = "\n\n=== CLIENT INFO CROSS-CHECK ===";
        if (currentFormData) {
          calendarContext += `\nForm data entered by user: ${JSON.stringify(currentFormData)}`;
        }
        if (calendarEvent) {
          calendarContext += `\nOriginal calendar event: Title: ${calendarEvent.summary || ""}, Location: ${calendarEvent.location || ""}, Description: ${calendarEvent.description || ""}, Attendees: ${JSON.stringify(calendarEvent.attendees || [])}`;
        }
        calendarContext += "\nIMPORTANT: Cross-check the form data against the calendar event. Use the MOST ACCURATE version of client name, email, phone, and address. If the calendar has a full address but the form only has a street, use the calendar's. If the form has a corrected name, prefer the form's. Return the best version in your response.";
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
            const markup = row.markupRate != null ? ` | markup:${row.markupRate}%` : "";
            pricingRows.push(`${row.trade} | ${row.scopeKeyword} | sub:$${row.subCost}${markup} | ${row.city || ""} | ${dateStr}`);
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
        messages: [{ role: "user", content: finalPrompt + calendarContext }],
        system: systemPrompt,
      });

      // Extract text content from the response
      const textBlock = message.content.find((block: any) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return res.status(500).json({ error: "No text response from AI" });
      }

      trackUsage("claude_ai", "generate_estimate", (req as any).user?.id);

      // Parse the JSON from the response
      const responseText = textBlock.text;
      // Try to extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[ai/generate] No JSON found in response:", responseText.slice(0, 500));
        return res.status(422).json({ error: "The AI response wasn't in the expected format. Please try again — sometimes rephrasing the prompt helps." });
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr: any) {
        console.error("[ai/generate] JSON parse error:", parseErr.message, responseText.slice(0, 500));
        return res.status(422).json({ error: "The AI returned malformed data. Please try again." });
      }

      // Fix negative final payment: always validate milestones sum correctly
      const msArr = parsed.milestones || parsed.paymentMilestones;
      const liArr = parsed.lineItems || parsed.items;
      if (msArr && msArr.length > 1) {
        // Calculate the real total from line items if available
        let totalClient: number;
        if (liArr && liArr.length > 0) {
          const totalSub = liArr.reduce((s: number, li: any) => s + (li.subCost || 0), 0);
          const markupMult = 1 + ((parsed.markupRate ?? 100) / 100);
          const subtotal = Math.round(totalSub * markupMult * 100) / 100;
          totalClient = Math.round((subtotal + subtotal * 0.03) * 100) / 100;
        } else {
          // No line items — derive from milestone sum (AI intended total)
          totalClient = msArr.reduce((s: number, m: any) => s + (m.amount || 0), 0);
        }

        const lastIdx = msArr.length - 1;
        const deposit = msArr[0]?.amount || 0;
        const progressMs = msArr.slice(1, lastIdx);
        const progressSum = progressMs.reduce((s: number, m: any) => s + (m.amount || 0), 0);
        const finalPayment = totalClient - deposit - progressSum;

        // If progress payments overshoot, scale them down
        if (finalPayment < 0) {
          console.log(`[milestone-fix] Negative final: $${finalPayment}. Scaling down progress payments.`);
          const targetRetention = Math.max(Math.round(totalClient * 0.1), 500);
          const progressBudget = totalClient - deposit - targetRetention;

          if (progressSum > 0 && progressBudget > 0) {
            const scale = progressBudget / progressSum;
            for (const m of progressMs) {
              m.amount = Math.round((m.amount * scale) / 500) * 500; // round to nearest $500
            }
          }
          const newProgressSum = progressMs.reduce((s: number, m: any) => s + (m.amount || 0), 0);
          msArr[lastIdx].amount = Math.round((totalClient - deposit - newProgressSum) * 100) / 100;
        } else {
          // Just make sure final payment equals remainder
          msArr[lastIdx].amount = Math.round(finalPayment * 100) / 100;
        }

        // Overwrite back
        if (parsed.milestones) parsed.milestones = msArr;
        if (parsed.paymentMilestones) parsed.paymentMilestones = msArr;

        console.log(`[milestone-fix] Total: $${totalClient}, Deposit: $${deposit}, Progress: $${progressMs.reduce((s: number, m: any) => s + (m.amount || 0), 0)}, Final: $${msArr[lastIdx].amount}`);
      }

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
      console.error("[ai/generate] error:", err.message || err);
      const msg = err.message?.includes("rate") ? "AI rate limit hit. Wait a moment and try again."
        : err.message?.includes("timeout") ? "AI request timed out. Try a shorter prompt."
        : "AI generation failed. Please try again.";
      res.status(err.status || 500).json({ error: msg });
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
          const lines = pricingRows.map(r => {
            const markup = r.markupRate != null ? ` | markup:${r.markupRate}%` : "";
            return `${r.trade} | ${r.scopeKeyword} | sub:$${r.subCost}${markup} | ${r.city || ""}`;
          }).join("\n");
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
      trackUsage("claude_ai", "ai_breakdown", (req as any).user?.id);

      // Parse JSON array from response
      const rawText = textBlock.text.trim();
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("[ai/breakdown] No JSON array in response:", rawText.slice(0, 300));
        return res.status(422).json({ error: "Could not generate breakdown. Try again." });
      }

      let breakdowns: Array<{ tradeName: string; subCost: number }>;
      try {
        breakdowns = JSON.parse(jsonMatch[0]);
      } catch {
        return res.status(422).json({ error: "AI returned malformed breakdown data. Try again." });
      }

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
      console.error("[ai/breakdown] error:", err.message || err);
      res.status(err.status || 500).json({ error: "Breakdown generation failed. Please try again." });
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

  // ─── Purchase Orders ───────────────────────────────────────────────────────

  // Helper: run OCR + AI parse on a PO record (async, fire-and-forget)
  async function processPurchaseOrder(poId: number, fileBuffer: Buffer, mimetype: string) {
    try {
      // Step 1: Convert to image buffer if needed
      let imageBuffer: Buffer;
      if (mimetype === "application/pdf") {
        // Parse PDF and get first page text directly, and also try converting to image
        try {
          const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
          const textResult = await parser.getText();
          const rawText = textResult.text;
          await parser.destroy();
          if (rawText && rawText.trim().length > 20) {
            // We got usable text from the PDF directly - skip Tesseract
            await storage.updatePurchaseOrder(poId, { status: "ocr_complete", rawOcrText: rawText });
            await parsePurchaseOrderWithAI(poId, rawText);
            return;
          }
        } catch (_) { /* fall through to image conversion */ }
        // For scanned PDFs (pure images), fall back to Tesseract on the raw buffer
        imageBuffer = fileBuffer;
      } else {
        imageBuffer = fileBuffer;
      }

      // Step 2: Run Tesseract OCR directly (no sharp preprocessing)
      const { data: { text } } = await Tesseract.recognize(imageBuffer, "eng", {
        logger: () => {}, // suppress logs
      });

      const rawText = text.trim();
      await storage.updatePurchaseOrder(poId, { status: "ocr_complete", rawOcrText: rawText });

      // Step 4: Parse with AI
      await parsePurchaseOrderWithAI(poId, rawText);
    } catch (err: any) {
      console.error(`OCR error for PO ${poId}:`, err);
      await storage.updatePurchaseOrder(poId, { status: "error", rawOcrText: `OCR failed: ${err.message}` });
    }
  }

  async function parsePurchaseOrderWithAI(poId: number, rawText: string) {
    try {
      const parsePrompt = `Extract pricing data from this subcontractor invoice/purchase order text.

RAW OCR TEXT:
${rawText}

Extract ALL line items with costs.

QUANTITY EXTRACTION RULES (CRITICAL):
- Read the document carefully for quantities. Look for: numbers before item names ("3 recessed lights"), "x" or "@" notation ("6 x $130"), qty columns, count fields, and parenthetical quantities.
- When the total amount divided by a common per-unit price gives a whole number, that's likely the quantity. Example: $390 for recessed lights at $130/ea = 3 lights, NOT 1 light at $390.
- Check if the document lists individual items that should be counted. Example: if it lists "recessed light install" in 3 locations, quantity is 3.
- NEVER default to quantity 1 if the math suggests otherwise. Always verify: does totalAmount / unitCost = a reasonable whole number?
- Set amount = quantity * unitCost. Double-check this math.

Return ONLY valid JSON:
{
  "subName": "company name if found",
  "subPhone": "phone if found",
  "date": "invoice date if found",
  "projectAddress": "address if found",
  "items": [
    {
      "trade": "plumbing|electrical|demolition|framing|drywall|paint|tile|hvac|general|other",
      "description": "what the line item is for",
      "quantity": 1,
      "unitCost": 1234.56,
      "amount": 1234.56,
      "unit": "per job|per room|per SF|per LF|per item|lump sum"
    }
  ],
  "total": 1234.56,
  "confidence": "high|medium|low",
  "clarifyingQuestions": [
    {
      "itemIndex": 0,
      "question": "short targeted question",
      "reason": "why this helps with pricing"
    }
  ]
}

FOR CLARIFYING QUESTIONS:
- Only generate questions for lump sum items where the scope is vague (e.g., just says "framing" or "plumbing" with no quantity)
- Max 3 questions total — pick only the most impactful ones
- Questions should help convert lump sums to per-unit pricing (e.g., "How many bathrooms did this cover?" "Approximate square footage?" "Was this rough-in only or finish too?")
- If the scope is already specific enough, return clarifyingQuestions as an empty array []
- Keep questions short — one sentence max

If the text is hard to read or unclear, set confidence to "low" and do your best.
If you can't extract anything useful, return {"items": [], "confidence": "low", "clarifyingQuestions": [], "error": "Could not parse"}.`;

      const anthropicClient = new Anthropic();
      const msg = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: parsePrompt }],
      });

      const responseText = msg.content[0].type === "text" ? msg.content[0].text : "";
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in AI response");
      const parsedData = JSON.parse(jsonMatch[0]);

      await storage.updatePurchaseOrder(poId, { status: "parsed", parsedData });
    } catch (err: any) {
      console.error(`AI parse error for PO ${poId}:`, err);
      await storage.updatePurchaseOrder(poId, {
        status: "parsed",
        parsedData: { items: [], confidence: "low", error: `Parse failed: ${err.message}` },
      });
    }
  }

  // POST /api/purchase-orders/upload
  app.post("/api/purchase-orders/upload", requireAuth as any, (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const user = req.user as Express.User;
      const { estimateId, notes } = req.body;
      const file = req.file;

      // Upload to Supabase Storage
      const timestamp = Date.now();
      const ext = file.originalname.split(".").pop() || "bin";
      const storagePath = `${timestamp}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      let fileUrl = "";
      if (supabaseUrl && supabaseKey) {
        const { error: uploadError } = await supabase.storage
          .from("purchase-orders")
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });

        if (uploadError) {
          console.error("Supabase upload error:", uploadError);
          // Fall back to base64 data URL for development
          fileUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64").slice(0, 100)}...`;
        } else {
          const { data: urlData } = supabase.storage
            .from("purchase-orders")
            .getPublicUrl(storagePath);
          fileUrl = urlData.publicUrl;
        }
      } else {
        fileUrl = `/uploads/${storagePath}`; // fallback
      }

      // Save PO record
      const po = await storage.createPurchaseOrder({
        estimateId: estimateId ? parseInt(estimateId) : null,
        uploadedByUserId: user.id,
        filename: file.originalname,
        fileUrl,
        status: "pending",
        notes: notes || null,
        rawOcrText: null,
        parsedData: null,
      });

      // Kick off async OCR + parse (fire and forget)
      const fileBuffer = file.buffer;
      const mimetype = file.mimetype;
      setImmediate(() => processPurchaseOrder(po.id, fileBuffer, mimetype));

      res.json(po);
    } catch (err: any) {
      console.error("PO upload error:", err);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });

  // GET /api/purchase-orders/search?q=xxx  (must be before /:id)
  app.get("/api/purchase-orders/search", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || "";
      const pos = await storage.searchConfirmedPurchaseOrders(q);
      res.json(pos);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/purchase-orders
  app.get("/api/purchase-orders", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? parseInt(req.query.estimateId as string) : undefined;
      if (estimateId !== undefined) {
        // Get POs by primary estimateId + POs linked via junction table
        const [direct, linked] = await Promise.all([
          storage.getPurchaseOrders(estimateId),
          storage.getLinkedPurchaseOrders(estimateId),
        ]);
        // Merge, deduplicate by id
        const seen = new Set<number>();
        const merged = [];
        for (const po of [...direct, ...linked]) {
          if (!seen.has(po.id)) {
            seen.add(po.id);
            merged.push(po);
          }
        }
        return res.json(merged);
      }
      const pos = await storage.getPurchaseOrders(undefined, (req as any).orgId);
      res.json(pos);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/purchase-orders/:id
  app.get("/api/purchase-orders/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const po = await storage.getPurchaseOrder(parseInt(req.params.id as string));
      if (!po) return res.status(404).json({ error: "Not found" });
      res.json(po);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/purchase-orders/:id/parse  (re-trigger AI parse manually, optionally with clarifying context)
  app.post("/api/purchase-orders/:id/parse", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const po = await storage.getPurchaseOrder(parseInt(req.params.id as string));
      if (!po) return res.status(404).json({ error: "Not found" });
      if (!po.rawOcrText) return res.status(400).json({ error: "No OCR text available yet" });
      const additionalContext = req.body?.additionalContext || "";
      const enrichedOcr = additionalContext
        ? `${po.rawOcrText}\n\n--- USER CLARIFICATIONS ---\n${additionalContext}`
        : po.rawOcrText;
      setImmediate(() => parsePurchaseOrderWithAI(po.id, enrichedOcr));
      res.json({ message: "Parse triggered" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/purchase-orders/:id  (update parsed data after user edits)
  app.patch("/api/purchase-orders/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const po = await storage.getPurchaseOrder(parseInt(req.params.id as string));
      if (!po) return res.status(404).json({ error: "Not found" });
      const { parsedData, estimateId } = req.body;
      const updates: Record<string, unknown> = {};
      if (parsedData !== undefined) updates.parsedData = parsedData;
      if (estimateId !== undefined) updates.estimateId = estimateId ? parseInt(estimateId) : null;
      const updated = await storage.updatePurchaseOrder(po.id, updates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/purchase-orders/:id/link — link a PO to another estimate
  app.post("/api/purchase-orders/:id/link", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const poId = parseInt(req.params.id as string);
      const { estimateId } = req.body;
      if (!estimateId || isNaN(parseInt(estimateId))) {
        return res.status(400).json({ error: "estimateId is required" });
      }
      const po = await storage.getPurchaseOrder(poId);
      if (!po) return res.status(404).json({ error: "PO not found" });
      const link = await storage.linkPurchaseOrderToEstimate(poId, parseInt(estimateId));
      res.json({ success: true, link });
    } catch (err: any) {
      console.error("PO link error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/purchase-orders/:id/confirm — insert into pricing_history
  app.post("/api/purchase-orders/:id/confirm", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const po = await storage.getPurchaseOrder(parseInt(req.params.id as string));
      if (!po) return res.status(404).json({ error: "Not found" });
      if (!po.parsedData) return res.status(400).json({ error: "No parsed data to confirm" });

      const parsed = po.parsedData as {
        items?: Array<{ trade: string; description: string; amount: number; unit: string }>;
        subName?: string;
        total?: number;
      };

      const items = parsed.items || [];
      if (items.length > 0) {
        const entries = items
          .filter(item => item.amount && item.amount > 0)
          .map(item => ({
            trade: item.trade || "general",
            scopeKeyword: item.description.slice(0, 50),
            subCost: item.amount,
            city: undefined,
            source: "purchase_order",
            estimateId: po.estimateId || undefined,
          }));
        if (entries.length > 0) {
          await storage.logPricing(entries);
        }
      }

      await storage.updatePurchaseOrder(po.id, { status: "confirmed" });
      res.json({ success: true, entriesAdded: items.filter(i => i.amount > 0).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // --- Pricing Dashboard Routes ---

  const CSLB_TRADES: Record<string, { code: string; name: string }> = {
    "demolition": { code: "C-21", name: "Building Moving/Demolition" },
    "framing": { code: "C-5", name: "Framing & Rough Carpentry" },
    "electrical": { code: "C-10", name: "Electrical" },
    "plumbing": { code: "C-36", name: "Plumbing" },
    "hvac": { code: "C-20", name: "HVAC" },
    "drywall": { code: "C-9", name: "Drywall" },
    "paint": { code: "C-33", name: "Painting & Decorating" },
    "tile": { code: "C-54", name: "Ceramic & Mosaic Tile" },
    "insulation": { code: "C-2", name: "Insulation & Acoustical" },
    "roofing": { code: "C-39", name: "Roofing" },
    "concrete": { code: "C-8", name: "Concrete" },
    "general": { code: "B", name: "General Building" },
    "doors_windows": { code: "C-28", name: "Doors, Windows & Glass" },
    "exterior": { code: "C-27", name: "Exterior / Landscaping" },
    "finish_carpentry": { code: "C-6", name: "Finish Carpentry / Cabinet" },
    "flooring": { code: "C-15", name: "Flooring & Floor Covering" },
    "fireplace": { code: "C-29", name: "Masonry — Fireplace" },
    "masonry": { code: "C-29", name: "Masonry" },
    "waterproofing": { code: "C-61", name: "Waterproofing" },
    "glass": { code: "C-17", name: "Glazing" },
    "appliance": { code: "C-46", name: "Appliance / Solar" },
    "other": { code: "\u2014", name: "Other / Unclassified" },
  };

  // GET /api/pricing-dashboard — all pricing history grouped by trade, most recent per trade+scopeKeyword
  app.get("/api/pricing-dashboard", requireAuth as any, async (req: Request, res: Response) => {
    try {
      // Fetch all pricing history (large limit for dashboard)
      const all = await storage.getAllRecentPricing(5000);

      // Group by trade, keep most recent entry per trade+scopeKeyword combo
      const byTradeKeyword: Record<string, typeof all[0]> = {};
      for (const row of all) {
        const key = `${row.trade}||${row.scopeKeyword}`;
        if (!byTradeKeyword[key]) {
          byTradeKeyword[key] = row;
        }
      }
      const deduped = Object.values(byTradeKeyword);

      // Group by trade
      const byTrade: Record<string, { entries: typeof all; count: number }> = {};
      for (const row of deduped) {
        if (!byTrade[row.trade]) {
          byTrade[row.trade] = { entries: [], count: 0 };
        }
        byTrade[row.trade].entries.push(row);
      }

      // Count total entries per trade (all rows, not deduped)
      const tradeCounts: Record<string, number> = {};
      for (const row of all) {
        tradeCounts[row.trade] = (tradeCounts[row.trade] || 0) + 1;
      }

      const result = Object.entries(byTrade).map(([trade, { entries }]) => ({
        trade,
        cslb: CSLB_TRADES[trade.toLowerCase()] || { code: "\u2014", name: trade },
        count: tradeCounts[trade] || entries.length,
        entries: entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      }));

      // Sort by CSLB code
      result.sort((a, b) => a.cslb.code.localeCompare(b.cslb.code));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/pricing-dashboard/:id — update subCost of a pricing_history row
  app.patch("/api/pricing-dashboard/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = req.user as Express.User;
      if (user.role !== "admin" && user.role !== "estimator") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const id = parseInt(req.params.id as string);
      const { subCost } = req.body as { subCost: number };
      if (typeof subCost !== "number" || isNaN(subCost) || subCost < 0) {
        return res.status(400).json({ error: "Invalid subCost" });
      }
      const rows = await db.update(pricingHistory)
        .set({ subCost, source: "manual_update" })
        .where(eq(pricingHistory.id, id))
        .returning();
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      console.log(`[pricing-dashboard] User ${user.email} updated pricing_history id=${id} subCost=${subCost}`);
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Multi-Tenant: Org Routes (read-only, Phase 1) ───────────────────────

  // GET /api/platform/me — current user's org context
  app.get("/api/platform/me", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      // Check platform admin
      const paRows = await db.execute(sql`SELECT id FROM platform_admins WHERE user_id = ${user.id}`);
      const isPlatformAdmin = paRows.rows.length > 0;

      // Get org memberships
      const memRows = await db.execute(sql`
        SELECT m.org_id, m.role, o.name, o.slug
        FROM org_memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ${user.id} AND m.is_active = true AND o.is_active = true
      `);

      // Platform admins can see all orgs for switching
      let memberships = memRows.rows;
      if (isPlatformAdmin) {
        const allOrgs = await db.execute(sql`SELECT id as org_id, 'org_admin' as role, name, slug FROM organizations WHERE is_active = true ORDER BY id`);
        memberships = allOrgs.rows;
      }

      res.json({
        userId: user.id,
        email: user.email,
        name: user.name,
        isPlatformAdmin,
        memberships,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/platform/orgs — list all orgs (platform admins only)
  app.get("/api/platform/orgs", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      const paRows = await db.execute(sql`SELECT id FROM platform_admins WHERE user_id = ${user.id}`);
      if (paRows.rows.length === 0) return res.status(403).json({ error: "Platform admin only" });

      const orgs = await db.execute(sql`
        SELECT o.*, (SELECT COUNT(*) FROM org_memberships m WHERE m.org_id = o.id AND m.is_active = true) as member_count
        FROM organizations o ORDER BY o.created_at
      `);
      res.json(orgs.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/platform/orgs/:id/members — list members of an org (platform admin or org admin)
  app.get("/api/platform/orgs/:id/members", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      const orgId = parseInt(req.params.id);

      // Check access: platform admin OR org admin
      const paRows = await db.execute(sql`SELECT id FROM platform_admins WHERE user_id = ${user.id}`);
      const isPlatformAdmin = paRows.rows.length > 0;
      if (!isPlatformAdmin) {
        const memCheck = await db.execute(sql`SELECT role FROM org_memberships WHERE user_id = ${user.id} AND org_id = ${orgId} AND is_active = true`);
        if (memCheck.rows.length === 0 || (memCheck.rows[0] as any).role !== "org_admin") {
          return res.status(403).json({ error: "Not authorized for this organization" });
        }
      }

      const members = await db.execute(sql`
        SELECT m.id, m.user_id, m.role, m.is_active, m.created_at, u.name, u.email, u.avatar_url, u.google_id
        FROM org_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ${orgId} ORDER BY m.created_at
      `);
      res.json(members.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Platform Admin: Org CRUD ───────────────────────────────────────────

  async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const pa = await db.execute(sql`SELECT id FROM platform_admins WHERE user_id = ${user.id}`);
    if (pa.rows.length === 0) return res.status(403).json({ error: "Platform admin only" });
    return next();
  }

  // POST /api/platform/orgs — create new organization
  app.post("/api/platform/orgs", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const { name, slug, address, city, state, zip, phone, email, website, licenseNumber } = req.body;
      if (!name || !slug) return res.status(400).json({ error: "name and slug are required" });

      // Check slug uniqueness
      const existing = await db.execute(sql`SELECT id FROM organizations WHERE slug = ${slug.toLowerCase()}`);
      if (existing.rows.length > 0) return res.status(400).json({ error: "Slug already taken" });

      const rows = await db.execute(sql`
        INSERT INTO organizations (name, slug, address, city, state, zip, phone, email, website, license_number, created_at)
        VALUES (${name}, ${slug.toLowerCase()}, ${address || null}, ${city || null}, ${state || null}, ${zip || null}, ${phone || null}, ${email || null}, ${website || null}, ${licenseNumber || null}, NOW())
        RETURNING *
      `);
      res.json(rows.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/platform/orgs/:id — update org
  app.put("/api/platform/orgs/:id", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id);
      const { name, address, city, state, zip, phone, email, website, licenseNumber, isActive } = req.body;
      const rows = await db.execute(sql`
        UPDATE organizations SET
          name = COALESCE(${name}, name),
          address = COALESCE(${address}, address),
          city = COALESCE(${city}, city),
          state = COALESCE(${state}, state),
          zip = COALESCE(${zip}, zip),
          phone = COALESCE(${phone}, phone),
          email = COALESCE(${email}, email),
          website = COALESCE(${website}, website),
          license_number = COALESCE(${licenseNumber}, license_number),
          is_active = COALESCE(${isActive}, is_active)
        WHERE id = ${orgId} RETURNING *
      `);
      if (rows.rows.length === 0) return res.status(404).json({ error: "Org not found" });
      res.json(rows.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/platform/orgs/:id — deactivate org (soft delete)
  app.delete("/api/platform/orgs/:id", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id);
      if (orgId === 1) return res.status(400).json({ error: "Cannot delete the primary organization" });
      await db.execute(sql`UPDATE organizations SET is_active = false WHERE id = ${orgId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/platform/orgs/:id/members — add user to org
  app.post("/api/platform/orgs/:id/members", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id);
      const { email, role } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });

      // Find or create user
      let user = await storage.getUserByEmail(email);
      if (!user) {
        // Pre-create a placeholder user
        user = await storage.createUser({
          googleId: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email,
          name: email.split("@")[0],
          role: role || "estimator",
          isActive: true,
          createdAt: new Date(),
        });
      }

      // Add membership
      await db.execute(sql`
        INSERT INTO org_memberships (user_id, org_id, role, is_active, created_at)
        VALUES (${user.id}, ${orgId}, ${role || "estimator"}, true, NOW())
        ON CONFLICT (user_id, org_id) DO UPDATE SET role = ${role || "estimator"}, is_active = true
      `);

      res.json({ ok: true, userId: user.id, email: user.email, role: role || "estimator" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/platform/orgs/:orgId/members/:userId — remove user from org
  app.delete("/api/platform/orgs/:orgId/members/:userId", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId);
      const userId = parseInt(req.params.userId);
      await db.execute(sql`UPDATE org_memberships SET is_active = false WHERE org_id = ${orgId} AND user_id = ${userId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/platform/orgs/:orgId/members/:userId — change member role
  app.patch("/api/platform/orgs/:orgId/members/:userId", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId);
      const userId = parseInt(req.params.userId);
      const { role } = req.body;
      if (!role) return res.status(400).json({ error: "role is required" });
      await db.execute(sql`UPDATE org_memberships SET role = ${role} WHERE org_id = ${orgId} AND user_id = ${userId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/platform/orgs/:id/invite — add member + send invite email
  app.post("/api/platform/orgs/:id/invite", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id);
      const { email, role } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });

      // Get org details
      const orgRows = await db.execute(sql`SELECT * FROM organizations WHERE id = ${orgId}`);
      if (orgRows.rows.length === 0) return res.status(404).json({ error: "Org not found" });
      const org = orgRows.rows[0] as any;

      // Find or create user
      let invitedUser = await storage.getUserByEmail(email);
      if (!invitedUser) {
        invitedUser = await storage.createUser({
          googleId: `invite-${Date.now()}`,
          email,
          name: email.split("@")[0],
          role: role || "estimator",
          isActive: true,
          createdAt: new Date(),
        });
      }

      // Add org membership
      await db.execute(sql`
        INSERT INTO org_memberships (user_id, org_id, role, is_active, created_at)
        VALUES (${invitedUser.id}, ${orgId}, ${role || "estimator"}, true, NOW())
        ON CONFLICT (user_id, org_id) DO UPDATE SET role = ${role || "estimator"}, is_active = true
      `);

      // Send invite email using team inbox tokens
      const teamAccessToken = await storage.getConfig("team_access_token");
      const teamRefreshToken = await storage.getConfig("team_refresh_token");
      const teamEmail = await storage.getConfig("team_gmail_email");

      const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";
      let emailSent = false;

      if (teamAccessToken && teamEmail) {
        const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#0a0a0a;padding:24px 32px;border-radius:8px 8px 0 0;">
            <div style="color:#e87722;font-size:20px;font-weight:700;">You're Invited</div>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
            <p style="margin:0 0 16px;font-size:15px;color:#333;">You've been invited to join <strong>${org.name}</strong> on our estimating platform.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#555;">Click the button below to sign in with your Google account and get started.</p>
            <div style="text-align:center;">
              <a href="${appUrl}" style="display:inline-block;background:#e87722;color:#fff;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">Sign In to ${org.name}</a>
            </div>
            <p style="margin:24px 0 0;font-size:12px;color:#999;">Sign in with <strong>${email}</strong> to access your workspace.</p>
          </div>
        </div>`;

        try {
          await sendGmailEmail({
            senderName: "Estimator Platform",
            senderEmail: teamEmail,
            accessToken: teamAccessToken,
            refreshToken: teamRefreshToken,
            to: email,
            subject: `You're invited to ${org.name} - Estimating Platform`,
            html,
          });
          emailSent = true;
        } catch (emailErr: any) {
          console.error("[invite-email]", emailErr.message);
        }
      }

      res.json({
        ok: true,
        userId: invitedUser.id,
        email,
        role: role || "estimator",
        emailSent,
        loginUrl: appUrl,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/platform/orgs/:id/resend-invite — resend invite email to existing member
  app.post("/api/platform/orgs/:id/resend-invite", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.id);
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });

      const orgRows = await db.execute(sql`SELECT * FROM organizations WHERE id = ${orgId}`);
      if (orgRows.rows.length === 0) return res.status(404).json({ error: "Org not found" });
      const org = orgRows.rows[0] as any;

      const teamAccessToken = await storage.getConfig("team_access_token");
      const teamRefreshToken = await storage.getConfig("team_refresh_token");
      const teamEmail = await storage.getConfig("team_gmail_email");
      const appUrl = process.env.APP_URL || "https://1degree-estimator.vercel.app";

      if (!teamAccessToken || !teamEmail) {
        return res.status(400).json({ error: "Team inbox not connected — cannot send email" });
      }

      const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0a0a0a;padding:24px 32px;border-radius:8px 8px 0 0;">
          <div style="color:#e87722;font-size:20px;font-weight:700;">Reminder: You're Invited</div>
        </div>
        <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;">
          <p style="margin:0 0 16px;font-size:15px;color:#333;">This is a reminder that you've been invited to join <strong>${org.name}</strong> on our estimating platform.</p>
          <p style="margin:0 0 24px;font-size:14px;color:#555;">Click the button below to sign in with your Google account and get started.</p>
          <div style="text-align:center;">
            <a href="${appUrl}" style="display:inline-block;background:#e87722;color:#fff;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">Sign In to ${org.name}</a>
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#999;">Sign in with <strong>${email}</strong> to access your workspace.</p>
        </div>
      </div>`;

      await sendGmailEmail({
        senderName: "Estimator Platform",
        senderEmail: teamEmail,
        accessToken: teamAccessToken,
        refreshToken: teamRefreshToken,
        to: email,
        subject: `Reminder: You're invited to ${org.name} - Estimating Platform`,
        html,
      });

      res.json({ ok: true, emailSent: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/platform/switch-org — platform admin switches active org (issues new JWT)
  app.post("/api/platform/switch-org", requireAuth as any, requirePlatformAdmin, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as User;
      const { orgId } = req.body;
      if (!orgId) return res.status(400).json({ error: "orgId required" });

      // Verify org exists
      const orgRows = await db.execute(sql`SELECT id FROM organizations WHERE id = ${orgId} AND is_active = true`);
      if (orgRows.rows.length === 0) return res.status(404).json({ error: "Org not found" });

      // Issue new JWT with the selected org
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role, orgId, orgRole: "org_admin" },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      res.json({ token, orgId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Error Log Routes ──────────────────────────────────────────────────────

  // GET /api/admin/usage — usage dashboard stats
  app.get("/api/admin/usage", requireAuth as any, async (_req: Request, res: Response) => {
    try {
      // Overall counts
      const [estCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM estimates`)).rows;
      const [emailOutCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM email_logs WHERE direction = 'outbound'`)).rows;
      const [emailInCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM email_logs WHERE direction = 'inbound'`)).rows;
      const [contactCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM contacts`)).rows;
      const [pricingCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM pricing_history`)).rows;
      const [poCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM purchase_orders`)).rows;
      const [msgCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM estimate_messages`)).rows;
      const [errCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM error_log`)).rows;
      const [userCount] = (await db.execute(sql`SELECT COUNT(*) as c FROM users`)).rows;

      // Usage by service (last 30 days)
      const usageByService = (await db.execute(sql`
        SELECT service, action, COUNT(*) as count
        FROM usage_stats WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY service, action ORDER BY count DESC
      `)).rows;

      // Gmail sends today
      const [gmailToday] = (await db.execute(sql`
        SELECT COUNT(*) as c FROM email_logs WHERE direction = 'outbound' AND sent_at > CURRENT_DATE
      `)).rows;

      // AI calls today
      const [aiToday] = (await db.execute(sql`
        SELECT COUNT(*) as c FROM usage_stats WHERE service = 'claude_ai' AND created_at > CURRENT_DATE
      `)).rows;

      // Recent errors (last 10)
      const recentErrors = (await db.execute(sql`
        SELECT id, route, method, status, LEFT(error_message, 200) as error_message, user_id, created_at
        FROM error_log ORDER BY created_at DESC LIMIT 10
      `)).rows;

      // Recent activity (last 20)
      const recentActivity = (await db.execute(sql`
        SELECT id, estimate_id, user_id, action, details, timestamp
        FROM activity_log ORDER BY timestamp DESC LIMIT 20
      `)).rows;

      res.json({
        totals: {
          estimates: Number((estCount as any).c),
          emailsSent: Number((emailOutCount as any).c),
          emailsReceived: Number((emailInCount as any).c),
          contacts: Number((contactCount as any).c),
          pricingEntries: Number((pricingCount as any).c),
          purchaseOrders: Number((poCount as any).c),
          chatMessages: Number((msgCount as any).c),
          errors: Number((errCount as any).c),
          users: Number((userCount as any).c),
        },
        today: {
          gmailSends: Number((gmailToday as any).c),
          aiCalls: Number((aiToday as any).c),
        },
        limits: {
          gmail: { daily: 500, label: "Gmail API (per user)" },
          claude: { daily: "pay-per-use", label: "Claude AI (Anthropic)" },
          supabase: { storage: "1GB", rows: "500MB", label: "Supabase Free Tier" },
          render: { hours: "750/mo", label: "Render Free Tier" },
          vercel: { deploys: "unlimited", label: "Vercel Free Tier" },
        },
        usageByService,
        recentErrors,
        recentActivity,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/errors — view recent errors
  app.get("/api/admin/errors", requireAdmin as any, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const rows = await db.execute(sql`SELECT * FROM error_log ORDER BY created_at DESC LIMIT ${limit}`);
      res.json(rows.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/errors — clear error log
  app.delete("/api/admin/errors", requireAdmin as any, async (_req: Request, res: Response) => {
    try {
      await db.execute(sql`DELETE FROM error_log`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
