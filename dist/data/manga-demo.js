const DEMO_NOTICE = 'Modo demo activo mientras la fuente de manga externa vuelve a estar disponible.';
function svgDataUri(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function createPoster(title, tagline, palette) {
    const [primary, secondary, accent] = palette;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1080">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${primary}"/>
          <stop offset="55%" stop-color="${secondary}"/>
          <stop offset="100%" stop-color="#050505"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="720" height="1080" fill="url(#bg)"/>
      <circle cx="565" cy="170" r="180" fill="url(#glow)" opacity="0.42"/>
      <rect x="70" y="86" width="580" height="18" rx="9" fill="#ffffff" opacity="0.16"/>
      <rect x="70" y="138" width="220" height="14" rx="7" fill="#ffffff" opacity="0.14"/>
      <g opacity="0.16">
        <rect x="72" y="260" width="270" height="410" rx="28" fill="#ffffff"/>
        <rect x="380" y="320" width="210" height="300" rx="28" fill="#ffffff"/>
        <rect x="96" y="714" width="528" height="220" rx="36" fill="#0b0b0b"/>
      </g>
      <text x="78" y="770" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="26" letter-spacing="8">MANGA DEMO</text>
      <text x="78" y="838" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="62" font-weight="700">${title}</text>
      <text x="78" y="896" fill="#f7d8bf" font-family="Segoe UI, Arial, sans-serif" font-size="28">${tagline}</text>
    </svg>
  `;
    return svgDataUri(svg);
}
function createPage(title, chapterLabel, pageNumber, palette) {
    const [primary, secondary, accent] = palette;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1800">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0a0a0a"/>
          <stop offset="100%" stop-color="${primary}"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="1800" fill="url(#bg)"/>
      <rect x="80" y="90" width="1040" height="160" rx="42" fill="#ffffff" opacity="0.08"/>
      <rect x="80" y="320" width="500" height="620" rx="44" fill="${secondary}" opacity="0.34"/>
      <rect x="620" y="320" width="500" height="270" rx="44" fill="#ffffff" opacity="0.12"/>
      <rect x="620" y="640" width="500" height="300" rx="44" fill="${accent}" opacity="0.26"/>
      <rect x="80" y="1008" width="1040" height="632" rx="54" fill="#050505" opacity="0.82"/>
      <text x="120" y="170" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700">${title}</text>
      <text x="120" y="226" fill="#f6c89a" font-family="Segoe UI, Arial, sans-serif" font-size="28" letter-spacing="6">${chapterLabel}</text>
      <text x="120" y="1106" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="34" letter-spacing="5">PAGINA ${pageNumber}</text>
      <text x="120" y="1188" fill="#f1f5f9" font-family="Segoe UI, Arial, sans-serif" font-size="78" font-weight="700">Lectura integrada</text>
      <text x="120" y="1292" fill="#d4d4d8" font-family="Segoe UI, Arial, sans-serif" font-size="36">Seccion de manga lista para cambiar a una fuente real cuando el proveedor vuelva.</text>
      <text x="120" y="1438" fill="#e7e5e4" font-family="Segoe UI, Arial, sans-serif" font-size="34">Mantuvimos el estilo oscuro, limpio y directo del resto de la app.</text>
      <text x="1028" y="1688" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700">${String(pageNumber).padStart(2, '0')}</text>
    </svg>
  `;
    return svgDataUri(svg);
}
function chapterId(seedId, index) {
    return `${seedId}${String(index + 1).padStart(2, '0')}`;
}
const seeds = [
    {
        id: '41021',
        slug: 'oshi-no-ko',
        libraryType: 'manga',
        title: '[Oshi No Ko]',
        tagline: 'Idolos, secretos y una segunda vida.',
        synopsis: 'Un drama de espectaculo y obsesion donde cada capitulo cambia la imagen publica y el precio personal de sus protagonistas.',
        description: 'Ai Hoshino parecia inalcanzable, pero detras del brillo habia contratos, presion y un mundo dispuesto a devorar talentos. Esta ficha de demo sirve para dejar lista la seccion de manga con una estructura estable para home, detalle y lectura.',
        status: 'En publicacion',
        demography: 'Seinen',
        rating: '4.8',
        genres: ['Drama', 'Psicologico', 'Misterio'],
        palette: ['#7c3aed', '#f43f5e', '#fb7185'],
        chapterTitles: ['El brillo de escena', 'La mentira perfecta', 'La camara y el vacio', 'Un casting peligroso', 'El precio del aplauso'],
        alternativeTitles: ['My Star', 'Oshi no Ko'],
        relatedIds: ['41035', '41042'],
    },
    {
        id: '41035',
        slug: 'blue-lock',
        libraryType: 'manga',
        title: 'Blue Lock',
        tagline: 'Ego, ritmo y definicion letal.',
        synopsis: 'Un proyecto radical toma a los delanteros mas intensos del pais y los obliga a pulir su identidad dentro del area.',
        description: 'Blue Lock mezcla competencia cerrada, paneles agresivos y capitulos pensados para cerrar siempre arriba. Aqui queda listo como una serie de lectura rapida y scroll vertical.',
        status: 'En publicacion',
        demography: 'Shounen',
        rating: '4.7',
        genres: ['Deportes', 'Accion', 'Drama'],
        palette: ['#0f172a', '#2563eb', '#38bdf8'],
        chapterTitles: ['El disparo egoista', 'Area de presion', 'Nadie retrocede', 'Control total', 'A un toque del gol'],
        alternativeTitles: ['Buruu Rokku'],
        relatedIds: ['41021', '41058'],
    },
    {
        id: '41042',
        slug: 'frieren-beyond-journeys-end',
        libraryType: 'manga',
        title: 'Frieren',
        tagline: 'El viaje empieza despues de la victoria.',
        synopsis: 'Una maga inmortal descubre que el tiempo no se mide en conquistas sino en lo que se recuerda demasiado tarde.',
        description: 'Esta entrada conserva un tono mas contemplativo para equilibrar la home. El detalle prioriza atmosfera, capitulos y una lectura vertical sobria.',
        status: 'En publicacion',
        demography: 'Shounen',
        rating: '4.9',
        genres: ['Fantasia', 'Aventura', 'Drama'],
        palette: ['#0f766e', '#155e75', '#99f6e4'],
        chapterTitles: ['Despues del himno', 'El peso del tiempo', 'Cartas que no llegan', 'Bosque de ecos', 'La memoria de Himmel'],
        alternativeTitles: ['Sousou no Frieren'],
        relatedIds: ['41021', '41071'],
    },
    {
        id: '41058',
        slug: 'sakamoto-days',
        libraryType: 'manga',
        title: 'Sakamoto Days',
        tagline: 'La rutina perfecta del asesino retirado.',
        synopsis: 'Accion fisica, humor seco y peleas que convierten cualquier pasillo de tienda en una persecucion total.',
        description: 'Sakamoto Days entra aqui como la opcion mas ligera y cinetica del catalogo. La interfaz de lectura le queda bien porque cada pagina se entiende a simple scroll.',
        status: 'En publicacion',
        demography: 'Shounen',
        rating: '4.6',
        genres: ['Accion', 'Comedia', 'Crimen'],
        palette: ['#7f1d1d', '#dc2626', '#f59e0b'],
        chapterTitles: ['Un retiro inquieto', 'Cliente sospechoso', 'La tienda nunca cierra', 'Cuerpos en movimiento', 'Punto ciego'],
        alternativeTitles: ['Sakamoto Deizu'],
        relatedIds: ['41035', '41071'],
    },
    {
        id: '41071',
        slug: 'dandadan',
        libraryType: 'manga',
        title: 'Dandadan',
        tagline: 'Ritmo absurdo, energia total.',
        synopsis: 'Aliens, leyendas urbanas y una pareja imposible chocan a toda velocidad en un manga que no baja nunca las revoluciones.',
        description: 'Esta ficha sirve perfecto para la lectura integrada porque sus paginas combinan bloques grandes, diagonales y un contraste fuerte que luce bien en el tema oscuro.',
        status: 'En publicacion',
        demography: 'Shounen',
        rating: '4.8',
        genres: ['Accion', 'Sci-Fi', 'Sobrenatural'],
        palette: ['#312e81', '#7c3aed', '#22d3ee'],
        chapterTitles: ['Rumor acelerado', 'Choque sobrenatural', 'La ruta mas rara', 'Velocidad orbital', 'Sin frenos'],
        alternativeTitles: ['Dan Da Dan'],
        relatedIds: ['41058', '41042'],
    },
    {
        id: '41083',
        slug: 'solo-leveling',
        libraryType: 'manhwa',
        title: 'Solo Leveling',
        tagline: 'Subir de rango nunca fue tan frio.',
        synopsis: 'Portales, sombras y progreso puro en una fantasia de ascenso constante con una estetica dura y vertical.',
        description: 'Deje un manhwa dentro del bloque para que tambien tengas variedad de tipo y una lectura que se sienta natural en scroll largo desde el primer dia.',
        status: 'Finalizado',
        demography: 'Accion',
        rating: '4.9',
        genres: ['Accion', 'Fantasia', 'Aventura'],
        palette: ['#111827', '#1d4ed8', '#93c5fd'],
        chapterTitles: ['Calabozo de rango bajo', 'Subir o morir', 'La sombra despierta', 'Contrato roto', 'El cazador absoluto'],
        alternativeTitles: ['Na Honjaman Level Up'],
        relatedIds: ['41035', '41071'],
    },
];
const summaryById = new Map();
const detailByKey = new Map();
const readByKey = new Map();
const latestChapters = [];
function createSummary(seed) {
    return {
        id: seed.id,
        slug: seed.slug,
        libraryType: seed.libraryType,
        title: seed.title,
        cover: createPoster(seed.title, seed.tagline, seed.palette),
        synopsis: seed.synopsis,
        status: seed.status,
        demography: seed.demography,
        rating: seed.rating,
        genres: seed.genres,
        chapterCount: seed.chapterTitles.length,
        sourceUrl: null,
        source: 'demo',
    };
}
function createChapter(seed, index, cover) {
    const id = chapterId(seed.id, index);
    const title = seed.chapterTitles[index];
    return {
        id,
        slug: `chapter-${index + 1}`,
        title: `${seed.title} - ${title}`,
        numberLabel: `Capitulo ${String(index + 1).padStart(2, '0')}`,
        shortTitle: title,
        cover,
        sourceUrl: null,
    };
}
for (const seed of seeds) {
    const summary = createSummary(seed);
    summaryById.set(seed.id, summary);
}
for (const seed of seeds) {
    const summary = summaryById.get(seed.id);
    const chapters = seed.chapterTitles.map((_, index) => createChapter(seed, index, summary.cover));
    const related = seed.relatedIds
        .map((relatedId) => summaryById.get(relatedId))
        .filter((entry) => Boolean(entry));
    const detail = {
        ...summary,
        description: seed.description,
        alternativeTitles: seed.alternativeTitles,
        chapters,
        related,
        notice: DEMO_NOTICE,
    };
    detailByKey.set(`${seed.libraryType}:${seed.id}:${seed.slug}`, detail);
    chapters.forEach((chapter, index) => {
        const pages = Array.from({ length: 5 }, (_, pageIndex) => createPage(seed.title, chapter.numberLabel, pageIndex + 1, seed.palette));
        readByKey.set(`${seed.libraryType}:${seed.id}:${seed.slug}:${chapter.id}`, {
            manga: summary,
            chapter,
            chapters,
            pages,
            readingMode: 'pages',
            externalUrl: null,
            source: 'demo',
            notice: DEMO_NOTICE,
        });
        latestChapters.push({
            mangaId: seed.id,
            mangaSlug: seed.slug,
            mangaTitle: seed.title,
            libraryType: seed.libraryType,
            chapterId: chapter.id,
            chapterSlug: chapter.slug,
            chapterTitle: chapter.shortTitle,
            numberLabel: chapter.numberLabel,
            cover: summary.cover,
            sourceUrl: null,
        });
    });
}
latestChapters.sort((left, right) => Number(right.chapterId) - Number(left.chapterId));
export const mangaDemoHome = {
    featured: summaryById.get('41021'),
    trending: ['41021', '41035', '41042', '41058', '41071'].map((id) => summaryById.get(id)),
    latestChapters: latestChapters.slice(0, 10),
    spotlight: ['41083', '41058', '41071', '41042'].map((id) => summaryById.get(id)),
    source: 'demo',
    notice: DEMO_NOTICE,
};
export const mangaDemoCatalog = Array.from(summaryById.values());
export const mangaDemoDetails = detailByKey;
export const mangaDemoReads = readByKey;
