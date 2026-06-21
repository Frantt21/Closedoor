-- Migration 014: Trending words RPC (extrae palabras frecuentes de posts recientes)
-- Run this in your Supabase SQL Editor

-- Stop words list (inglés + español)
CREATE OR REPLACE FUNCTION get_trending_words(limit_count INT DEFAULT 8, hours_back INT DEFAULT 24)
RETURNS TABLE(word TEXT, frequency BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    LOWER(unnested)::TEXT AS word,
    COUNT(*)::BIGINT AS frequency
  FROM (
    SELECT regexp_split_to_table(
      -- Limpiar: remover URLs, @mentions, #hashtags, caracteres no alfanuméricos
      regexp_replace(
        regexp_replace(
          regexp_replace(
            LOWER(COALESCE(content, '')),
            'https?://\S+', '', 'g'
          ),
          '@[a-zA-Z0-9_]+', '', 'g'
        ),
        '#[a-zA-Z0-9_\u00C0-\u024F]+', '', 'g'
      ),
      '[^a-zA-Z0-9\u00C0-\u024F]+'
    ) AS unnested
    FROM posts
    JOIN profiles ON profiles.id = posts.user_id
    WHERE posts.created_at > NOW() - (hours_back || ' hours')::INTERVAL
      AND posts.content IS NOT NULL
      AND posts.content != ''
      AND (profiles.is_private IS NULL OR profiles.is_private = false)
  ) words
  WHERE 
    LENGTH(unnested) >= 4
    AND unnested !~ '^\d+$'
    AND unnested NOT IN (
      -- English stop words
      'this', 'that', 'with', 'from', 'have', 'been', 'they', 'them', 'their',
      'will', 'would', 'could', 'should', 'about', 'which', 'when', 'where',
      'what', 'there', 'your', 'more', 'some', 'than', 'then', 'also', 'just',
      'like', 'into', 'over', 'such', 'only', 'other', 'very', 'much', 'still',
      'well', 'even', 'back', 'here', 'down', 'after', 'before', 'between',
      'through', 'during', 'because', 'these', 'those', 'while', 'every',
      'another', 'first', 'last', 'great', 'good', 'really', 'think', 'know',
      'want', 'need', 'make', 'take', 'come', 'look', 'give', 'use', 'find',
      'tell', 'ask', 'seem', 'feel', 'work', 'call', 'try', 'leave', 'keep',
      'let', 'begin', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe',
      'happen', 'write', 'read', 'help', 'start', 'right', 'ever', 'never',
      'always', 'away', 'today', 'going', 'getting', 'looking', 'made', 'said',
      'does', 'done', 'having', 'thing', 'things', 'people', 'person', 'place',
      'time', 'way', 'day', 'year', 'week', 'month', 'part', 'world', 'life',
      'hand', 'eye', 'face', 'head', 'mind', 'heart', 'body', 'book', 'word',
      'name', 'house', 'friend', 'family', 'man', 'woman', 'men', 'women',
      'father', 'mother', 'brother', 'sister', 'water', 'food', 'money', 'air',
      'land', 'light', 'power', 'love', 'fear', 'hope', 'fun', 'god', 'child',
      'still', 'doesn', 'don', 'didn', 'wasn', 'aren', 'isn', 'weren', 'hasn',
      'hadn', 'won', 'wouldn', 'shouldn', 'couldn', 'can', 'may', 'might',
      'shall', 'needn', 'dare', 'ought',
      -- Spanish stop words
      'este', 'esta', 'esto', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos',
      'esas', 'aquel', 'aquella', 'aquellos', 'aquellas', 'todo', 'toda',
      'todos', 'todas', 'mismo', 'misma', 'mismos', 'mismas', 'otro', 'otra',
      'otros', 'otras', 'tanto', 'tanta', 'tantos', 'tantas', 'cada', 'cual',
      'cuales', 'quien', 'quienes', 'cuando', 'donde', 'como', 'cual', 'que',
      'quien', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'entre', 'durante', 'mediante',
      'excepto', 'salvo', 'incluso', 'mas', 'pero', 'sino', 'aunque', 'porque',
      'pues', 'puesto', 'ya', 'bien', 'sea', 'tanto', 'tan', 'cuanto', 'como',
      'mientras', 'apenas', 'ni', 'siquiera', 'aun', 'ademas', 'además', 'tambien',
      'también', 'entonces', 'luego', 'despues', 'después', 'antes', 'pronto',
      'temprano', 'tarde', 'ahora', 'ayer', 'hoy', 'manana', 'mañana', 'noche',
      'dia', 'día', 'semana', 'mes', 'ano', 'año', 'nunca', 'jamas', 'jamás',
      'siempre', 'aca', 'acá', 'alli', 'allí', 'alla', 'allá', 'aqui', 'aquí',
      'ahi', 'ahí', 'muy', 'mucho', 'poco', 'bastante', 'demasiado', 'asi',
      'así', 'casi', 'solo', 'sólo', 'solamente', 'incluso', 'ademas', 'además',
      'encima', 'debajo', 'dentro', 'fuera', 'cerca', 'lejos', 'arriba', 'abajo',
      'mayor', 'menor', 'mejor', 'peor', 'superior', 'inferior', 'primer',
      'primero', 'ultimo', 'último', 'siguiente', 'anterior', 'propio',
      'ajeno', 'comun', 'común', 'general', 'mismo', 'diferente', 'distinto',
      'semejante', 'parecido', 'cierto', 'falso', 'verdadero', 'bueno', 'malo',
      'simple', 'dificil', 'difícil', 'facil', 'fácil', 'posible', 'imposible',
      'necesario', 'importante', 'especial', 'principal', 'gran', 'grande',
      'pequeno', 'pequeño', 'largo', 'corto', 'alto', 'bajo', 'ancho', 'estrecho',
      'profundo', 'superficial', 'claro', 'oscuro', 'frio', 'frío', 'caliente',
      'dulce', 'amargo', 'salado', 'agrio', 'nuevo', 'viejo', 'joven', 'antiguo',
      'moderno', 'futuro', 'pasado', 'presente', 'saber', 'poder', 'deber',
      'querer', 'poner', 'decir', 'hacer', 'creer', 'pensar', 'encontrar',
      'entender', 'recordar', 'olvidar', 'perder', 'ganar', 'esperar', 'desear',
      'amar', 'odiar', 'preferir', 'elegir', 'decidir', 'aceptar', 'rechazar',
      'permitir', 'prohibir', 'lograr', 'conseguir', 'cambiar', 'mejorar',
      'empeorar', 'crear', 'destruir', 'construir', 'romper', 'abrir', 'cerrar',
      'subir', 'bajar', 'entrar', 'salir', 'llegar', 'partir', 'volver',
      'seguir', 'continuar', 'terminar', 'acabar', 'empezar', 'comenzar',
      'sonreir', 'sonreír', 'llorar', 'reir', 'reír', 'gritar', 'susurrar',
      'contar', 'explicar', 'responder', 'preguntar', 'hablar', 'conversar',
      'llamar', 'enviar', 'recibir', 'ofrecer', 'pedir', 'dar', 'tener',
      'comer', 'beber', 'dormir', 'despertar', 'vestir', 'cenar', 'comprar',
      'vender', 'pagar', 'costar', 'valer'
    )
    AND NOT EXISTS (
      SELECT 1 FROM hashtags h WHERE h.name = unnested
    )
  GROUP BY LOWER(unnested)
  HAVING COUNT(*) >= 2
  ORDER BY COUNT(*) DESC, LOWER(unnested) ASC
  LIMIT limit_count;
END;
$$;
