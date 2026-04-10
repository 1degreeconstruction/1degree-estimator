import {
  type SalesRep, type InsertSalesRep, salesReps,
  type Estimate, type InsertEstimate, estimates,
  type LineItem, type InsertLineItem, lineItems,
  type LineItemBreakdown, type InsertLineItemBreakdown, lineItemBreakdowns,
  type PaymentMilestone, type InsertMilestone, paymentMilestones,
  type EstimateEvent, type InsertEvent, estimateEvents,
  type User, type InsertUser, users,
  type PricingHistory, pricingHistory,
  type PurchaseOrder, type InsertPurchaseOrder, purchaseOrders,
  type EstimatePurchaseOrderLink, estimatePurchaseOrderLinks,
  type EmailLog, type InsertEmailLog, emailLogs,
  type EstimateMessage, type InsertEstimateMessage, estimateMessages,
  type Contact, type InsertContact, contacts,
  teamConfig, activityLog,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { eq, desc, and, or, ilike, inArray } from "drizzle-orm";

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
  deleteEstimate(estimateId: number): Promise<void>;
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
  logPricing(entries: Array<{trade: string; scopeKeyword: string; subCost: number; clientPrice?: number; markupRate?: number; city?: string; source: string; estimateId?: number; salesRepId?: number}>): Promise<void>;
  getRecentPricing(trade: string, limit?: number): Promise<PricingHistory[]>;
  getAllRecentPricing(limit?: number): Promise<PricingHistory[]>;

  // AI Log
  updateEstimateAiLog(estimateId: number, logEntry: string): Promise<void>;

  // Purchase Orders
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  getPurchaseOrders(estimateId?: number): Promise<PurchaseOrder[]>;
  updatePurchaseOrder(id: number, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined>;

  // PO Links (junction table)
  linkPurchaseOrderToEstimate(purchaseOrderId: number, estimateId: number): Promise<EstimatePurchaseOrderLink>;
  getLinkedPurchaseOrders(estimateId: number): Promise<PurchaseOrder[]>;
  isPurchaseOrderLinked(purchaseOrderId: number, estimateId: number): Promise<boolean>;
  searchConfirmedPurchaseOrders(query: string): Promise<Array<PurchaseOrder & { projectAddress?: string }>>;

  // Email Logs
  logEmail(entry: Omit<InsertEmailLog, 'id'>): Promise<EmailLog>;
  getEmailsForEstimate(estimateId: number): Promise<EmailLog[]>;
  getAllEmails(limit?: number): Promise<EmailLog[]>;
  getUnreadEmailCount(): Promise<number>;
  markEmailRead(id: number): Promise<void>;
  upsertEmailByMessageId(messageId: string, entry: Partial<InsertEmailLog>): Promise<void>;

  // Team Config
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;

  // Activity Log
  logActivity(entry: { estimateId?: number; userId?: number; action: string; details?: string; metadata?: any }): Promise<void>;
  getActivityFeed(estimateId?: number, limit?: number): Promise<any[]>;

  // Contacts
  getContacts(): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: number, updates: Partial<Contact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<void>;
  searchContacts(query: string): Promise<Contact[]>;
  getEstimatesForContact(contactName: string, contactEmail?: string): Promise<Estimate[]>;

  // Estimate Messages
  createMessage(msg: InsertEstimateMessage): Promise<EstimateMessage>;
  getMessages(estimateId: number): Promise<EstimateMessage[]>;
  getUnreadClientMessages(): Promise<EstimateMessage[]>;
  markMessagesRead(estimateId: number, senderType: string): Promise<void>;
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

  async deleteEstimate(estimateId: number): Promise<void> {
    // Delete all related records first (order matters for FK constraints)
    await db.delete(estimateMessages).where(eq(estimateMessages.estimateId, estimateId));
    await db.delete(emailLogs).where(eq(emailLogs.estimateId, estimateId));
    await db.delete(activityLog).where(eq(activityLog.estimateId, estimateId));
    await db.delete(pricingHistory).where(eq(pricingHistory.estimateId, estimateId));
    await db.delete(estimatePurchaseOrderLinks).where(eq(estimatePurchaseOrderLinks.estimateId, estimateId));
    // Delete breakdowns via line items
    const items = await this.getLineItems(estimateId);
    for (const item of items) {
      await db.delete(lineItemBreakdowns).where(eq(lineItemBreakdowns.lineItemId, item.id));
    }
    await this.deleteLineItemsByEstimate(estimateId);
    await this.deleteMilestonesByEstimate(estimateId);
    await db.delete(estimateEvents).where(eq(estimateEvents.estimateId, estimateId));
    // Finally delete the estimate
    await db.delete(estimates).where(eq(estimates.id, estimateId));
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
  async logPricing(entries: Array<{trade: string; scopeKeyword: string; subCost: number; clientPrice?: number; markupRate?: number; city?: string; source: string; estimateId?: number; salesRepId?: number}>): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(pricingHistory).values(entries.map(e => ({
      trade: e.trade,
      scopeKeyword: e.scopeKeyword.slice(0, 50),
      subCost: e.subCost,
      clientPrice: e.clientPrice ?? null,
      markupRate: e.markupRate ?? null,
      city: e.city || null,
      source: e.source,
      estimateId: e.estimateId || null,
      salesRepId: e.salesRepId ?? null,
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

  // Purchase Orders
  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const rows = await db.insert(purchaseOrders).values(po).returning();
    return rows[0];
  }

  async getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
    const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    return rows[0];
  }

  async getPurchaseOrders(estimateId?: number): Promise<PurchaseOrder[]> {
    if (estimateId !== undefined) {
      return db.select().from(purchaseOrders)
        .where(eq(purchaseOrders.estimateId, estimateId))
        .orderBy(desc(purchaseOrders.createdAt));
    }
    return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
  }

  async updatePurchaseOrder(id: number, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const rows = await db.update(purchaseOrders).set(updates).where(eq(purchaseOrders.id, id)).returning();
    return rows[0];
  }

  // PO Links
  async linkPurchaseOrderToEstimate(purchaseOrderId: number, estimateId: number): Promise<EstimatePurchaseOrderLink> {
    // Upsert — ignore conflict
    const rows = await db.insert(estimatePurchaseOrderLinks)
      .values({ purchaseOrderId, estimateId })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0];
    // If already exists, return existing
    const existing = await db.select().from(estimatePurchaseOrderLinks)
      .where(and(
        eq(estimatePurchaseOrderLinks.purchaseOrderId, purchaseOrderId),
        eq(estimatePurchaseOrderLinks.estimateId, estimateId),
      ));
    return existing[0];
  }

  async getLinkedPurchaseOrders(estimateId: number): Promise<PurchaseOrder[]> {
    // Get PO ids from junction table
    const links = await db.select().from(estimatePurchaseOrderLinks)
      .where(eq(estimatePurchaseOrderLinks.estimateId, estimateId));
    if (links.length === 0) return [];
    const poIds = links.map(l => l.purchaseOrderId);
    return db.select().from(purchaseOrders)
      .where(inArray(purchaseOrders.id, poIds))
      .orderBy(desc(purchaseOrders.createdAt));
  }

  async isPurchaseOrderLinked(purchaseOrderId: number, estimateId: number): Promise<boolean> {
    const rows = await db.select().from(estimatePurchaseOrderLinks)
      .where(and(
        eq(estimatePurchaseOrderLinks.purchaseOrderId, purchaseOrderId),
        eq(estimatePurchaseOrderLinks.estimateId, estimateId),
      ));
    return rows.length > 0;
  }

  async searchConfirmedPurchaseOrders(query: string): Promise<Array<PurchaseOrder & { projectAddress?: string }>> {
    // Get all confirmed POs
    const allConfirmed = await db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.status, "confirmed"))
      .orderBy(desc(purchaseOrders.createdAt));

    if (!query || query.trim() === "") {
      // Return all confirmed POs with project address enrichment
      return this._enrichPOsWithProjectAddress(allConfirmed);
    }

    const q = query.toLowerCase();
    const filtered = allConfirmed.filter(po => {
      const parsed = po.parsedData as { subName?: string; items?: Array<{ trade?: string }> } | null;
      const subName = (parsed?.subName || "").toLowerCase();
      const trades = (parsed?.items || []).map((i: { trade?: string }) => (i.trade || "").toLowerCase()).join(" ");
      const filename = (po.filename || "").toLowerCase();
      return subName.includes(q) || trades.includes(q) || filename.includes(q);
    });

    return this._enrichPOsWithProjectAddress(filtered);
  }

  private async _enrichPOsWithProjectAddress(pos: PurchaseOrder[]): Promise<Array<PurchaseOrder & { projectAddress?: string }>> {
    const estimateIds = [...new Set(pos.filter(p => p.estimateId).map(p => p.estimateId!))];
    const addressMap: Record<number, string> = {};
    if (estimateIds.length > 0) {
      const estRows = await db.select().from(estimates).where(inArray(estimates.id, estimateIds));
      for (const e of estRows) {
        addressMap[e.id] = e.projectAddress + (e.city ? ", " + e.city : "");
      }
    }
    return pos.map(po => ({
      ...po,
      projectAddress: po.estimateId ? addressMap[po.estimateId] : undefined,
    }));
  }

  // Email Logs
  async logEmail(entry: Omit<InsertEmailLog, 'id'>): Promise<EmailLog> {
    const rows = await db.insert(emailLogs).values(entry as any).returning();
    return rows[0];
  }

  async getEmailsForEstimate(estimateId: number): Promise<EmailLog[]> {
    return db.select().from(emailLogs)
      .where(eq(emailLogs.estimateId, estimateId))
      .orderBy(desc(emailLogs.sentAt));
  }

  async getAllEmails(limit = 100): Promise<EmailLog[]> {
    return db.select().from(emailLogs)
      .orderBy(desc(emailLogs.sentAt))
      .limit(limit);
  }

  async getUnreadEmailCount(): Promise<number> {
    const rows = await db.select().from(emailLogs)
      .where(and(eq(emailLogs.direction, "inbound"), eq(emailLogs.isRead, false)));
    return rows.length;
  }

  async markEmailRead(id: number): Promise<void> {
    await db.update(emailLogs).set({ isRead: true }).where(eq(emailLogs.id, id));
  }

  async upsertEmailByMessageId(messageId: string, entry: Partial<InsertEmailLog>): Promise<void> {
    const existing = await db.select().from(emailLogs).where(eq(emailLogs.gmailMessageId, messageId)).limit(1);
    if (existing.length === 0) {
      await db.insert(emailLogs).values({ ...(entry as any), gmailMessageId: messageId });
    }
  }

  // Team Config
  async getConfig(key: string): Promise<string | null> {
    const rows = await db.select().from(teamConfig).where(eq(teamConfig.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await db.insert(teamConfig)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: teamConfig.key, set: { value, updatedAt: new Date() } });
  }

  // Activity Log
  async logActivity(entry: { estimateId?: number; userId?: number; action: string; details?: string; metadata?: any }): Promise<void> {
    await db.insert(activityLog).values({
      estimateId: entry.estimateId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      details: entry.details ?? null,
      metadata: entry.metadata ?? null,
      timestamp: new Date(),
    });
  }

  async getActivityFeed(estimateId?: number, limit = 50): Promise<any[]> {
    if (estimateId) {
      return db.select().from(activityLog)
        .where(eq(activityLog.estimateId, estimateId))
        .orderBy(desc(activityLog.timestamp))
        .limit(limit);
    }
    return db.select().from(activityLog)
      .orderBy(desc(activityLog.timestamp))
      .limit(limit);
  }

  // Contacts
  async getContacts(): Promise<Contact[]> {
    return db.select().from(contacts).orderBy(contacts.name);
  }

  async getContact(id: number): Promise<Contact | undefined> {
    return db.select().from(contacts).where(eq(contacts.id, id)).limit(1).then(r => r[0]);
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const rows = await db.insert(contacts).values(contact).returning();
    return rows[0];
  }

  async updateContact(id: number, updates: Partial<Contact>): Promise<Contact | undefined> {
    const rows = await db.update(contacts).set(updates).where(eq(contacts.id, id)).returning();
    return rows[0];
  }

  async deleteContact(id: number): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const all = await this.getContacts();
    const q = query.toLowerCase();
    return all.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.address || "").toLowerCase().includes(q)
    );
  }

  async getEstimatesForContact(contactName: string, contactEmail?: string): Promise<Estimate[]> {
    const all = await this.getEstimates();
    return all.filter(e =>
      e.clientName.toLowerCase() === contactName.toLowerCase() ||
      (contactEmail && e.clientEmail?.toLowerCase() === contactEmail.toLowerCase())
    );
  }

  // Estimate Messages
  async createMessage(msg: InsertEstimateMessage): Promise<EstimateMessage> {
    const rows = await db.insert(estimateMessages).values(msg as any).returning();
    return rows[0];
  }

  async getMessages(estimateId: number): Promise<EstimateMessage[]> {
    return db.select().from(estimateMessages)
      .where(eq(estimateMessages.estimateId, estimateId))
      .orderBy(estimateMessages.createdAt);
  }

  async getUnreadClientMessages(): Promise<EstimateMessage[]> {
    return db.select().from(estimateMessages)
      .where(and(eq(estimateMessages.senderType, "client"), eq(estimateMessages.isRead, false)))
      .orderBy(desc(estimateMessages.createdAt));
  }

  async markMessagesRead(estimateId: number, senderType: string): Promise<void> {
    await db.update(estimateMessages)
      .set({ isRead: true })
      .where(and(eq(estimateMessages.estimateId, estimateId), eq(estimateMessages.senderType, senderType)));
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        estimate_id INTEGER REFERENCES estimates(id),
        uploaded_by_user_id INTEGER REFERENCES users(id),
        filename TEXT NOT NULL,
        file_url TEXT NOT NULL,
        raw_ocr_text TEXT,
        parsed_data JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_po_estimate ON purchase_orders(estimate_id);
    `);
    // Junction table for cross-project PO linking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS estimate_purchase_order_links (
        id SERIAL PRIMARY KEY,
        estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(estimate_id, purchase_order_id)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_epo_estimate ON estimate_purchase_order_links(estimate_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_epo_po ON estimate_purchase_order_links(purchase_order_id);
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
