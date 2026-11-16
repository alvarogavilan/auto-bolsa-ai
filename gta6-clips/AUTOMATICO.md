# Piloto automático: campañas de clipping de GTA 6

En esta modalidad **no grabas ni editas nada**. Streamers y marcas pagan por cada 1.000 vistas a quien recorte sus directos y los publique. `auto_campanas.py` hace todo el trabajo repetitivo:

```
directo nuevo del streamer ──► descarga (yt-dlp) ──► mejores momentos en 9:16 (clipper.py)
      ──► subida a TU YouTube como Short programado (3/día) ──► enlaces_para_enviar.csv
```

## Lo que tienes que hacer tú UNA vez (≈1 hora)

1. **Apúntate a campañas.** En [Whop → Content Rewards](https://whop.com/discover/) busca "GTA 6" o "GTA" y únete a 1–3 campañas. Lee sus reglas: duración mínima, hashtags y mención obligatorios.
2. **Rellena `campanas.json`.** Se crea solo la primera vez a partir de `campanas.ejemplo.json`. Pon en `permiso` el enlace de la campaña y en `fuentes` el canal del streamer. **Sin `permiso` el script se niega a procesar la campaña.**
3. **Crea un canal de YouTube** solo para esto.
4. **Conecta YouTube:**
   - En Google Cloud Console crea un proyecto y activa *YouTube Data API v3*.
   - Crea credenciales *OAuth → Aplicación de escritorio* y descárgalas como `client_secret.json` en esta carpeta.
   - Ejecuta `python auto_campanas.py --auth`.
5. **Déjalo corriendo** en un ordenador que esté siempre encendido, o en un VPS de ~5 €/mes:
   ```bash
   pip install numpy yt-dlp google-api-python-client google-auth-oauthlib   # + ffmpeg
   crontab -e
   0 */3 * * * cd /ruta/gta6-clips && python3 auto_campanas.py >> auto.log 2>&1
   ```
   En Windows usa el Programador de tareas con el mismo comando cada 3 horas.

## Lo que queda manual (y por qué)

- **Enviar los enlaces a la campaña:** cada pocos días copias `enlaces_para_enviar.csv` en Whop. Whop no tiene una API pública para hacerlo.
- **⚠ Bloqueo de YouTube:** los vídeos subidos por la API desde un proyecto de Google **no verificado** se quedan en *privado*. Para que se publiquen solos hay que pasar la [auditoría de la API de YouTube](https://support.google.com/youtube/contact/yt_api_form), que es gratis y tarda días o semanas. Mientras tanto tienes dos opciones:
  - pasar los vídeos a "Público" a mano en YouTube Studio (≈2 min al día);
  - usar `--dry-run`, que solo genera los clips, y subirlos tú en lote desde Studio con su programador.
- **Revisar títulos:** las plantillas son genéricas. Si un clip pide un título concreto, cámbialo para no hacer clickbait falso.

## Expectativas honestas

- Las campañas pagan por vistas *verificadas*, y muchas exigen un mínimo por vídeo. Los primeros días puedes no cobrar nada.
- Cientos de personas compiten en las mismas campañas. Ganan los que publican rápido después de cada directo, y eso es justo lo que automatiza esto.
- Revisa los clips de vez en cuando: la detección se basa en el volumen y en los cortes de escena, y no "entiende" el humor.
- Nunca añadas fuentes sin permiso. Un solo strike de copyright te puede cerrar el canal y anular todo el trabajo.
