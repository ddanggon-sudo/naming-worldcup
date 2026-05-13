/**
 * deokdam.js — LLM으로 8대 덕담 생성
 *
 * export generateDeokdam({ name, hanja, saju, gender, isPremium })
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * 이름·사주에 어울리는 8대 덕담 생성
 * @returns {Promise<Array<{hanja: string, ko: string}>>}
 */
export async function generateDeokdam({ name, hanja, saju, gender, isPremium = true }) {
  const model = isPremium ? 'openai/gpt-4o' : 'openai/gpt-4o-mini';

  const prompt = `당신은 한국 전통 작명소의 작명가입니다.
이 아이에게 어울리는 4글자 한자 덕담 8개를 만들어주세요.

[정보]
이름: ${hanja} (${name})
성별: ${gender}
사주: ${JSON.stringify(saju)}

[규칙]
- 각 덕담은 4글자 한자 + 한글 음
- 전통 작명서 양식 (예: 父祖有德/부조유덕, 明哲人物/명철인물, 博士得名/박사득명)
- 8개를 다음 영역에서 고르게: 학업·인격·재물·건강·인연·가문·재능·장수

JSON으로 반환:
{"items":[{"hanja":"父祖有德","ko":"부조유덕"}, ...총 8개]}`;

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 1500,
  });

  return JSON.parse(res.choices[0].message.content).items;
}
