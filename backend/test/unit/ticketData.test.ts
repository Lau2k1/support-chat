import { describe, it, expect } from 'vitest';
import { validateTicketData } from '../../src/services/tickets';
import type { TicketTemplateSchema } from '../../src/services/ticketTemplates';

const schema: TicketTemplateSchema = {
  fields: [
    { id: 'f1', type: 'text', label: 'Тема', required: true },
    { id: 'f2', type: 'file', label: 'Файл', required: false },
    { id: 'f3', type: 'file', label: 'Чек', required: true },
  ],
};

describe('validateTicketData: поле «Файл»', () => {
  it('accepts the uploader object { url, name }', () => {
    const { data, error } = validateTicketData(schema, {
      f1: 'Возврат',
      f3: { url: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf', name: 'чек.pdf' },
    });
    expect(error).toBeNull();
    expect(data.f3).toEqual({
      url: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf',
      name: 'чек.pdf',
    });
  });

  it('keeps an object without a name as { url }', () => {
    const { data, error } = validateTicketData(schema, {
      f1: 'Возврат',
      f3: { url: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf' },
    });
    expect(error).toBeNull();
    expect(data.f3).toEqual({ url: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf' });
  });

  it('accepts a legacy string link (own uploads path or http)', () => {
    const own = validateTicketData(schema, {
      f1: 'Возврат',
      f3: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf',
    });
    expect(own.error).toBeNull();
    expect(own.data.f3).toBe('/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf');

    const external = validateTicketData(schema, { f1: 'Возврат', f3: 'https://example.com/act.pdf' });
    expect(external.error).toBeNull();
    expect(external.data.f3).toBe('https://example.com/act.pdf');
  });

  it('rejects unsafe or unknown URL schemes', () => {
    const js = validateTicketData(schema, { f1: 'Возврат', f3: 'javascript:alert(1)' });
    expect(js.error).toContain('неверная ссылка на файл');

    const traversal = validateTicketData(schema, { f1: 'Возврат', f3: '/uploads/../../etc/passwd' });
    expect(traversal.error).toContain('неверная ссылка на файл');

    const wrongType = validateTicketData(schema, { f1: 'Возврат', f3: 42 });
    expect(wrongType.error).toContain('ожидается файл');
  });

  it('requires the file when the field is required', () => {
    const { error } = validateTicketData(schema, { f1: 'Возврат' });
    expect(error).toContain('«Чек»');
    expect(error).toContain('обязательное поле');
  });

  it('rejects an object with a non-string url', () => {
    const { error } = validateTicketData(schema, { f1: 'Возврат', f3: { url: 123 } });
    expect(error).toContain('неверная ссылка на файл');
  });
});

describe('validateTicketData: прочие поля не сломались', () => {
  it('trims text and skips empty optional fields', () => {
    const { data, error } = validateTicketData(schema, {
      f1: '  Возврат  ',
      f3: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf',
    });
    expect(error).toBeNull();
    expect(data).toEqual({
      f1: 'Возврат',
      f3: '/uploads/tenant-1/2f6a5f0e-1111-2222-3333-444455556666.pdf',
    });
  });
});
