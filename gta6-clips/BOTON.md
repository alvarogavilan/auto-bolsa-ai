# 📱 El botón: recortar clips de GTA 6 desde el iPhone

Todo se hace en la **app de GitHub** del iPhone, la misma desde la que ya controlas Auto Bolsa. El trabajo pesado lo hacen los servidores de GitHub y tu móvil solo pulsa el botón.

## Cada vez que quieras clips (30 segundos de tu tiempo)

1. Abre un **directo de GTA 6 de una campaña a la que estés apuntado** (Twitch, YouTube o Kick) y copia el enlace.
2. En la app de GitHub ve a **auto-bolsa-ai → Actions → "Recortar clips GTA 6" → Run workflow**.
3. Pega el enlace. Si el directo dura horas, rellena `tramo` (p. ej. `1:00:00-1:40:00`), que es más rápido. Pulsa **Run**.
4. A los 5–15 minutos abre la ejecución. Verás la tabla de clips y, abajo, **Artifacts → clips-gta6**: un zip con los vídeos y `COPIAR_Y_PEGAR.txt`.
5. Abre el zip en *Archivos*, sube cada clip a TikTok, YouTube Shorts o Reels y pega el título y la descripción del txt.
6. Envía los enlaces de tus publicaciones a la campaña, en Whop.

## Seguimiento automático (sin pulsar nada)

Cada día a las 08:17 (hora de España) el botón se ejecuta solo y recorta los directos de GTA 6 publicados en las últimas 26 horas por los streamers de tus campañas. Para activarlo:

1. Copia `campanas.ejemplo.json` como **`campanas.seguimiento.json`**.
2. Para cada campaña rellena:
   - `permiso`: el enlace de la campaña en Whop. **Sin él se omite.**
   - `fuentes`: el canal del streamer, p. ej. `https://www.twitch.tv/NOMBRE/videos`.
   - `mencion` y `hashtags_obligatorios`: según las reglas de la campaña.
3. Súbelo al repositorio. Cada mañana tendrás una ejecución nueva con los clips listos para descargar.

## Qué vídeo coger: el criterio

En las campañas te pagan por vistas, así que elige:
- **El directo más reciente** (de las últimas 24 h). La novedad es lo que más se ve.
- **Streamers grandes con campañas activas** para GTA 6, que son los que tienen más público buscando sus clips.
- **Tramos de caos**: primeras horas de juego, persecuciones, misiones con mucho grito, reacciones a sitios famosos de Vice City.
- **Evita los tramos de menús, cinemáticas largas o radio con música**: la detección los puntúa bajo, y la música provoca reclamaciones de copyright.

## Avisos

- Solo vídeos de campañas o creadores que te dan permiso.
- **YouTube a veces bloquea las descargas desde servidores** ("Sign in to confirm you're not a bot"). Twitch y Kick suelen funcionar bien. Si un enlace de YouTube falla, usa el VOD de Twitch del mismo directo.
- Si el repositorio es **público**, cualquiera con cuenta de GitHub puede descargar los zips durante 7 días. Si es privado, tienes 2.000 minutos gratis al mes, unos 100–200 vídeos.
- **El botón aparece cuando este archivo de workflow está en la rama `main`**: GitHub solo muestra "Run workflow" para workflows que están en la rama principal.
