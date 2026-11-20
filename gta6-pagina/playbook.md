# Playbook: página «faceless» de GTA 6

Las reglas que sigue Claude (y tú) para llevar la página. Los ajustes marcados con ✏️ son valores por defecto; cámbialos cuando quieras.

## 1. Identidad ✏️

| Campo | Valor |
|---|---|
| Nombre de la página | **GTA 6 Al Día** |
| Handle | **@aldiagta6** en TikTok, Instagram y X · YouTube: @gta6aldia123 (cámbialo a @aldiagta6 si está libre) |
| Plataformas | TikTok, YouTube Shorts, Instagram Reels, X |
| Idioma | Español (títulos en inglés solo si un clip lo pide) |
| Zona horaria | Europe/Madrid |
| Enfoque | **Trucos, secretos y clips de directos**: lo útil + lo espectacular |
| Voz | Sin cara. Texto en pantalla; voz IA opcional |
| Publicaciones/día | TikTok 3 · Shorts 3 · Reels 2 · X 4 |
| Aprobación | Claude prepara y **tú apruebas** cada publicación (un «sí» basta) |

**Bio:** «GTA 6 Al Día · Página de fans 🌴 Trucos, secretos y los mejores momentos cada día. No afiliada a Rockstar Games.»
**Avatar:** un icono propio (letras + palmera o coche estilizado). **Nunca** el logo de Rockstar ni arte oficial: parecería una cuenta oficial.

## 2. Pilares de contenido

| Pilar | Qué es | Por qué funciona | Mezcla diaria |
|---|---|---|---|
| **Oficial** | Noticia verificada de Rockstar, Take-Two, PlayStation o Xbox | Velocidad = alcance | Mañana |
| **Trucos (HOW TO)** | Pasos cortos: dinero, coches, secretos, ajustes | Se guarda y se comparte | Media mañana |
| **Clip** | Momento de un directo, con crédito (botón de clips) | El formato que más se ve | Mediodía y tarde |
| **Nostalgia** | «13 años de Los Santos a Leonida» | Muchas respuestas | Primera tarde |
| **Foco** | Un personaje, lugar, coche o mecánica | Fácil de repetir | Tarde |
| **Pregunta** | «¿Qué fue lo primero que hiciste?» | Respuestas = algoritmo | Noche |

Mejor saltarse un hueco que publicar algo flojo o sin verificar.

## 3. Reglas de clips (lo que NO se negocia)

1. **Solo con permiso**: campañas de clipping (Whop) o creadores que lo autoricen por escrito. Pedir permiso es fácil: «Me encantó este clip, ¿te importa si lo comparto con crédito?».
2. **Crédito siempre**, en su propia línea: `🎥 @creador`. Material oficial: `📸 @RockstarGames`.
3. **Transformar**: recorte, gancho en pantalla, subtítulos, comentario o contexto. Nunca resubir tal cual.
4. Si alguien pide retirarlo, se retira **el mismo día** y se apunta en `takedowns.md`.
5. **Nunca**: filtraciones, cuentas sin datos, «juega antes», exploits, cracks, «GTA 6 para PC/móvil», sorteos falsos.
6. El gameplay es propiedad de Rockstar: se usa por su tolerancia con los fans. No se vende ni se presenta como propio.

## 4. Cómo se hace un clip

- **Gancho en el primer segundo** (texto en pantalla): «EL SECRETO QUE NADIE VIO», «ASÍ SE GANA DINERO RÁPIDO».
- **7–30 s**, cortar en cuanto llega el remate.
- **Subtítulos grandes**, centrados en la zona segura.
- **Sin violencia gráfica en los primeros 7 s** (YouTube no lo monetiza). El botón ya lo hace.
- **Sin spoilers** de historia en el gancho ni en la miniatura durante las primeras semanas.

| Plataforma | Formato | Notas |
|---|---|---|
| TikTok | 9:16 · 1080×1920 | Gancho en 1 s; 3–5 hashtags |
| YouTube Shorts | 9:16 · 1080×1920 | Hasta 3 min; mejor 20–40 s |
| Instagram Reels | 9:16 · 1080×1920 | 3–5 hashtags; mejor < 90 s |
| X | 16:9 o 9:16 | Sin hashtags; una línea + crédito |

## 5. Textos (plantillas)

- **Noticia (X):** `GTA 6 [titular verificado]:` + 3 viñetas verificadas + `📸 @RockstarGames`
- **Truco:** `CÓMO [HACER ALGO] EN GTA 6` + 3 pasos + remate opcional
- **Clip:** `[Gancho o reacción en una línea]` + línea en blanco + `🎥 @creador`
- **Nostalgia:** `[X] años de Los Santos.` + `[Día], es [nueva ciudad].`
- **Pregunta:** `[Pregunta sencilla que todos pueden responder]?`

`python gta6-pagina/pagina.py cola <carpeta de clips>` genera estos textos por plataforma a partir de los clips del botón.

## 6. Verificación y seguridad

1. **Cada dato** tiene una fuente oficial en `facts.md`. Si tiene más de 48 h, se vuelve a comprobar.
2. **Rumores**: fuera por defecto. Si se aprueban, empiezan por «RUMOR:» y llevan fuente.
3. **Nada inventado**: ni fechas, ni cifras de ventas, ni «fuentes internas».
4. Nunca dar a entender que somos Rockstar. Sin sorteos ni «copias gratis».
5. Nada de contraseñas ni datos privados en chats o archivos.

## 7. Bucle de aprendizaje

- Cada publicación se apunta en `scoreboard.csv`, con métricas a las 12 h, 24 h y 72 h.
- **Un experimento al día**: cambiar una sola variable (gancho, duración, hora, formato) y apuntarlo en `test_name`.
- **Nunca juzgar antes de 24 h.**
- `python gta6-pagina/pagina.py revision` saca lo mejor, lo peor y la mediana por pilar, hora y formato, y lo añade a `learning.md`.

## 8. Rutinas automáticas (skills de Claude)

| Comando | Qué hace |
|---|---|
| `/gta6-diario` | Revisa fuentes oficiales y tendencias, propone la parrilla del día con borradores verificados y espera tu «sí» |
| `/gta6-semanal` | Revisión semanal: top/bottom 3, qué doblar, qué cortar, experimentos de la semana |
| `/gta6-lanzamiento` | Guion de «ser los primeros» para el lanzamiento, un parche o un tráiler |
