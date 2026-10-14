import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  UPLOADS_DIR,
  UPLOAD_REL_RE,
  TENANT_DIR_RE,
  tenantDirOf,
  tenantRelPath,
  resolveUploadPath,
} from '../../src/utils/uploadPaths';

const FILE = '123e4567-e89b-12d3-a456-426614174000.png';

describe('UPLOAD_REL_RE', () => {
  it('accepts flat and tenant-scoped file paths', () => {
    expect(UPLOAD_REL_RE.test(FILE)).toBe(true);
    expect(UPLOAD_REL_RE.test(`tenant-3/${FILE}`)).toBe(true);
    expect(UPLOAD_REL_RE.test(`tenant-123/${FILE}`)).toBe(true);
  });

  it('rejects traversal and unexpected shapes', () => {
    expect(UPLOAD_REL_RE.test('../etc/passwd')).toBe(false);
    expect(UPLOAD_REL_RE.test('tenant-3/../../etc/passwd')).toBe(false);
    expect(UPLOAD_REL_RE.test('/tenant-3/' + FILE)).toBe(false);
    expect(UPLOAD_REL_RE.test('other-3/' + FILE)).toBe(false);
    expect(UPLOAD_REL_RE.test('tenant-x/' + FILE)).toBe(false);
    expect(UPLOAD_REL_RE.test('tenant-3/sub/' + FILE)).toBe(false);
    expect(UPLOAD_REL_RE.test('not-a-uuid.png')).toBe(false);
  });
});

describe('tenantDirOf', () => {
  it('extracts the tenant id from a nested path', () => {
    expect(tenantDirOf(`tenant-7/${FILE}`)).toBe(7);
    expect(tenantDirOf(FILE)).toBeNull();
    expect(tenantDirOf('tenant-x/' + FILE)).toBeNull();
  });
});

describe('tenantRelPath', () => {
  it('builds the tenant-scoped relative path', () => {
    expect(tenantRelPath(5, FILE)).toBe(`tenant-5/${FILE}`);
  });
});

describe('resolveUploadPath', () => {
  it('resolves valid paths inside the uploads dir', () => {
    const flat = resolveUploadPath(FILE);
    expect(flat).toBe(path.join(UPLOADS_DIR, FILE));
    const nested = resolveUploadPath(`tenant-9/${FILE}`);
    expect(nested).toBe(path.join(UPLOADS_DIR, `tenant-9/${FILE}`));
  });

  it('strips a leading slash and ignores the query string', () => {
    expect(resolveUploadPath(`/${FILE}`)).toBe(path.join(UPLOADS_DIR, FILE));
    expect(resolveUploadPath(`${FILE}?t=123.abc`)).toBe(path.join(UPLOADS_DIR, FILE));
  });

  it('returns null for anything that is not a plain upload path', () => {
    expect(resolveUploadPath('../etc/passwd')).toBeNull();
    expect(resolveUploadPath(`tenant-1/../../../etc/passwd`)).toBeNull();
    expect(resolveUploadPath('other-1/' + FILE)).toBeNull();
    expect(resolveUploadPath('')).toBeNull();
  });
});

describe('TENANT_DIR_RE', () => {
  it('matches only tenant-<digits>', () => {
    expect(TENANT_DIR_RE.test('tenant-1')).toBe(true);
    expect(TENANT_DIR_RE.test('tenant1')).toBe(false);
    expect(TENANT_DIR_RE.test('tenant-')).toBe(false);
  });
});
