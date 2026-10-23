CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

CREATE TABLE requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  documents TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('Alta', 'Media', 'Baja')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE profile_requirements (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, requirement_id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'admin')),
  profile_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  CONSTRAINT users_code_key UNIQUE (code),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE UNIQUE INDEX users_code_upper ON users (upper(code));
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE user_requirement_states (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Pendiente', 'En proceso', 'Completado')),
  PRIMARY KEY (user_id, requirement_id)
);

CREATE TABLE history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail TEXT NOT NULL
);
