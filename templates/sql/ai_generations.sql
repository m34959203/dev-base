-- 011: ai_generations — журнал AI-вызовов для квотного гарда и расчёта расхода.
-- Каждая Gemini-операция (chat/vision/tts/exercises) пишет сюда строку. На входе
-- assertQuota() читает агрегаты за 60с и 24ч и блокирует на 90% free-tier лимита,
-- чтобы проект НИКОГДА не вышел в платный тариф.

CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(32) NOT NULL,                 -- 'gemini' | 'openrouter' | 'claude'
  model VARCHAR(128) NOT NULL,                   -- 'gemini-2.5-flash', 'gemini-3.1-flash-tts-preview', ...
  purpose VARCHAR(64) NOT NULL,                  -- 'chat' | 'vision' | 'tts' | 'exercises' | 'writing-check' | 'analyze-content' | 'live-token' | 'pronunciation'
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_created ON ai_generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_model_created ON ai_generations(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_provider_created ON ai_generations(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user ON ai_generations(user_id, created_at DESC);
