import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), on: vi.fn() },
  db: {},
}));

import { pool } from '../server/db';
import { resolveCompanyFromSecret } from '../server/helpers/resolveCompanyFromSecret';

describe('resolveCompanyFromSecret', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns company when secret matches an active row', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [{ id: 2, name: 'Dynamic AI' }],
    });
    const result = await resolveCompanyFromSecret('good-secret');
    expect(result).toEqual({ id: 2, name: 'Dynamic AI' });
  });

  it('returns null for unknown secret', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const result = await resolveCompanyFromSecret('bogus-secret');
    expect(result).toBeNull();
  });

  it('returns null for empty string without querying the DB', async () => {
    const result = await resolveCompanyFromSecret('');
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns null for undefined without querying the DB', async () => {
    const result = await resolveCompanyFromSecret(undefined);
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns null for inactive company (filtered by is_active = true in SQL)', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const result = await resolveCompanyFromSecret('inactive-co-secret');
    expect(result).toBeNull();
  });

  it('returns null when the DB query throws', async () => {
    (pool.query as any).mockRejectedValue(new Error('connection lost'));
    const result = await resolveCompanyFromSecret('anything');
    expect(result).toBeNull();
  });
});
