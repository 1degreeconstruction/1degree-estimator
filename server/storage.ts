import {
  type SalesRep, type InsertSalesRep, salesReps,
  type Estimate, type InsertEstimate, estimates,
  type LineItem, type InsertLineItem, lineItems,
  type PaymentMilestone, type InsertMilestone, paymentMilestones,
  type EstimateEvent, type InsertEvent, estimateEvents,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { eq, desc } from "drizzle-orm";

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
  getEstimates(): Promise<Estimate[]>;
  getEstimate(id: number): Promise<Estimate | undefined>;
  getEstimateByUniqueId(uniqueId: string): Promise<Estimate | undefined>;
  createEstimate(estimate: InsertEstimate): Promise<Estimate>;
  updateEstimate(id: number, data: Partial<InsertEstimate>): Promise<Estimate | undefined>;

  // Line Items
  getLineItems(estimateId: number): Promise<LineItem[]>;
  createLineItem(item: InsertLineItem): Promise<LineItem>;
  deleteLineItemsByEstimate(estimateId: number): Promise<void>;

  // Payment Milestones
  getMilestones(estimateId: number): Promise<PaymentMilestone[]>;
  createMilestone(milestone: InsertMilestone): Promise<PaymentMilestone>;
  deleteMilestonesByEstimate(estimateId: number): Promise<void>;

  // Events
  getEvents(estimateId: number): Promise<EstimateEvent[]>;
  createEvent(event: InsertEvent): Promise<EstimateEvent>;
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
  async getEstimates(): Promise<Estimate[]> {
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
    await db.delete(lineItems).where(eq(lineItems.estimateId, estimateId));
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
}

export const storage = new DatabaseStorage();

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

seedSalesReps();
