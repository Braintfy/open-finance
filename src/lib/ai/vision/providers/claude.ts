// PURPOSE: Claude Vision provider — использует Anthropic Messages API с
// image content blocks. Требует ANTHROPIC_API_KEY (или tenant.aiKeys.anthropic).
// requiresVpn: api.anthropic.com из РФ недоступен → запрос идёт через
// ctx.proxy (tenant aiProxy / локальный Xray), если он включён.

import type {
  VisionProvider,
  VisionInput,
  VisionHint,
  VisionContext,
  ExtractedData,
} from '../types';
import { buildExtractionPrompt, parseExtractedJson } from '../types';
import { fetchViaProxy, getVisionDispatcher } from '../proxy-fetch';

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

async function fetchImageBase64(input: VisionInput): Promise<{ base64: string; mediaType: string }> {
  if (input.kind === 'buffer') {
    return { base64: input.buffer.toString('base64'), mediaType: input.mimeType };
  }
  const resp = await fetch(input.url);
  if (!resp.ok) throw new Error(`Не удалось скачать ${input.url}: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const mt = input.mimeType ?? resp.headers.get('content-type') ?? 'image/jpeg';
  return { base64: buf.toString('base64'), mediaType: mt };
}

export const claudeVisionProvider: VisionProvider = {
  id: 'claude',
  label: 'Claude 3.5 Sonnet (Anthropic)',
  requiresVpn: true,
  supports: (mt) => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mt),
  async recognize(
    input: VisionInput,
    hint: VisionHint,
    ctx: VisionContext,
  ): Promise<ExtractedData> {
    const start = Date.now();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY не задан');

    // Скачивание вложения — напрямую (внутренний трафик), API Anthropic — через прокси.
    const { base64, mediaType } = await fetchImageBase64(input);
    const prompt = buildExtractionPrompt(hint);
    const dispatcher = await getVisionDispatcher(ctx, 'claude');

    const resp = await fetchViaProxy(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_VISION_MODEL ?? DEFAULT_MODEL,
          max_tokens: 1500,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64 },
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
      },
      dispatcher,
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const parsed = parseExtractedJson(text);
    return {
      ...parsed,
      provider: 'claude',
      durationMs: Date.now() - start,
      rawText: parsed.rawText ?? text,
      rawResponse: data,
    };
  },
};
