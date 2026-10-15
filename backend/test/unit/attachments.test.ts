import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  classifyAttachment,
  IMAGE_EXT,
  VIDEO_EXT,
  DOC_EXT,
} from '../../src/utils/attachments';

describe('classifyAttachment', () => {
  it('recognises images', () => {
    expect(classifyAttachment('photo.PNG')).toBe('image');
    expect(classifyAttachment('скан.jpeg')).toBe('image');
    expect(classifyAttachment('a.b.webp')).toBe('image');
  });

  it('recognises video', () => {
    expect(classifyAttachment('clip.mp4')).toBe('video');
    expect(classifyAttachment('screen.MOV')).toBe('video');
    expect(classifyAttachment('record.webm')).toBe('video');
  });

  it('treats other allowed documents as files', () => {
    expect(classifyAttachment('price.xlsx')).toBe('file');
    expect(classifyAttachment('basket.zip')).toBe('file');
    expect(classifyAttachment('notes.txt')).toBe('file');
  });

  it('rejects unsupported or executable extensions', () => {
    expect(classifyAttachment('page.html')).toBeNull();
    expect(classifyAttachment('logo.svg')).toBeNull();
    expect(classifyAttachment('script.js')).toBeNull();
    expect(classifyAttachment('binary.exe')).toBeNull();
    expect(classifyAttachment('noextension')).toBeNull();
  });

  it('keeps the 20 MB limit (Telegram Bot API bound)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });

  it('never lists the same extension twice', () => {
    const all = [...IMAGE_EXT, ...VIDEO_EXT, ...DOC_EXT];
    expect(new Set(all).size).toBe(all.length);
  });
});
