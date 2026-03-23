import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  customer_phone: text("customer_phone").notNull(),
  direction: text("direction").notNull(), // 'inbound' | 'outbound'
  message_text: text("message_text").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  sender: text("sender").notNull(), // 'customer' | 'ai' | 'agent'
});

export const escalations = pgTable("escalations", {
  customer_phone: text("customer_phone").primaryKey(),
  escalation_reason: text("escalation_reason").notNull(),
  status: text("status").notNull().default('open'), // 'open' | 'closed'
  created_at: timestamp("created_at").defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, created_at: true });
export const insertEscalationSchema = createInsertSchema(escalations).omit({ created_at: true });

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Escalation = typeof escalations.$inferSelect;
export type InsertEscalation = z.infer<typeof insertEscalationSchema>;

// A unified conversation view: derived from messages table, joined with escalation status
export interface Conversation {
  customer_phone: string;
  last_message: string;
  last_message_at: string | null;
  escalation_status: string | null; // 'open' | 'closed' | null (no escalation record)
  escalation_reason: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
}
