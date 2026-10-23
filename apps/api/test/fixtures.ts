import type { DocNode, PageDto } from '@wiki/shared';
import type { Client } from './helpers';

export const doc = (text: string): DocNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

export async function createSpace(client: Client, key = 'IT', name = 'IT-Team', extra: { open?: boolean } = {}) {
  const res = await client.post('/spaces', { key, name, description: 'Wissen der IT', ...extra });
  if (res.status !== 201) throw new Error(`Space anlegen: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; key: string; homePageId: string };
}

export async function createPage(client: Client, spaceKey: string, title: string, parentId?: string, text = `Inhalt von ${title}`): Promise<PageDto> {
  const res = await client.post('/pages', { spaceKey, title, parentId, content: doc(text) });
  if (res.status !== 201) throw new Error(`Seite anlegen: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Kleinstes gültiges PNG (1×1 Pixel) */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
