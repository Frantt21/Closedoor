# Consultas SQL para Supabase

Copia y ejecuta estas consultas en el **SQL Editor** de Supabase.

## 1. Crear tabla de perfiles

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL UNIQUE,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(LOWER(email));
```

## 2. Habilitar Row Level Security (RLS)

```sql
-- Habilitar RLS en la tabla
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver su propio perfil
CREATE POLICY "Users can view their own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Política: Los usuarios pueden actualizar su propio perfil
CREATE POLICY "Users can update their own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Política: Permitir creación de perfiles por usuarios autenticados
CREATE POLICY "Users can insert their own profile"
  ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Política: Permitir lectura pública de perfiles (sin datos sensibles)
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles
  FOR SELECT
  USING (true);
```

## 3. Crear función para actualizar updated_at

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

## 4. Verificar que la tabla se creó correctamente

```sql
-- Selecciona la estructura de la tabla
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;
```

## Consultas útiles para testing

```sql
-- Ver todos los perfiles
SELECT * FROM profiles;

-- Buscar un perfil por username
SELECT * FROM profiles WHERE LOWER(username) = 'testuser';

-- Buscar un perfil por email
SELECT * FROM profiles WHERE LOWER(email) = 'test@example.com';

-- Contar total de usuarios
SELECT COUNT(*) FROM profiles;

-- Eliminar un perfil (solo para testing)
DELETE FROM profiles WHERE id = 'user_id_here';
```

## Variables de entorno requeridas

Asegúrate de que `.env.local` tiene:

```
VITE_SUPABASE_URL=tu_url_aqui
# o si solo tienes la URL del Data API:
# VITE_SUPABASE_DATA_API_URL=tu_url_data_api_aqui
VITE_SUPABASE_ANON_KEY=tu_clave_aqui
```

## Pasos en Supabase

1. Ve a tu proyecto en https://app.supabase.com
2. Click en **SQL Editor** en la sidebar izquierda
3. Click en **New Query**
4. Copia y pega cada bloque de SQL
5. Ejecuta cada query (⌘+Enter o Ctrl+Enter)
6. Verifica que no haya errores

## Troubleshooting

Si la tabla ya existe y quieres borrarla:
```sql
DROP TABLE IF EXISTS profiles CASCADE;
```

Si quieres resetear la tabla (CUIDADO: borra todos los datos):
```sql
TRUNCATE TABLE profiles CASCADE;
```
