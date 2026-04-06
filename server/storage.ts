import {
  type SalesRep, type InsertSalesRep, salesReps,
  type Estimate, type InsertEstimate, estimates,
  type LineItem, type InsertLineItem, lineItems,
  type PaymentMilestone, type InsertMilestone, paymentMilestones,
  type EstimateEvent, type InsertEvent, estimateEvents,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sales_reps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_number TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    project_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip TEXT NOT NULL,
    sales_rep_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    sent_at TEXT,
    viewed_at TEXT,
    approved_at TEXT,
    signature_name TEXT,
    signature_timestamp TEXT,
    notes_internal TEXT,
    valid_until TEXT NOT NULL,
    total_sub_cost REAL NOT NULL DEFAULT 0,
    total_client_price REAL NOT NULL DEFAULT 0,
    allowance_amount REAL NOT NULL DEFAULT 0,
    deposit_amount REAL NOT NULL DEFAULT 0,
    permit_required INTEGER NOT NULL DEFAULT 0,
    unique_id TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    phase_group TEXT NOT NULL,
    scope_description TEXT NOT NULL,
    sub_cost REAL NOT NULL,
    client_price REAL NOT NULL,
    is_grouped INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS payment_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_id INTEGER NOT NULL,
    milestone_name TEXT NOT NULL,
    amount REAL NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS estimate_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata TEXT
  );
`);

export const db = drizzle(sqlite);

export interface IStorage {
  // Sales Reps
  getSalesReps(): SalesRep[];
  getSalesRep(id: number): SalesRep | undefined;
  createSalesRep(rep: InsertSalesRep): SalesRep;
  
  // Estimates
  getEstimates(): Estimate[];
  getEstimate(id: number): Estimate | undefined;
  getEstimateByUniqueId(uniqueId: string): Estimate | undefined;
  createEstimate(estimate: InsertEstimate): Estimate;
  updateEstimate(id: number, data: Partial<InsertEstimate>): Estimate | undefined;
  
  // Line Items
  getLineItems(estimateId: number): LineItem[];
  createLineItem(item: InsertLineItem): LineItem;
  deleteLineItemsByEstimate(estimateId: number): void;
  
  // Payment Milestones
  getMilestones(estimateId: number): PaymentMilestone[];
  createMilestone(milestone: InsertMilestone): PaymentMilestone;
  deleteMilestonesByEstimate(estimateId: number): void;
  
  // Events
  getEvents(estimateId: number): EstimateEvent[];
  createEvent(event: InsertEvent): EstimateEvent;
}

export class DatabaseStorage implements IStorage {
  // Sales Reps
  getSalesReps(): SalesRep[] {
    return db.select().from(salesReps).all();
  }
  
  getSalesRep(id: number): SalesRep | undefined {
    return db.select().from(salesReps).where(eq(salesReps.id, id)).get();
  }
  
  createSalesRep(rep: InsertSalesRep): SalesRep {
    return db.insert(salesReps).values(rep).returning().get();
  }
  
  // Estimates
  getEstimates(): Estimate[] {
    return db.select().from(estimates).orderBy(desc(estimates.createdAt)).all();
  }
  
  getEstimate(id: number): Estimate | undefined {
    return db.select().from(estimates).where(eq(estimates.id, id)).get();
  }
  
  getEstimateByUniqueId(uniqueId: string): Estimate | undefined {
    return db.select().from(estimates).where(eq(estimates.uniqueId, uniqueId)).get();
  }
  
  createEstimate(estimate: InsertEstimate): Estimate {
    return db.insert(estimates).values(estimate).returning().get();
  }
  
  updateEstimate(id: number, data: Partial<InsertEstimate>): Estimate | undefined {
    return db.update(estimates).set(data).where(eq(estimates.id, id)).returning().get();
  }
  
  // Line Items
  getLineItems(estimateId: number): LineItem[] {
    return db.select().from(lineItems).where(eq(lineItems.estimateId, estimateId)).all();
  }
  
  createLineItem(item: InsertLineItem): LineItem {
    return db.insert(lineItems).values(item).returning().get();
  }
  
  deleteLineItemsByEstimate(estimateId: number): void {
    db.delete(lineItems).where(eq(lineItems.estimateId, estimateId)).run();
  }
  
  // Payment Milestones
  getMilestones(estimateId: number): PaymentMilestone[] {
    return db.select().from(paymentMilestones).where(eq(paymentMilestones.estimateId, estimateId)).all();
  }
  
  createMilestone(milestone: InsertMilestone): PaymentMilestone {
    return db.insert(paymentMilestones).values(milestone).returning().get();
  }
  
  deleteMilestonesByEstimate(estimateId: number): void {
    db.delete(paymentMilestones).where(eq(paymentMilestones.estimateId, estimateId)).run();
  }
  
  // Events
  getEvents(estimateId: number): EstimateEvent[] {
    return db.select().from(estimateEvents).where(eq(estimateEvents.estimateId, estimateId)).all();
  }
  
  createEvent(event: InsertEvent): EstimateEvent {
    return db.insert(estimateEvents).values(event).returning().get();
  }
}

export const storage = new DatabaseStorage();

// Seed sales reps on startup
function seedSalesReps() {
  const existing = storage.getSalesReps();
  if (existing.length === 0) {
    storage.createSalesRep({ name: "David Gaon", title: "Co-Founder", email: "david@1degreeconstruction.com", phone: "818-720-1753" });
    storage.createSalesRep({ name: "Thai Gaon", title: "Co-Founder", email: "thai@1degreeconstruction.com", phone: "818-674-3373" });
    storage.createSalesRep({ name: "Oliver Loshitzer", title: "Project Manager", email: "oliver@1degreeconstruction.com", phone: "310-808-3118" });
  }
}

seedSalesReps();
