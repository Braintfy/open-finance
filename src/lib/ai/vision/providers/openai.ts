// PURPOSE: OpenAI Vision provider — использует Chat Completions с image_url
// content. Требует OPENAI_API_KEY. Модель по умолчанию gpt-4o-mini.

import type {
  VisionProvider,
  VisionInput,
  VisionHint,
  VisionContext,
  ExtractedData,
} from '../types';
import { buildExtractionPrompt, parseExtractedJson } from '../types';

const DEFAULT_MODEL = 'gpt-4o-mini';

async function inputToImageUrl(input: VisionInput): Promise<string> {
  if (input.kind === 'url') return input.url;
  return `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
}

export const openaiVisionProvider: VisionProvider = {
  id: 'openai',
  label: 'OpenAI GPT-4o',
  supports: (mt) => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mt),
  async recognize(
    input: VisionInput,
    hint: VisionHint,
    _ctx: VisionContext,
  ): Promise<ExtractedData> {
    void _ctx;
    const start = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY не задан');

    const imageUrl = await inputToImageUrl(input);
    const prompt = buildExtractionPrompt(hint);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
    });
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
