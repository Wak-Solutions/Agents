import { db } from "./db";
import {
  messages,
  escalations,
  type Message,
  type InsertMessage,
  type Escalation,
  type InsertEscalation,
  type Conversation
} from "@shared/schema";
import { eq, desc, asc, sql, inArray, and } from "drizzle-orm";

export interface StatsPerDay {
  date: string;   // 'YYYY-MM-DD'
  count: number;
}

export interface IStorage {
  getConversations(companyId: number): Promise<Conversation[]>;
  getOpenEscalations(companyId: number): Promise<Escalation[]>;
  getEscalation(phone: string, companyId: number): Promise<Escalation | undefined>;
  createEscalation(escalation: InsertEscalation): Promise<Escalation>;
  closeEscalation(phone: string, companyId: number): Promise<void>;
  getMessages(phone: string, companyId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  getStatsCustomersPerDay(from: Date, to: Date, companyId: number): Promise<StatsPerDay[]>;
  getTotalUniqueCustomers(from: Date, to: Date, companyId: number): Promise<number>;
  getInboundMessagesForSummary(from: Date, to: Date, companyId: number): Promise<Pick<Message, 'customer_phone' | 'message_text' | 'sender' | 'created_at'>[]>;
}

export class DatabaseStorage implements IStorage {
  async getConversations(companyId: number): Promise<Conversation[]> {
    const result = await db.execute(sql`
      SELECT
        m.customer_phone,
        (SELECT message_text FROM messages WHERE customer_phone = m.customer_phone AND company_id = ${companyId} ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at  FROM messages WHERE customer_phone = m.customer_phone AND company_id = ${companyId} ORDER BY created_at DESC LIMIT 1) AS last_message_at,
        e.status            AS escalation_status,
        e.escalation_reason
      FROM (SELECT DISTINCT customer_phone FROM messages WHERE company_id = ${companyId}) m
      LEFT JOIN escalations e ON e.customer_phone = m.customer_phone AND e.company_id = ${companyId}
      ORDER BY last_message_at DESC NULLS LAST
    `);
    return result.rows as unknown as Conversation[];
  }

  async getOpenEscalations(companyId: number): Promise<Escalation[]> {
    return await db.select().from(escalations)
      .where(and(
        inArray(escalations.status, ['open', 'in_progress']),
        eq(escalations.company_id as any, companyId)
      ))
      .orderBy(desc(escalations.created_at));
  }

  async getEscalation(phone: string, companyId: number): Promise<Escalation | undefined> {
    const [escalation] = await db.select().from(escalations).where(
      and(eq(escalations.customer_phone, phone), eq(escalations.company_id as any, companyId))
    );
    return escalation;
  }

  async createEscalation(escalation: InsertEscalation): Promise<Escalation> {
    const [newEscalation] = await db.insert(escalations).values(escalation).returning();
    return newEscalation;
  }

  async closeEscalation(phone: string, companyId: number): Promise<void> {
    await db.update(escalations)
      .set({ status: 'closed' })
      .where(and(eq(escalations.customer_phone, phone), eq(escalations.company_id as any, companyId)));
  }

  async getMessages(phone: string, companyId: number): Promise<Message[]> {
    return await db.select().from(messages).where(
      and(eq(messages.customer_phone, phone), eq(messages.company_id as any, companyId))
    ).orderBy(asc(messages.created_at));
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();
    return newMessage;
  }

  async getStatsCustomersPerDay(from: Date, to: Date, companyId: number): Promise<StatsPerDay[]> {
    const result = await db.execute(sql`
      SELECT
        DATE(created_at) AS date,
        COUNT(DISTINCT customer_phone)::int AS count
      FROM messages
      WHERE direction = 'inbound'
        AND company_id = ${companyId}
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    return result.rows as unknown as StatsPerDay[];
  }

  async getTotalUniqueCustomers(from: Date, to: Date, companyId: number): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(DISTINCT customer_phone)::int AS total
      FROM messages
      WHERE direction = 'inbound'
        AND company_id = ${companyId}
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
    `);
    const row = result.rows[0] as any;
    return row?.total ?? 0;
  }

  async getInboundMessagesForSummary(from: Date, to: Date, companyId: number): Promise<Pick<Message, 'customer_phone' | 'message_text' | 'sender' | 'created_at'>[]> {
    const result = await db.execute(sql`
      SELECT customer_phone, message_text, sender, created_at
      FROM messages
      WHERE direction = 'inbound'
        AND company_id = ${companyId}
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
      ORDER BY created_at DESC
      LIMIT 300
    `);
    return result.rows as unknown as Pick<Message, 'customer_phone' | 'message_text' | 'sender' | 'created_at'>[];
  }
}

export const storage = new DatabaseStorage();
