# 📡 Radar viral: el equipo de análisis automático

Cada vez que se ejecuta el botón, y además cada 2 horas por su cuenta, el radar hace esto antes de recortar:

| Analista | Qué mira | Para qué |
|---|---|---|
| **Tendencias Shorts** | Los Shorts de GTA 6 de las últimas 24 h (ES + EN), ordenados por **vistas por hora** | Palabras, frases y hashtags que están explotando **ahora** |
| **Horario** | A qué hora se publicaron los que más rápido crecen | Programar tus clips en esas horas |
| **Formato** | Duración de los ganadores | Ajustar la duración de tus clips |
| **Directos Twitch** | Directos de GTA 6 con más espectadores ahora mismo | Descubrir streamers grandes con campaña de clipping |
| **Objetivos** | VODs recién terminados de **tus** campañas | Recortarlos al momento, antes que nadie |

Los títulos, hashtags y horas de tus clips salen **automáticamente** de este análisis. El informe aparece en cada ejecución del botón (resumen + *Artifacts → radar-viral*).

## Activarlo (una sola vez, ~10 min, gratis)

Guarda tres claves como **secretos** del repositorio: GitHub → *auto-bolsa-ai* → **Settings → Secrets and variables → Actions → New repository secret**.

1. **`YT_API_KEY`** (YouTube Shorts)
   - Entra en [console.cloud.google.com](https://console.cloud.google.com/) → crea un proyecto.
   - *APIs y servicios* → *Biblioteca* → **YouTube Data API v3** → *Habilitar*.
   - *Credenciales* → *Crear credenciales* → **Clave de API**. Copia la clave y pégala como secreto.
2. **`TWITCH_CLIENT_ID`** y **`TWITCH_CLIENT_SECRET`** (Twitch)
   - Entra en [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → *Register Your Application*.
   - Nombre: el que quieras. OAuth Redirect URL: `http://localhost`. Categoría: *Analytics Tool*.
   - Copia el **Client ID**, pulsa *New Secret* y copia el **Client Secret**.
3. **Campañas:** crea `gta6-clips/campanas.seguimiento.json`, copiando `campanas.ejemplo.json`. Pon en `fuentes` el Twitch de cada streamer (`https://www.twitch.tv/NOMBRE`) y en `permiso` el enlace de la campaña de Whop.

Sin claves, el botón sigue funcionando; solo te faltará el análisis.

## Límites honestos

- **TikTok no se analiza.** TikTok no ofrece acceso a sus datos de tendencias salvo a investigadores aprobados, y extraerlos a escondidas va contra sus normas. Lo que crece en Shorts suele crecer también en TikTok.
- **Las "vistas por hora" de las últimas 24 h son una pista, no una garantía.** El radar te dice qué está funcionando, pero ningún sistema puede asegurar que algo se haga viral.
- **Cuota gratuita de YouTube:** 10.000 unidades al día. El radar gasta unas 300 por ejecución, así que da para más de 30 al día.
- **Whop no tiene API.** Las campañas nuevas las añades tú en el JSON.
