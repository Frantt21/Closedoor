/**
 * Interest Dictionary — maps general categories to specific sub-interests
 * and provides a flattened lookup for hierarchical matching.
 *
 * Structure:
 *   Each key is a general interest (e.g. "música").
 *   Each value is an array of specific sub-interests that fall under it.
 *
 * When matching, if user A has "música" and user B has "reggaeton",
 * they should match because "reggaeton" belongs to the "música" category.
 */

const INTEREST_CATEGORIES = {
  // ── Música ──
  música: [
    'music', 'reggaeton', 'pop', 'rock', 'hip hop', 'rap', 'trap', 'r&b', 'soul',
    'jazz', 'blues', 'clásica', 'electrónica', 'techno', 'house', 'dubstep',
    'reggae', 'ska', 'punk', 'metal', 'heavy metal', 'hard rock', 'indie',
    'alternativa', 'folk', 'country', 'latina', 'bachata', 'salsa', 'merengue',
    'cumbia', 'vallenato', 'norteña', 'banda', 'mariachi', 'flamenco',
    'samba', 'bossa nova', 'tango', 'k-pop', 'j-pop', 'anime', 'phonk',
    'lo-fi', 'ambient', 'drill', 'grime', 'afrobeat', 'dembow', 'moombahton',
  ],

  // ── Videojuegos ──
  videojuegos: [
    'juegos', 'videogames', 'gaming', 'games', 'gamer',
    'minecraft', 'fortnite', 'valorant', 'league of legends', 'lol', 'dota',
    'counter strike', 'csgo', 'overwatch', 'apex legends', 'call of duty',
    'battlefield', 'halo', 'destiny', 'rainbow six', 'siege',
    'grand theft auto', 'gta', 'red dead redemption', 'rdr',
    'the witcher', 'skyrim', 'fallout', 'elden ring', 'dark souls',
    'bloodborne', 'sekiro', 'zelda', 'mario bros', 'super mario',
    'pokémon', 'pokemon', 'animal crossing', 'splatoon',
    'final fantasy', 'kingdom hearts', 'persona', 'nier',
    'resident evil', 'silent hill', 'metal gear', 'death stranding',
    'god of war', 'spider-man', 'horizon', 'uncharted', 'last of us',
    'stardew valley', 'terraria', 'sims', 'minecraft',
    'roblox', 'among us', 'fall guys', 'rocket league',
    'fifa', 'pes', 'nba 2k', 'madden', 'forza', 'gran turismo',
    'need for speed', 'nfs', 'assetto corsa', 'iracing',
    'street fighter', 'mortal kombat', 'tekken', 'smash bros',
    'world of warcraft', 'wow', 'final fantasy xiv', 'ffxiv',
    'genshin impact', 'honkai', 'star rail', 'zenless zone',
    'cyberpunk 2077', 'doom', 'wolfenstein', 'quake',
    'hollow knight', 'celeste', 'undertale', 'cuphead',
    'portal', 'half-life', 'bioShock', 'mass effect', 'dragon age',
    'assassin\'s creed', 'far cry', 'watch dogs', 'ghost of tsushima',
    'monster hunter', 'dark souls',
  ],

  // ── Deportes ──
  deportes: [
    'sports', 'fitness', 'ejercicio', 'workout', 'gym', 'running',
    'fútbol', 'soccer', 'baloncesto', 'basketball', 'básquet', 'nba',
    'tenis', 'pádel', 'béisbol', 'baseball', 'mlb',
    'fórmula 1', 'f1', 'motogp', 'automovilismo', 'rally',
    'natación', 'swimming', 'atletismo', 'ciclismo', 'boxeo',
    'artes marciales', 'mma', 'ufc', 'karate', 'judo', 'taekwondo',
    'escalada', 'climbing', 'senderismo', 'hiking', 'camping',
    'surf', 'skate', 'snowboard', 'ski', 'esquí',
    'yoga', 'pilates', 'crossfit', 'calistenia',
    'voleibol', 'volleyball', 'handball', 'rugby',
    'golf', 'cricket', 'hockey',
  ],

  // ── Cine y TV ──
  'cine y tv': [
    'movies', 'series', 'películas', 'netflix', 'disney+', 'hbo', 'max',
    'marvel', 'dc', 'star wars', 'star trek', 'harry potter',
    'señor de los anillos', 'lotr', 'game of thrones', 'got',
    'stranger things', 'breaking bad', 'better call saul',
    'the office', 'friends', 'how i met your mother', 'himym',
    'rick and morty', 'south park', 'simpsons', 'family guy',
    'anime', 'attack on titan', 'shingeki', 'one piece',
    'naruto', 'demon slayer', 'kimetsu', 'jujutsu kaisen',
    'death note', 'fullmetal alchemist', 'fma',
    'spirited away', 'ghibli', 'studio ghibli',
    'dragon ball', 'dbz', 'pokémon', 'pokemon',
    'terror', 'horror', 'suspense', 'thriller', 'comedia',
    'drama', 'acción', 'ciencia ficción', 'sci-fi', 'fantasía',
  ],

  // ── Lectura ──
  lectura: [
    'books', 'libros', 'reading', 'leer', 'literatura',
    'novelas', 'poesía', 'cuentos', 'manga', 'cómics', 'comics',
    'fantasía', 'ciencia ficción', 'sci-fi', 'terror', 'misterio',
    'romance', 'thriller', 'suspense', 'histórica', 'no ficción',
    'autoayuda', 'filosofía', 'psicología', 'divulgación',
    'harry potter', 'señor de los anillos', 'lotr', 'cancion de hielo y fuego',
    'asimov', 'stephen king', 'julio verne', 'borges', 'gabo',
  ],

  // ── Arte ──
  arte: [
    'art', 'dibujo', 'drawing', 'pintura', 'painting', 'ilustración',
    'fotografía', 'photography', 'diseño', 'design', 'graphic design',
    'escultura', 'música', 'baile', 'danza', 'teatro',
    'escritura', 'writing', 'poesía', 'cómic', 'manga',
    'digital art', '3d', 'blender', 'photoshop', 'procreate',
    'acuarela', 'óleo', 'carboncillo', 'pastel',
  ],

  // ── Tecnología ──
  tecnología: [
    'tech', 'technology', 'programación', 'programming', 'coding',
    'desarrollo', 'development', 'software', 'apps',
    'inteligencia artificial', 'ia', 'ai', 'machine learning',
    'data science', 'datos', 'big data',
    'videojuegos', 'gaming', 'game dev', 'gamedev',
    'hardware', 'pc', 'computadoras', 'laptops',
    'celulares', 'smartphones', 'android', 'ios', 'apple',
    'linux', 'windows', 'open source', 'código abierto',
    'web development', 'frontend', 'backend', 'fullstack',
    'react', 'javascript', 'python', 'java', 'c++', 'rust',
    'ciberseguridad', 'cybersecurity', 'hacking', 'hacker',
    'robótica', 'drones', 'impresión 3d', '3d printing',
    'realidad virtual', 'vr', 'realidad aumentada', 'ar',
  ],

  // ── Naturaleza ──
  naturaleza: [
    'nature', 'animales', 'animals', 'mascotas', 'pets', 'perros',
    'gatos', 'dogs', 'cats', 'plantas', 'plants', 'jardinería',
    'gardening', 'viajes', 'travel', 'senderismo', 'hiking',
    'camping', 'fotografía de naturaleza', 'wildlife',
    'ecología', 'ecology', 'medio ambiente', 'environment',
    'sostenibilidad', 'sustainability', 'reciclaje',
    'montaña', 'playa', 'mar', 'bosque', 'río',
  ],

  // ── Cocina ──
  cocina: [
    'cooking', 'cook', 'recetas', 'recipes', 'food', 'comida',
    'repostería', 'baking', 'pastelería', 'chef',
    'cocina italiana', 'cocina mexicana', 'cocina japonesa',
    'cocina china', 'cocina india', 'cocina tailandesa',
    'asados', 'parrilla', 'bbq', 'vegano', 'vegan', 'vegetariano',
    'sushi', 'pasta', 'pizza', 'hamburguesas',
    'mariscos', 'carnes', 'ensaladas', 'sopas',
    'coctelería', 'cocktails', 'vino', 'cerveza', 'beer', 'coffee', 'café',
  ],

  // ── Viajes ──
  viajes: [
    'travel', 'viajar', 'turismo', 'tourism', 'mochilero', 'backpacking',
    'aventura', 'adventure', 'road trip', 'crucero',
    'playa', 'montaña', 'ciudad', 'campo',
    'europa', 'asia', 'américa', 'áfrica', 'oceanía',
    'japón', 'méxico', 'españa', 'italia', 'francia',
    'fotografía de viajes', 'travel photography',
  ],

  // ── Educación ──
  educación: [
    'education', 'learning', 'aprender', 'estudio', 'study',
    'ciencia', 'science', 'matemáticas', 'math', 'física',
    'química', 'biología', 'historia', 'geografía',
    'idiomas', 'languages', 'inglés', 'español',
    'programación', 'coding', 'cursos', 'courses', 'online learning',
    'universidad', 'college', 'academia',
  ],

  // ── Moda ──
  moda: [
    'fashion', 'style', 'estilo', 'ropa', 'clothing',
    'streetwear', 'sneakers', 'zapatillas', 'accesorios',
    'maquillaje', 'makeup', 'skincare', 'cuidado personal',
    'tatuajes', 'tattoo', 'piercings', 'belleza', 'beauty',
    'diseño de moda', 'sostenible', 'vintage',
  ],

  // ── Fotografía ──
  fotografía: [
    'photography', 'photo', 'foto', 'cámara', 'camera',
    'retrato', 'paisaje', 'street photography',
    'edición', 'editing', 'lightroom', 'photoshop',
    'videografía', 'video', 'film', 'cine',
    'drone', 'dron',
  ],

  // ── Salud y bienestar ──
  'salud y bienestar': [
    'health', 'salud', 'wellness', 'bienestar',
    'yoga', 'meditación', 'meditation', 'mindfulness',
    'fitness', 'gym', 'ejercicio', 'workout',
    'nutrición', 'nutrition', 'dieta', 'comida saludable',
    'dormir', 'sleep', 'descanso', 'relajación',
    'terapia', 'therapy', 'salud mental', 'mental health',
  ],

  // ── Anime y manga ──
  'anime y manga': [
    'anime', 'manga', 'japonés', 'japan',
    'shonen', 'shojo', 'seinen', 'isekai', 'mecha',
    'naruto', 'one piece', 'dragon ball', 'attack on titan',
    'demon slayer', 'jujutsu kaisen', 'my hero academia',
    'death note', 'fullmetal alchemist', 'cowboy bebop',
    'evangelion', 'ghibli', 'studio ghibli', 'spirited away',
    'tokyo ghoul', 'hunter x hunter', 'bleach',
    'chainsaw man', 'spy x family', 'kaguya-sama',
    'steins;gate', 'code geass', 'monster',
  ],

  // ── Mascotas ──
  mascotas: [
    'pets', 'animales', 'animals',
    'perros', 'dogs', 'gatos', 'cats', 'conejos', 'hamster',
    'peces', 'fish', 'aves', 'birds', 'reptiles',
    'caballos', 'horses', 'veterinaria',
    'adiestramiento', 'cuidado animal',
  ],

  // ── Música en vivo / Conciertos ──
  'música en vivo': [
    'conciertos', 'concerts', 'festivales', 'festivals',
    'coachella', 'lollapalooza', 'tonight show',
    'banda', 'band', 'orquesta', 'sinfónica',
  ],
};

/**
 * Flatten the dictionary into a reverse map: specific → [general categories]
 * e.g. "reggaeton" → ["música"]
 *      "minecraft" → ["videojuegos"]
 *      "anime" → ["cine y tv", "anime y manga"]
 */
const SPECIFIC_TO_GENERAL = {};
for (const [general, specifics] of Object.entries(INTEREST_CATEGORIES)) {
  for (const specific of specifics) {
    if (!SPECIFIC_TO_GENERAL[specific]) {
      SPECIFIC_TO_GENERAL[specific] = [];
    }
    // Avoid duplicates
    if (!SPECIFIC_TO_GENERAL[specific].includes(general)) {
      SPECIFIC_TO_GENERAL[specific].push(general);
    }
  }
}

/**
 * Get all general categories that an interest belongs to.
 * @param {string} interest - The interest to look up (case-insensitive).
 * @returns {string[]} Array of general category names.
 */
export function getGeneralCategories(interest) {
  const key = interest.toLowerCase().trim();
  const direct = SPECIFIC_TO_GENERAL[key] || [];
  // Also check if the interest itself is a general category
  const isGeneral = INTEREST_CATEGORIES[key] ? [key] : [];
  return [...new Set([...direct, ...isGeneral])];
}

/**
 * Count how many interests of set B are related to any interest in set A,
 * using the hierarchical mapping.
 * @param {string[]} interestsA - The reference set (e.g. current user's interests).
 * @param {string[]} interestsB - The target set (e.g. explore profile's interests).
 * @returns {number} Overlap count.
 */
export function countInterestOverlap(interestsA, interestsB) {
  if (!interestsA?.length || !interestsB?.length) return 0;

  // Pre-compute categories for all interests to avoid redundant calls
  const catCache = {};
  const getCats = (int) => {
    const key = int.toLowerCase().trim();
    if (!catCache[key]) catCache[key] = getGeneralCategories(int);
    return catCache[key];
  };

  const catsA = interestsA.map(i => getCats(i));

  let overlap = 0;
  const counted = new Set();

  interestsB.forEach((intB) => {
    const bCats = getCats(intB);
    const bKey = intB.toLowerCase().trim();
    for (const catB of bCats) {
      interestsA.forEach((intA, i) => {
        const aKey = intA.toLowerCase().trim();
        const pairKey = `${aKey}::${bKey}`;
        if (catsA[i].includes(catB) && !counted.has(pairKey)) {
          overlap++;
          counted.add(pairKey);
        }
      });
    }
  });

  return overlap;
}

/**
 * Get all known interests (both general categories and specific sub-interests).
 * @returns {string[]} Sorted array of all interest names.
 */
export function getAllInterests() {
  const all = new Set();
  for (const [general, specifics] of Object.entries(INTEREST_CATEGORIES)) {
    all.add(general);
    specifics.forEach(s => all.add(s));
  }
  return [...all].sort();
}

export default INTEREST_CATEGORIES;
