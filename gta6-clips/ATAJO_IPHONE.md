# 📲 Botón en la pantalla de inicio del iPhone (sin abrir GitHub)

Un **Atajo de iOS** que, con un toque, te pide el enlace del directo y lanza el recorte en los servidores de GitHub. No necesitas abrir GitHub ni iniciar sesión cada vez.

## 1. Crea una llave de acceso (una vez, 2 min)

1. En Safari, **inicia sesión en github.com** y abre https://github.com/settings/personal-access-tokens/new
2. *Token name*: `atajo-gta6`. *Expiration*: 90 días.
3. *Repository access* → **Only select repositories** → `auto-bolsa-ai`.
4. *Permissions* → *Repository permissions* → **Actions: Read and write**. No toques nada más.
5. **Generate token** y copia el texto que empieza por `github_pat_…`. Guárdalo solo dentro del Atajo, nunca en un chat.

Esta llave solo puede lanzar el botón de este repositorio: no da acceso a tu dinero, a tu código ni a tus cuentas.

## 2. Crea el Atajo (una vez, 3 min)

App **Atajos** → **+** → añade estas acciones en orden:

1. **Solicitar entrada** → Texto → pregunta: `Enlace del directo (Twitch/Kick)`.
2. **Texto** → pega esto tal cual:
   ```
   {"ref":"main","inputs":{"enlaces":"[Entrada proporcionada]"}}
   ```
   Sustituye `[Entrada proporcionada]` por la variable azul *Entrada proporcionada*: mantén pulsado y elige la variable.
3. **Obtener contenido de URL**:
   - URL: `https://api.github.com/repos/alvarogavilan/auto-bolsa-ai/actions/workflows/gta6-clips.yml/dispatches`
   - Método: **POST**
   - Encabezados:
     - `Authorization` → `Bearer github_pat_…` (tu llave)
     - `Accept` → `application/vnd.github+json`
   - Cuerpo de la solicitud: **Archivo** → la variable *Texto* del paso 2.
4. **Mostrar notificación** → `✅ Recortando. En unos minutos tendrás los clips en GitHub.`

Ponle de nombre **Recortar GTA 6** y, en *Compartir → Añadir a pantalla de inicio*, déjalo junto a tus apps.

## 3. Ver y descargar los clips

Ábrelos en la **app de GitHub** (con sesión iniciada): *auto-bolsa-ai → Actions → Recortar clips GTA 6* → la última ejecución → *Artifacts*.

> El enlace web da **404** si el navegador no tiene sesión iniciada en GitHub, porque el repositorio es privado. En la app de GitHub, o en Safari con sesión iniciada, funciona.
