/**
 * Document text extraction.
 *
 * Supported: .pdf (poppler `pdftotext`), .docx (mammoth), .txt/.md/.csv/.json/
 * .html (direct), .pptx (unzip + XML strip when `unzip` is available).
 * Unsupported types fail loudly — the caller surfaces the error and offers a
 * retry or the paste-text path rather than pretending the file was processed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError } from './util.js';

const execFileAsync = promisify(execFile);

export const MAX_UPLOAD_BYTES = Number(process.env.RECALL_MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
export const MAX_TEXT_CHARS = Number(process.env.RECALL_MAX_TEXT_CHARS || 200000);

export const ACCEPTED_EXTENSIONS = ['pdf', 'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'docx', 'pptx'];
export const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export function extOf(filename = '') {
  const m = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function assertAcceptable(filename, mime, size) {
  const ext = extOf(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new HttpError(415,
      `Unsupported file type ".${ext || 'unknown'}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}. You can also paste your notes directly.`,
      'unsupported_type');
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`, 'file_too_large');
  }
  if (!size) throw new HttpError(400, 'The file is empty.', 'empty_file');
  return ext;
}

export async function extractText({ buffer, filename, mime }) {
  const ext = extOf(filename);
  let text = '';
  let method = ext;

  if (['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm'].includes(ext)) {
    text = buffer.toString('utf8');
    if (ext === 'html' || ext === 'htm') text = stripHtml(text);
  } else if (ext === 'pdf') {
    text = await extractPdf(buffer);
    method = 'pdftotext';
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || '';
    method = 'mammoth';
  } else if (ext === 'pptx') {
    text = await extractPptx(buffer);
    method = 'pptx-xml';
  } else {
    throw new HttpError(415, `Cannot extract text from ".${ext}" files.`, 'unsupported_type');
  }

  text = normalizeWhitespace(text);
  if (!text) {
    throw new HttpError(422,
      'No readable text was found. If this is a scanned PDF, it needs OCR before upload — try pasting the text instead.',
      'no_text');
  }
  return { text: text.slice(0, MAX_TEXT_CHARS), method, truncated: text.length > MAX_TEXT_CHARS, charCount: Math.min(text.length, MAX_TEXT_CHARS) };
}

async function extractPdf(buffer) {
  const tmp = path.join(os.tmpdir(), `recall-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.promises.writeFile(tmp, buffer);
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HttpError(503,
        'PDF extraction is unavailable: the `pdftotext` (poppler-utils) binary is not installed on the server. Install poppler-utils, or paste the text instead.',
        'pdf_tool_missing');
    }
    throw new HttpError(422, `Could not read the PDF: ${err.message}`, 'pdf_failed');
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

async function extractPptx(buffer) {
  const tmp = path.join(os.tmpdir(), `recall-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`);
  await fs.promises.writeFile(tmp, buffer);
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', tmp, 'ppt/slides/*.xml'], { maxBuffer: 64 * 1024 * 1024 });
    return stripXml(stdout);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HttpError(503, 'PPTX extraction needs the `unzip` binary, which is not installed. Paste the text instead.', 'pptx_tool_missing');
    }
    throw new HttpError(422, `Could not read the presentation: ${err.message}`, 'pptx_failed');
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function stripXml(xml) {
  return String(xml)
    .replace(/<a:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}
