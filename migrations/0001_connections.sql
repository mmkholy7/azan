CREATE TABLE connections (
  subject TEXT PRIMARY KEY,
  settings TEXT,
  manage_hash TEXT UNIQUE,
  pair_hash TEXT UNIQUE,
  pair_expires INTEGER
);
