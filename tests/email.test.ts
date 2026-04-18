/**
 * email.test.ts — Tests for notifyManagerNewBooking.
 *
 * Verifies: recipient resolution from DB, MANAGER_EMAIL fallback,
 * missing-env-var guards, per-recipient send + logging.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB pool before importing email.ts
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

// Mock Resend
const mockSend = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
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
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'no-reply@wak-solutions.com';
  });

  it('sends to admin emails resolved from the DB', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [{ email: 'admin@wak.com' }, { email: 'ceo@wak.com' }],
    });
    mockSend.mockResolvedValue({ data: { id: 'msg_1' } });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].to).toBe('admin@wak.com');
    expect(mockSend.mock.calls[1][0].to).toBe('ceo@wak.com');
  });

  it('falls back to MANAGER_EMAIL when DB returns no admins', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    process.env.MANAGER_EMAIL = 'manager@external.com';
    mockSend.mockResolvedValue({ data: { id: 'msg_2' } });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe('manager@external.com');
  });

  it('appends MANAGER_EMAIL as extra recipient when DB has admins', async () => {
    (pool.query as any).mockResolvedValue({ rows: [{ email: 'admin@wak.com' }] });
    process.env.MANAGER_EMAIL = 'extra@external.com';
    mockSend.mockResolvedValue({ data: { id: 'msg_3' } });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const tos = mockSend.mock.calls.map((c: any) => c[0].to);
    expect(tos).toContain('admin@wak.com');
    expect(tos).toContain('extra@external.com');
  });

  it('does not send when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;
    (pool.query as any).mockResolvedValue({ rows: [{ email: 'admin@wak.com' }] });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send when RESEND_FROM_EMAIL is missing', async () => {
    delete process.env.RESEND_FROM_EMAIL;
    (pool.query as any).mockResolvedValue({ rows: [{ email: 'admin@wak.com' }] });

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send when no recipients found at all', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    // no MANAGER_EMAIL either

    await notifyManagerNewBooking(BASE_OPTS);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('continues to next recipient if one send throws', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [{ email: 'admin1@wak.com' }, { email: 'admin2@wak.com' }],
    });
    mockSend
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ data: { id: 'msg_ok' } });

    // Should not throw
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
