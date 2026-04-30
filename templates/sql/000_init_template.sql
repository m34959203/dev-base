-- 000_init_template.sql — каркас первой миграции для нового проекта.
-- Скопировать в `sql/001_init.sql` и адаптировать.
--
-- Стиль миграций (см. playbooks/sql-migrations-style.md):
--   - Файлы нумеруются: NNN_description.sql (001, 002, ..., 099 для seeds).
--   - Все CREATE — IF NOT EXISTS для идемпотентности.
--   - PK всегда UUID v4 через uuid-ossp.
--   - Двуязычные поля с суффиксом _kk / _ru (например title_kk, title_ru).
--   - Все timestamps — TIMESTAMP WITH TIME ZONE DEFAULT NOW().
--   - FK с явным ON DELETE policy (CASCADE / SET NULL — никогда RESTRICT по умолчанию).
--   - Индексы — отдельной строкой ниже CREATE TABLE, имена `idx_<table>_<columns>`.
--   - В шапке файла — комментарий: что добавляет миграция и зачем.

-- ─────────────────────────────────────────────────────────────────────────────
-- Расширения
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'editor', 'moderator')),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- site_settings — key/value для CMS-управляемых настроек
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- news — пример двуязычного контента (kk + ru)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(200) UNIQUE NOT NULL,
  title_kk VARCHAR(500) NOT NULL,
  title_ru VARCHAR(500) NOT NULL,
  excerpt_kk TEXT,
  excerpt_ru TEXT,
  content_kk TEXT NOT NULL,
  content_ru TEXT NOT NULL,
  cover_image VARCHAR(500),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  scheduled_at TIMESTAMP WITH TIME ZONE,
  published_at TIMESTAMP WITH TIME ZONE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_status_published ON news(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug);
CREATE INDEX IF NOT EXISTS idx_news_scheduled ON news(scheduled_at) WHERE status = 'scheduled';

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log — простой immutable журнал админ-действий
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(64),
  entity_id VARCHAR(100),
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_action ON audit_log(user_id, action, created_at DESC);
