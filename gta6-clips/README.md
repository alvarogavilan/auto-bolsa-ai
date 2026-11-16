# GTA 6 Clipper: clips automáticos y plan para ganar dinero

GTA 6 sale el **jueves 19 de noviembre de 2026** en PS5 y Xbox Series X|S. Desbloquea a medianoche hora local. No hay versión de PC ni GTA Online de salida.
Las primeras 2–3 semanas son la ventana de oro: la búsqueda de "GTA 6" estará en máximos y casi cualquier clip decente recibirá visitas. Este módulo existe para que produzcas mucho volumen con poco esfuerzo en esas semanas.

## 1. La herramienta

`clipper.py` coge tus grabaciones largas y saca clips verticales listos para subir:

- Detecta los mejores momentos. Mide cuánto sube el audio respecto a su contexto (explosiones, choques, gritos, risas) y la densidad de cortes de escena (acción rápida).
- Corta cada clip con el pico **después del segundo 7**, porque YouTube no monetiza la violencia gráfica en los primeros 7 s (cambio de sept. 2026).
- Renderiza en 1080×1920 con el juego centrado y fondo difuminado (sin perder el HUD), título grande, tu `@handle` y audio normalizado a −14 LUFS.
- Opcionalmente genera subtítulos dinámicos en mayúsculas con `--subs` (requiere `pip install faster-whisper`).
- Genera `clips.csv` y `clips.json` con títulos en ES/EN, hashtags y **calendario de publicación**. También `prompt_titulos.txt`, que puedes pegar en Claude para pedir títulos mejores.

```bash
pip install numpy               # + ffmpeg instalado
python clipper.py partida.mp4 --handle @TuCanal
python clipper.py grabaciones/ -n 8 --length 35 --handle @TuCanal --subs
python clipper.py --watch ~/Capturas --handle @TuCanal   # modo automático
```

Opciones útiles: `--layout crop` llena la pantalla y recorta los lados; `--zoom 1.4` muestra el juego más grande; `--context "persecución policial"` usa ese tema en el título; `--min-score 0.6` saca más clips si salen pocos; `--dry-run` solo analiza.

**Cómo grabar en consola:** en PS5 o Xbox, usa la grabación de la consola (hasta 1 h) y súbela al móvil o PC. La otra opción es una capturadora (Elgato o similar) con OBS, apuntando `--watch` a la carpeta de grabaciones. Así cada sesión se convierte en clips sin tocar nada.

Pruebas: `python -m unittest test_clipper.py`

> 📱 **Botón desde el iPhone:** [BOTON.md](BOTON.md).
>
> ¿No quieres grabar? Mira [AUTOMATICO.md](AUTOMATICO.md): piloto automático para campañas de clipping.

## 2. Formas de ganar dinero (de más a menos realista)

| # | Vía | Cómo se cobra | Inversión | Notas |
|---|-----|---------------|-----------|-------|
| 1 | **Shorts/TikTok/Reels con tu propio gameplay** (esta herramienta) | Fondo de Shorts, TikTok Creator Rewards (vídeos >1 min), Reels | Consola + juego | Volumen: 3–5 clips/día durante el lanzamiento. Lo que llega a dinero es el canal que crece, no un clip suelto. |
| 2 | **Campañas de clipping** para streamers y marcas | Pago por cada 1.000 vistas (p. ej. Whop Content Rewards) | Ninguna | Con la herramienta procesas VODs **de quien te contrata**, con permiso. Es la forma legal de "automatizar clips de otros". |
| 3 | **Guías útiles** (vídeo largo + web): mapa, coleccionables, dinero rápido, mejores coches, ubicaciones | AdSense/YouTube largo (CPM mucho mayor que Shorts) | Tiempo | Tiene búsquedas durante meses. Los Shorts te dan alcance y las guías te dan dinero. |
| 4 | Afiliados | Amazon (capturadoras, mandos, auriculares), tiendas de juegos | Ninguna | En la descripción de cada vídeo. |
| 5 | Servicio de edición | Cobrar a otros creadores por sacarles clips | Ninguna | Vendes el resultado de este script. |

**Plan sugerido para la semana de lanzamiento:**
1. Días 0–2: abre el canal de Shorts y la cuenta de TikTok con el mismo nombre. Graba sesiones de 1–2 h buscando caos, persecuciones, físicas raras y detalles del mundo. Procésalas cada noche.
2. Días 3–14: mantén 3–5 publicaciones al día en cada red (el CSV ya trae el horario). Mira qué tipo de clip funciona y graba más de eso.
3. Desde la semana 2: añade 1–2 vídeos largos de guía por semana y únete a 1–2 campañas de clipping.

## 3. Cosas que te pueden hundir el canal (evítalas)

- **Resubir vídeos o streams de otros sin permiso.** Te llegan strikes de copyright y YouTube te rechaza en el Partner Program por "contenido reutilizado". Usa solo tu gameplay o el de quien te paga.
- **Leaks, "descargar GTA 6 gratis" o "GTA 6 para PC/móvil".** Son estafas o contenido que Rockstar/Take-Two denuncia. Además no existe versión de PC.
- **Radio del juego.** Las emisoras con música licenciada suelen activar Content ID, y el dinero se lo lleva la discográfica. Graba con la radio apagada o en emisoras de tertulia.
- **Violencia en los primeros 7 s y recopilatorios de "matar NPCs".** YouTube los desmonetiza. Empieza con el contexto o la tensión y deja la explosión para después.
- **Clickbait falso** (cosas que no salen en el clip): baja la retención y el algoritmo deja de mostrarte.

La política de vídeo de Rockstar permite subir gameplay, pero la redacta pensando en uso de fans y no comercial. Revisa la versión vigente antes de monetizar fuerte.

### Fuentes
- [Forbes: fecha y hora de GTA VI en PS5/Xbox](https://www.forbes.com/sites/erikkain/2026/11/16/gta-6-release-date-time-ps5-xbox-series-x-download-size-day-one-update/)
- [Forbes: hora de desbloqueo por zona](https://www.forbes.com/sites/brianmazique/2026/11/12/gta-6-unlocks-at-midnight-on-november-19-but-millions-of-americans-can-start-playing-the-night-before/)
- [Dexerto: YouTube cambia la monetización de violencia antes de GTA 6](https://www.dexerto.com/gta/youtube-updates-gaming-violence-monetization-rules-ahead-of-gta-6-launch-3405945/)
- [Teknofilo: la regla de los siete segundos](https://www.teknofilo.com/gta-6-youtube-monetizacion-regla-siete-segundos/amp/)
- [Rockstar Games: política de vídeo](https://support.rockstargames.com/articles/200153756/rockstar-games-video-policy)
