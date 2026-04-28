/**
 * email.test.ts — Tests for notifyManagerNewBooking.
 *
 * Verifies: recipient resolution from DB, MANAGER_EMAIL fallback,
 * per-recipient send + logging, error resilience.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories and module imports — required
// for variables referenced inside class field initializers.
const mockSend = vi.hoisted(() => vi.fn());

// Mock DB pool before importing email.ts
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

// Mock Brevo (the actual email client used by email.ts)
vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: class MockBrevoClient {
    transactionalEmails = { sendTransacEmail: mockSend };
  },
}));

import { pool } from '../server/db';
import { notifyManagerNewBooking } from '../server/email';

const BASE_OPTS = {
  companyId: 1,
  customerPhone: '971501234567',
  dateTimeLabel: '2026-04-21 10:00',
  meetingLink: 'https://wak.daily.co/test-room',
  scheduledUtc: new Date('2026-04-21T07:00:00Z'),
};

describe('notifyManagerNewBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MANAGER_EMAIL;
  });

  it('sends to admin emails resolved from the DB', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [{ email: 'admin@wak.com' }, { email: 'ceo@wak.com' }],
    });
    mockSend.mockResolvedValue({});

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Brevo to field is [{ email }], not a plain string
    expect(mockSend.mock.calls[0][0].to[0].email).toBe('admin@wak.com');
    expect(mockSend.mock.calls[1][0].to[0].email).toBe('ceo@wak.com');
  });

  it('falls back to MANAGER_EMAIL when DB returns no admins', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    process.env.MANAGER_EMAIL = 'manager@external.com';
    mockSend.mockResolvedValue({});

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to[0].email).toBe('manager@external.com');
  });

  it('appends MANAGER_EMAIL as extra recipient when DB has admins', async () => {
    (pool.query as any).mockResolvedValue({ rows: [{ email: 'admin@wak.com' }] });
    process.env.MANAGER_EMAIL = 'extra@external.com';
    mockSend.mockResolvedValue({});

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const tos = mockSend.mock.calls.map((c: any) => c[0].to[0].email);
    expect(tos).toContain('admin@wak.com');
    expect(tos).toContain('extra@external.com');
  });

  it('does not send when no recipients found at all', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('continues to next recipient if one send throws', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [{ email: 'admin1@wak.com' }, { email: 'admin2@wak.com' }],
    });
    mockSend
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({});

    await expect(notifyManagerNewBooking(BASE_OPTS)).resolves.not.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('DB query filters by companyId', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });

    await notifyManagerNewBooking({ ...BASE_OPTS, companyId: 42 });

    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toContain('company_id');
    expect(params).toContain(42);
    expect(sql).toContain("role = 'admin'");
  });
});
