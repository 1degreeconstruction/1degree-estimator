import {
  type SalesRep, type InsertSalesRep, salesReps,
  type Estimate, type InsertEstimate, estimates,
  type LineItem, type InsertLineItem, lineItems,
  type LineItemBreakdown, type InsertLineItemBreakdown, lineItemBreakdowns,
  type PaymentMilestone, type InsertMilestone, paymentMilestones,
  type EstimateEvent, type InsertEvent, estimateEvents,
  type User, type InsertUser, users,
  type PricingHistory, pricingHistory,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });

export interface IStorage {
  // Sales Reps
  getSalesReps(): Promise<SalesRep[]>;
  getSalesRep(id: number): Promise<SalesRep | undefined>;
  createSalesRep(rep: InsertSalesRep): Promise<SalesRep>;

  // Estimates
  getEstimates(createdByUserId?: number): Promise<Estimate[]>;
  getEstimate(id: number): Promise<Estimate | undefined>;
  getEstimateByUniqueId(uniqueId: string): Promise<Estimate | undefined>;
  createEstimate(estimate: InsertEstimate): Promise<Estimate>;
  updateEstimate(id: number, data: Partial<InsertEstimate>): Promise<Estimate | undefined>;

  // Line Items
  getLineItems(estimateId: number): Promise<LineItem[]>;
  createLineItem(item: InsertLineItem): Promise<LineItem>;
  deleteLineItemsByEstimate(estimateId: number): Promise<void>;

  // Line Item Breakdowns
  getBreakdownsByLineItem(lineItemId: number): Promise<LineItemBreakdown[]>;
  getBreakdownsByEstimate(estimateId: number): Promise<LineItemBreakdown[]>;
  createBreakdown(breakdown: InsertLineItemBreakdown): Promise<LineItemBreakdown>;
  deleteBreakdownsByLineItem(lineItemId: number): Promise<void>;

  // Payment Milestones
  getMilestones(estimateId: number): Promise<PaymentMilestone[]>;
  createMilestone(milestone: InsertMilestone): Promise<PaymentMilestone>;
  deleteMilestonesByEstimate(estimateId: number): Promise<void>;

  // Events
  getEvents(estimateId: number): Promise<EstimateEvent[]>;
  createEvent(event: InsertEvent): Promise<EstimateEvent>;

  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User>;
  listUsers(): Promise<User[]>;

  // Pricing History
  logPricing(entries: Array<{trade: string; scopeKeyword: string; subCost: number; city?: string; source: string; estimateId?: number}>): Promise<void>;
  getRecentPricing(trade: string, limit?: number): Promise<PricingHistory[]>;
  getAllRecentPricing(limit?: number): Promise<PricingHistory[]>;

  // AI Log
  updateEstimateAiLog(estimateId: number, logEntry: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Sales Reps
  async getSalesReps(): Promise<SalesRep[]> {
    return db.select().from(salesReps);
  }

  async getSalesRep(id: number): Promise<SalesRep | undefined> {
    const rows = await db.select().from(salesReps).where(eq(salesReps.id, id));
    return rows[0];
  }

  async createSalesRep(rep: InsertSalesRep): Promise<SalesRep> {
    const rows = await db.insert(salesReps).values(rep).returning();
    return rows[0];
  }

  // Estimates
  async getEstimates(createdByUserId?: number): Promise<Estimate[]> {
    if (createdByUserId !== undefined) {
      return db.select().from(estimates)
        .where(eq(estimates.createdByUserId, createdByUserId))
        .orderBy(desc(estimates.createdAt));
    }
    return db.select().from(estimates).orderBy(desc(estimates.createdAt));
  }

  async getEstimate(id: number): Promise<Estimate | undefined> {
    const rows = await db.select().from(estimates).where(eq(estimates.id, id));
    return rows[0];
  }

  async getEstimateByUniqueId(uniqueId: string): Promise<Estimate | undefined> {
    const rows = await db.select().from(estimates).where(eq(estimates.uniqueId, uniqueId));
    return rows[0];
  }

  async createEstimate(estimate: InsertEstimate): Promise<Estimate> {
    const rows = await db.insert(estimates).values(estimate).returning();
    return rows[0];
  }

  async updateEstimate(id: number, data: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const rows = await db.update(estimates).set(data).where(eq(estimates.id, id)).returning();
    return rows[0];
  }

  // Line Items
  async getLineItems(estimateId: number): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId));
  }

  async createLineItem(item: InsertLineItem): Promise<LineItem> {
    const rows = await db.insert(lineItems).values(item).returning();
    return rows[0];
  }

  async deleteLineItemsByEstimate(estimateId: number): Promise<void> {
    // Cascade: delete breakdowns for all line items in this estimate first
    const items = await this.getLineItems(estimateId);
    for (const item of items) {
      await db.delete(lineItemBreakdowns).where(eq(lineItemBreakdowns.lineItemId, item.id));
    }
    await db.delete(lineItems).where(eq(lineItems.estimateId, estimateId));
  }

  // Line Item Breakdowns
  async getBreakdownsByLineItem(lineItemId: number): Promise<LineItemBreakdown[]> {
    return db.select().from(lineItemBreakdowns)
      .where(eq(lineItemBreakdowns.lineItemId, lineItemId))
      .orderBy(lineItemBreakdowns.sortOrder);
  }

  async getBreakdownsByEstimate(estimateId: number): Promise<LineItemBreakdown[]> {
    // Join via line_items
    const items = await this.getLineItems(estimateId);
    const allBreakdowns: LineItemBreakdown[] = [];
    for (const item of items) {
      const bds = await this.getBreakdownsByLineItem(item.id);
      allBreakdowns.push(...bds);
    }
    return allBreakdowns;
  }

  async createBreakdown(breakdown: InsertLineItemBreakdown): Promise<LineItemBreakdown> {
    const rows = await db.insert(lineItemBreakdowns).values(breakdown).returning();
    return rows[0];
  }

  async deleteBreakdownsByLineItem(lineItemId: number): Promise<void> {
    await db.delete(lineItemBreakdowns).where(eq(lineItemBreakdowns.lineItemId, lineItemId));
  }

  // Payment Milestones
  async getMilestones(estimateId: number): Promise<PaymentMilestone[]> {
    return db.select().from(paymentMilestones).where(eq(paymentMilestones.estimateId, estimateId));
  }

  async createMilestone(milestone: InsertMilestone): Promise<PaymentMilestone> {
    const rows = await db.insert(paymentMilestones).values(milestone).returning();
    return rows[0];
  }

  async deleteMilestonesByEstimate(estimateId: number): Promise<void> {
    await db.delete(paymentMilestones).where(eq(paymentMilestones.estimateId, estimateId));
  }

  // Events
  async getEvents(estimateId: number): Promise<EstimateEvent[]> {
    return db.select().from(estimateEvents).where(eq(estimateEvents.estimateId, estimateId));
  }

  async createEvent(event: InsertEvent): Promise<EstimateEvent> {
    const rows = await db.insert(estimateEvents).values(event).returning();
    return rows[0];
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.googleId, googleId));
    return rows[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(user).returning();
    return rows[0];
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User> {
    const rows = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return rows[0];
  }

  async listUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  // Pricing History
  async logPricing(entries: Array<{trade: string; scopeKeyword: string; subCost: number; city?: string; source: string; estimateId?: number}>): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(pricingHistory).values(entries.map(e => ({
      trade: e.trade,
      scopeKeyword: e.scopeKeyword.slice(0, 50),
      subCost: e.subCost,
      city: e.city || null,
      source: e.source,
      estimateId: e.estimateId || null,
      createdAt: new Date(),
    })));
  }

  async getRecentPricing(trade: string, limit = 10): Promise<PricingHistory[]> {
    return db.select().from(pricingHistory)
      .where(eq(pricingHistory.trade, trade))
      .orderBy(desc(pricingHistory.createdAt))
      .limit(limit);
  }

  async getAllRecentPricing(limit = 100): Promise<PricingHistory[]> {
    return db.select().from(pricingHistory)
      .orderBy(desc(pricingHistory.createdAt))
      .limit(limit);
  }

  // AI Log
  async updateEstimateAiLog(estimateId: number, logEntry: string): Promise<void> {
    const existing = await this.getEstimate(estimateId);
    if (!existing) return;
    const currentLog = existing.aiLog || "";
    const newLog = currentLog + logEntry;
    await db.update(estimates).set({ aiLog: newLog }).where(eq(estimates.id, estimateId));
  }
}

export const storage = new DatabaseStorage();

// Initialize DB: add columns/tables if missing
async function initializeDb() {
  try {
    await pool.query(`
      ALTER TABLE estimates ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);
    `);
    await pool.query(`
      ALTER TABLE estimates ADD COLUMN IF NOT EXISTS ai_log TEXT;
    `);
    await pool.query(`
      ALTER TABLE estimates ADD COLUMN IF NOT EXISTS project_inclusions TEXT;
    `);
    await pool.query(`
      ALTER TABLE estimates ADD COLUMN IF NOT EXISTS project_exclusions TEXT;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_history (
        id SERIAL PRIMARY KEY,
        trade TEXT NOT NULL,
        scope_keyword TEXT NOT NULL,
        sub_cost REAL NOT NULL,
        city TEXT,
        source TEXT NOT NULL DEFAULT 'user_edit',
        estimate_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS line_item_breakdowns (
        id SERIAL PRIMARY KEY,
        line_item_id INTEGER NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
        trade_name TEXT NOT NULL,
        sub_cost REAL NOT NULL DEFAULT 0,
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_breakdowns_line_item ON line_item_breakdowns(line_item_id);
    `);
    console.log("DB initialization complete.");
  } catch (err) {
    console.error("DB init error:", err);
  }
}

// Seed sales reps on startup
async function seedSalesReps() {
  try {
    const existing = await storage.getSalesReps();
    if (existing.length === 0) {
      await storage.createSalesRep({ name: "David Gaon", title: "Co-Founder", email: "david@1degreeconstruction.com", phone: "818-720-1753" });
      await storage.createSalesRep({ name: "Thai Gaon", title: "Co-Founder", email: "thai@1degreeconstruction.com", phone: "818-674-3373" });
      await storage.createSalesRep({ name: "Oliver Loshitzer", title: "Project Manager", email: "oliver@1degreeconstruction.com", phone: "310-808-3118" });
      console.log("Sales reps seeded.");
    }
  } catch (err) {
    console.error("Seed error (DB may not be connected yet):", err);
  }
}

initializeDb().then(() => seedSalesReps());
