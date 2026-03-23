import { z } from 'zod';
import { insertMessageSchema, insertEscalationSchema, messages, escalations } from './schema';
import type { Conversation } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  unauthorized: z.object({ message: z.string() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  conversations: {
    list: {
      method: 'GET' as const,
      path: '/api/conversations' as const,
      responses: {
        200: z.array(z.custom<Conversation>())
      }
    }
  },
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login' as const,
      input: z.object({ password: z.string() }),
      responses: {
        200: z.object({ success: z.boolean() }),
        401: errorSchemas.unauthorized,
      }
    },
    logout: {
      method: 'POST' as const,
      path: '/api/logout' as const,
      responses: {
        200: z.object({ success: z.boolean() })
      }
    },
    me: {
      method: 'GET' as const,
      path: '/api/me' as const,
      responses: {
        200: z.object({
          authenticated: z.boolean(),
          role: z.string().optional(),
          agentId: z.number().nullable().optional(),
          agentName: z.string().optional(),
        }),
        401: errorSchemas.unauthorized,
      }
    }
  },
  escalations: {
    list: {
      method: 'GET' as const,
      path: '/api/escalations' as const,
      responses: {
        200: z.array(z.custom<typeof escalations.$inferSelect>())
      }
    },
    escalate: {
      method: 'POST' as const,
      path: '/api/escalate' as const,
      input: z.object({ customer_phone: z.string(), escalation_reason: z.string() }),
      responses: {
        200: z.custom<typeof escalations.$inferSelect>(),
        400: errorSchemas.validation,
      }
    },
    close: {
      method: 'POST' as const,
      path: '/api/close' as const,
      input: z.object({ customer_phone: z.string() }),
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
      }
    }
  },
  messages: {
    list: {
      method: 'GET' as const,
      path: '/api/messages/:phone' as const,
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      }
    },
    send: {
      method: 'POST' as const,
      path: '/api/send' as const,
      input: z.object({ customer_phone: z.string(), message: z.string() }),
      responses: {
        200: z.custom<typeof messages.$inferSelect>(),
        400: errorSchemas.validation,
      }
    },
    incoming: {
      method: 'POST' as const,
      path: '/api/incoming' as const,
      input: z.object({ customer_phone: z.string(), message_text: z.string() }),
      responses: {
        200: z.object({ success: z.boolean() }),
      }
    }
  },
  push: {
    vapidPublicKey: {
      method: 'GET' as const,
      path: '/api/push/vapid-public-key' as const,
      responses: {
        200: z.object({ publicKey: z.string() })
      }
    },
    subscribe: {
      method: 'POST' as const,
      path: '/api/push/subscribe' as const,
      input: z.any(),
      responses: {
        200: z.object({ success: z.boolean() })
      }
    },
    unsubscribe: {
      method: 'POST' as const,
      path: '/api/push/unsubscribe' as const,
      input: z.any(),
      responses: {
        200: z.object({ success: z.boolean() })
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
