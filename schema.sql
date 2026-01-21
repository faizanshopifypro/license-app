CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  issued_to_email TEXT,
  shop_domain TEXT,
  status TEXT DEFAULT 'active', -- active|revoked|expired
  issued_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP NULL,
  activation_limit INT DEFAULT 1
);

CREATE TABLE activations (
  id SERIAL PRIMARY KEY,
  license_id INT REFERENCES licenses(id) ON DELETE CASCADE,
  shop_domain TEXT,
  ip TEXT,
  user_agent TEXT,
  activated_at TIMESTAMP DEFAULT now()
);
