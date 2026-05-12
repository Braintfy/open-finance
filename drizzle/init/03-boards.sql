-- PURPOSE: Создание таблицы boards — персональные доски пользователя
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL DEFAULT 'Новая доска',
  icon VARCHAR(40),
  accent_color VARCHAR(40),
  sort_order INTEGER NOT NULL DEFAULT 0,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boards_tenant_user_idx ON boards(tenant_id, user_id);
