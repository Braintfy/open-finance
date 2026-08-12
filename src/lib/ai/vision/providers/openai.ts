// PURPOSE: OpenAI Vision provider — использует Chat Completions с image_url
// content. Требует OPENAI_API_KEY. Модель по умолчанию gpt-4o-mini.
// requiresVpn: api.openai.com из РФ недоступен → запрос идёт через ctx.proxy
// (tenant aiProxy / локальный Xray), если он включён.

import type {
  VisionProvider,
  VisionInput,
  VisionHint,
  VisionContext,
  ExtractedData,
} from '../types';
import { buildExtractionPrompt, parseExtractedJson } from '../types';
import { fetchViaProxy, getVisionDispatcher } from '../proxy-fetch';

const DEFAULT_MODEL = 'gpt-4o-mini';

async function inputToImageUrl(input: VisionInput): Promise<string> {
  if (input.kind === 'url') return input.url;
  return `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
}

export const openaiVisionProvider: VisionProvider = {
  id: 'openai',
  label: 'OpenAI GPT-4o',
  requiresVpn: true,
  supports: (mt) => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mt),
  async recognize(
    input: VisionInput,
    hint: VisionHint,
    ctx: VisionContext,
  ): Promise<ExtractedData> {
    const start = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY не задан');

    const imageUrl = await inputToImageUrl(input);
    const prompt = buildExtractionPrompt(hint);
    const dispatcher = await getVisionDispatcher(ctx, 'openai');

    const resp = await fetchViaProxy(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_MODEL,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
      },
      dispatcher,
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    const parsed = parseExtractedJson(text);
    return {
      ...parsed,
      provider: 'openai',
      durationMs: Date.now() - start,
      rawText: parsed.rawText ?? text,
      rawResponse: data,
    };
  },
};
