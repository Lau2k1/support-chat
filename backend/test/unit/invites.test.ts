import { describe, it, expect } from 'vitest';
import { trimPendingInvites } from '../../src/services/billing';

interface Call {
  sql: string;
  params?: unknown[];
}

/**
 * Мини-заглушка pg-клиента: helper делает ровно два вида запросов — подсчёт
 * занятых мест и DELETE лишних кодов, поэтому фейка достаточно.
 */
function fakeClient(operators: number, pending: number) {
  const calls: Call[] = [];
  return {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('AS operators')) return { rows: [{ operators, pending }], rowCount: 1 };
      return { rows: [], rowCount: params?.[1] as number };
    },
    get deletes() {
      return calls.filter((c) => c.sql.includes('DELETE FROM invite_codes'));
    },
  };
}

describe('trimPendingInvites', () => {
  it('снимает самые новые коды, когда лимит тарифа ниже выданного', async () => {
    // Тариф «Старт» (3 места), операторов нет, выдано 5 кодов → лишних 2.
    const client = fakeClient(0, 5);
    const dropped = await trimPendingInvites(client, 7, 3);

    expect(dropped).toBe(2);
    expect(client.deletes).toHaveLength(1);
    expect(client.deletes[0].params).toEqual([7, 2]);
    expect(client.deletes[0].sql).toContain('ORDER BY created_at DESC');
  });

  it('ничего не трогает, когда коды укладываются в лимит', async () => {
    const client = fakeClient(0, 3);
    expect(await trimPendingInvites(client, 7, 3)).toBe(0);
    expect(client.deletes).toHaveLength(0);
  });

  it('учитывает занятые операторами места', async () => {
    // 1 оператор + 5 кодов на лимит 3 → остаётся 2 кода, снимаем 3.
    const client = fakeClient(1, 5);
    expect(await trimPendingInvites(client, 7, 3)).toBe(3);
    expect(client.deletes[0].params).toEqual([7, 3]);
  });

  it('снимает все коды, если операторов больше нового лимита', async () => {
    const client = fakeClient(5, 2);
    expect(await trimPendingInvites(client, 7, 3)).toBe(2);
    expect(client.deletes[0].params).toEqual([7, 2]);
  });

  it('и в подсчёте мест, и в удалении учитывает только живые коды', async () => {
    const client = fakeClient(0, 4);
    await trimPendingInvites(client, 7, 4);
    const seats = client.calls[0];
    expect(seats.sql).toContain('used_by IS NULL');
    expect(seats.sql).toMatch(/\(ic\.expires_at IS NULL OR ic\.expires_at > now\(\)\)/);
  });
});
