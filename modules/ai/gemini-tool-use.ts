import { GoogleGenAI, Type } from '@google/genai';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || '';

let aiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export async function chatWithBaubekAI(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
): Promise<string> {
  const ai = getClient();
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  return response.text || 'Извините, не удалось сгенерировать ответ.';
}

export const checkAvailabilityToolDeclaration = {
  name: 'checkAvailability',
  description:
    'Checks whether a library room is free for a given date and time range. Use this whenever the user asks about room availability ("is conference room free tomorrow at 3pm?", "can I book coworking on Friday?"). Always call this before answering availability questions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      room_type: {
        type: Type.STRING,
        description: 'Type of room',
        enum: ['reading_hall', 'conference', 'coworking'],
      },
      date: { type: Type.STRING, description: 'Date in YYYY-MM-DD format' },
      time_start: { type: Type.STRING, description: 'Start time HH:MM' },
      time_end: { type: Type.STRING, description: 'End time HH:MM' },
    },
    required: ['room_type', 'date', 'time_start', 'time_end'],
  },
};

export async function chatWithBaubekAIWithTools(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
) {
  const ai = getClient();
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 1024,
      tools: [{ functionDeclarations: [checkAvailabilityToolDeclaration] }],
    },
  });

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  for (const part of parts) {
    // Gemini 3 attaches a thoughtSignature on functionCall parts; we must
    // echo it back when responding with the tool result.
    const fc = (part as { functionCall?: { name?: string; args?: unknown }; thoughtSignature?: string }).functionCall;
    if (fc) {
      const thoughtSignature = (part as { thoughtSignature?: string }).thoughtSignature;
      return {
        type: 'function_call' as const,
        name: fc.name as string,
        args: fc.args as Record<string, string>,
        thoughtSignature,
      };
    }
  }

  return {
    type: 'text' as const,
    content: response.text || 'Извините, не удалось сгенерировать ответ.',
  };
}

export async function continueChatWithToolResult(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  toolCall: { name: string; args: Record<string, unknown>; thoughtSignature?: string },
  toolResult: Record<string, unknown>,
): Promise<string> {
  const ai = getClient();
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  // Echo the model's function call back (with its thoughtSignature), then provide
  // the tool result so the model can craft the final natural-language reply.
  const fcPart: Record<string, unknown> = {
    functionCall: { name: toolCall.name, args: toolCall.args },
  };
  if (toolCall.thoughtSignature) fcPart.thoughtSignature = toolCall.thoughtSignature;

  contents.push({
    role: 'model' as const,
    // @ts-expect-error — mixed parts shape accepted by SDK
    parts: [fcPart],
  });
  contents.push({
    role: 'user' as const,
    // @ts-expect-error — mixed parts shape accepted by SDK
    parts: [{ functionResponse: { name: toolCall.name, response: toolResult } }],
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 1024,
      tools: [{ functionDeclarations: [checkAvailabilityToolDeclaration] }],
    },
  });

  return response.text || 'Готово.';
}

export const bookingToolDeclaration = {
  name: 'bookRoom',
  description:
    'Books a room in the library. Extracts room type, date, time, applicant name, contact, and purpose from the conversation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      room_type: {
        type: Type.STRING,
        description: 'Type of room: reading_hall, conference, coworking',
        enum: ['reading_hall', 'conference', 'coworking'],
      },
      date: {
        type: Type.STRING,
        description: 'Date in YYYY-MM-DD format',
      },
      time_start: {
        type: Type.STRING,
        description: 'Start time in HH:MM format',
      },
      time_end: {
        type: Type.STRING,
        description: 'End time in HH:MM format',
      },
      applicant_name: {
        type: Type.STRING,
        description: 'Name of the person booking',
      },
      contact: {
        type: Type.STRING,
        description: 'Phone number or email of the applicant',
      },
      purpose: {
        type: Type.STRING,
        description: 'Purpose of the booking',
      },
    },
    required: ['room_type', 'date', 'time_start', 'time_end', 'applicant_name', 'contact'],
  },
};

export async function chatWithBookingAI(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
) {
  const ai = getClient();
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.3,
      maxOutputTokens: 1024,
      tools: [{ functionDeclarations: [bookingToolDeclaration] }],
    },
  });

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  for (const part of parts) {
    if (part.functionCall) {
      return {
        type: 'function_call' as const,
        name: part.functionCall.name,
        args: part.functionCall.args as Record<string, string>,
      };
    }
  }

  return {
    type: 'text' as const,
    content: response.text || 'Не удалось обработать запрос.',
  };
}

export async function generateStory(
  childName: string,
  theme: string,
  language: 'ru' | 'kk'
): Promise<string> {
  const ai = getClient();
  const langName = language === 'kk' ? 'казахском' : 'русском';
  const prompt = `Напиши добрую детскую сказку на ${langName} языке для ребёнка по имени ${childName}.
Тема: ${theme}.
Требования:
- Длина: 100-150 слов
- Включи мораль/урок
- Используй простой язык, понятный детям 5-10 лет
- Сделай историю увлекательной и поучительной
- Обращайся к ребёнку по имени`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.9, maxOutputTokens: 512 },
  });

  return response.text || 'Не удалось создать сказку.';
}

export async function generateSocialPost(
  eventName: string,
  platform: 'instagram' | 'telegram'
): Promise<{ text: string; posterPrompt: string }> {
  const ai = getClient();
  const prompt = `Ты SMM-менеджер библиотеки в Сатпаеве (Казахстан).
Сгенерируй пост для ${platform === 'instagram' ? 'Instagram' : 'Telegram'} о мероприятии: "${eventName}".

Ответь строго в формате JSON:
{
  "text": "текст поста с эмодзи и хештегами",
  "posterPrompt": "промпт для генерации постера в Nano Banana (на английском, описание визуала)"
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.8, maxOutputTokens: 1024 },
  });

  try {
    const text = response.text || '{}';
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      text: `Приглашаем на ${eventName}! #библиотека #сатпаев`,
      posterPrompt: `Library event poster for "${eventName}", modern minimalist design, warm colors`,
    };
  }
}
