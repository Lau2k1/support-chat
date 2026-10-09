CREATE TABLE IF NOT EXISTS operators (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'online',
    role VARCHAR(20) DEFAULT 'operator',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE operators ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'operator';
ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    rating SMALLINT,
    assigned_operator_id INTEGER REFERENCES operators(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_name VARCHAR(255);
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_device VARCHAR(255);
ALTER TABLE chats ADD COLUMN IF NOT EXISTS client_region VARCHAR(255);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    sender_id INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    file_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

CREATE TABLE IF NOT EXISTS canned_responses (
    id SERIAL PRIMARY KEY,
    operator_id INTEGER REFERENCES operators(id) ON DELETE CASCADE,
    shortcut VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_operator ON canned_responses(operator_id);

CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    created_by INTEGER REFERENCES operators(id),
    used_by INTEGER REFERENCES operators(id),
    used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_tags (
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, tag_id)
);
