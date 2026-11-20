"""Departamento viral (IA): Claude ve cada clip candidato (lo que dice el streamer y un
fotograma del momento clave) y decide cuáles tienen más opciones de hacerse virales.

Por cada clip devuelve: puntuación 0-100, si se entiende sin contexto, si el gancho
destripa algo (spoiler), si hay que descartarlo, el motivo y un título gancho en
inglés y en español. publicar.py reordena la lista con esa nota.

Dos motores:
  - GRATIS (por defecto en GitHub Actions): un modelo abierto (Qwen 2.5) que corre dentro
    del propio servidor con Ollama. Sin claves, sin tarjeta, sin coste.
  - Claude (opcional, mejor criterio y ve el fotograma): si existe ANTHROPIC_API_KEY.
Si ninguno está disponible, o algo falla, la publicación sigue con la puntuación automática.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

MODEL = os.environ.get("VIRAL_IA_MODELO", "claude-opus-5-5")
MAX_CANDIDATOS = int(os.environ.get("VIRAL_IA_MAX", "20"))  # limita el gasto por tanda
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
LOCAL_DEADLINE_S = 15 * 60  # el modelo gratis va en CPU: tope de tiempo por tanda

SYSTEM = """You are the head of a short-form video team that clips GTA 6 livestreams for paid
clipping campaigns (TikTok and YouTube Shorts, paid per 1,000 views). You judge which clips
will get the most views in the first hours, the way a top TikTok editor would.

What makes a GTA 6 clip go viral:
- An instant, visible hook in the first 2 seconds (chaos, crash, police, absurd physics, glitch, fail).
- A genuine, loud streamer reaction (laughing, screaming, disbelief) that pays off.
- It is understandable with zero context: a stranger scrolling gets it immediately.
- A clear payoff or punchline before the end; no slow build-up, no menus, no loading screens,
  no long talking about unrelated things.
- Novelty: something people have not seen yet in GTA 6.

Hard rules:
- Titles must not spoil story missions or the ending, must not contain slurs or insults, and must
  be honest about what happens (no fake clickbait). Max 60 characters, may end with one emoji.
- Swearing is normal in gaming streams and is already censored in the transcript (like F*CK):
  never lower the score for it. Only hateful slurs (shown as *****) are a problem.
- Mark descartar=true for clips that are boring, confusing without context, mostly menus/loading,
  or whose transcript contains hateful slurs.
- titulo_en must be natural English; titulo_es natural Spanish. Never copy the transcript, never use
  asterisks or swear words in titles.
- motivo is one short sentence in Spanish explaining the decision to a beginner.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "puntuacion": {"type": "integer"},
                    "sin_contexto": {"type": "boolean"},
                    "spoiler": {"type": "boolean"},
                    "descartar": {"type": "boolean"},
                    "motivo": {"type": "string"},
                    "titulo_en": {"type": "string"},
                    "titulo_es": {"type": "string"},
                },
                "required": ["id", "puntuacion", "sin_contexto", "spoiler", "descartar",
                             "motivo", "titulo_en", "titulo_es"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


def frame_b64(mp4: Path, at: float) -> str | None:
    """Un fotograma pequeño (JPEG, 360 px de ancho) del momento clave."""
    if not shutil.which("ffmpeg"):
        return None
    try:
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(at, 0):.2f}", "-i", str(mp4),
                            "-frames:v", "1", "-vf", "scale=360:-2", "-f", "image2", "-c:v", "mjpeg", "-"],
                           capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return base64.b64encode(r.stdout).decode() if r.returncode == 0 and r.stdout else None


def build_content(clips: list[dict], trends: dict | None) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": (
        "Judge these candidate clips. Each one has an id, the streamer, the campaign language, "
        "the transcript of what the streamer says, automatic stats and one frame from the key moment."
        + (f"\nWhat is trending right now in GTA 6 Shorts: {json.dumps(trends, ensure_ascii=False)[:1500]}"
           if trends else ""))}]
    for i, c in enumerate(clips):
        info = {"id": i, "streamer": c.get("credit", ""),
                "idioma_campana": (c.get("camp") or {}).get("idioma", "es"),
                "duracion_s": round(float(c.get("end", 0)) - float(c.get("start", 0)), 1) or None,
                "segundo_pico": round(float(c.get("peak", 0)) - float(c.get("start", 0)), 1),
                "intensidad_audio": c.get("score"), "reacciones": c.get("reactions"),
                "transcripcion": (c.get("transcript") or "")[:1200] or "(sin voz)"}
        content.append({"type": "text", "text": json.dumps(info, ensure_ascii=False)})
        img = frame_b64(Path(c["mp4"]), float(info["segundo_pico"])) if c.get("mp4") else None
        if img:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}})
    return content


def ask_claude(content: list[dict], client=None) -> list[dict]:
    import anthropic
    client = client or anthropic.Anthropic()
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason in ("refusal", "max_tokens"):
        print(f"Departamento viral: respuesta no válida ({resp.stop_reason}); se usa la puntuación automática.")
        return []
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text).get("clips", [])


SPANISH = re.compile(r"[áéíóúñ¿¡]|\b(el|la|los|las|que|de|en|un|una|esto|todo|vamos|estoy)\b", re.I)


def good_title(t: str, lang: str) -> bool:
    """Filtro de calidad: un título malo es peor que el gancho probado de siempre."""
    import clipper
    if not 8 <= len(t) <= 60 or "*" in t or clipper.has_slur(t) or clipper.censor(t) != t:
        return False
    if t.count(":") or t.isupper():
        return False
    if lang == "en":
        plain = clipper.strip_emoji(t)
        return plain.isascii() and not SPANISH.search(plain)
    return True


ONE = SCHEMA["properties"]["clips"]["items"]
ONE_SCHEMA = {**ONE, "properties": {k: v for k, v in ONE["properties"].items() if k != "id"},
              "required": [k for k in ONE["required"] if k != "id"]}


def _ollama(payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def ask_local(clips: list[dict], trends: dict | None, model: str, post=_ollama) -> list[dict]:
    """Modelo gratis en el propio servidor: un clip por consulta (va mejor con modelos pequeños)."""
    out, start = [], time.monotonic()
    extra = (f"\nTrending now in GTA 6 Shorts: {json.dumps(trends, ensure_ascii=False)[:600]}" if trends else "")
    for i, c in enumerate(clips):
        if time.monotonic() - start > LOCAL_DEADLINE_S:
            print(f"Departamento viral (gratis): tiempo agotado tras {i} clips.")
            break
        info = {"streamer": c.get("credit", ""), "campaign_language": (c.get("camp") or {}).get("idioma", "es"),
                "audio_intensity": c.get("score"), "reaction_words": c.get("reactions"),
                "transcript": (c.get("transcript") or "")[:900] or "(no speech)"}
        payload = {"model": model, "stream": False, "format": ONE_SCHEMA,
                   "options": {"temperature": 0.2, "num_ctx": 4096},
                   "messages": [{"role": "system", "content": SYSTEM},
                                {"role": "user", "content": "Judge this GTA 6 clip (puntuacion 0-100)." + extra
                                 + "\n" + json.dumps(info, ensure_ascii=False)}]}
        try:
            v = json.loads(post(payload, 240)["message"]["content"])
        except Exception as e:  # un clip fallido no para los demás
            print(f"Departamento viral (gratis): clip {i} sin valorar ({type(e).__name__}).")
            continue
        out.append({**v, "id": i})
    return out


def judge(clips: list[dict], trends: dict | None = None, client=None, post=None) -> bool:
    """Añade la opinión de la IA a los mejores candidatos y reordena la lista en sitio.
    Devuelve True si la IA ha opinado."""
    local = os.environ.get("VIRAL_IA_LOCAL", "")  # nombre del modelo gratis, p.ej. qwen2.5:3b
    use_claude = bool(client or os.environ.get("ANTHROPIC_API_KEY"))
    if not clips or not (use_claude or local):
        return False
    cands = clips[:MAX_CANDIDATOS]
    try:
        if use_claude:
            verdicts = ask_claude(build_content(cands, trends), client)
        else:
            verdicts = ask_local(cands, trends, local, post or _ollama)
    except Exception as e:  # nunca romper la publicación por la IA
        print(f"Departamento viral no disponible ({type(e).__name__}: {e}); se usa la puntuación automática.")
        return False
    import clipper
    top_rank = max((float(c.get("rank", 0)) for c in cands), default=0) or 1.0
    for v in verdicts:
        i = v.get("id")
        if not isinstance(i, int) or not 0 <= i < len(cands):
            continue
        c = cands[i]
        score = max(0, min(100, int(v.get("puntuacion", 0))))
        c["ia_score"] = score
        c["ia_motivo"] = str(v.get("motivo", ""))[:200]
        c["ia_descartar"] = bool(v.get("descartar")) or bool(v.get("spoiler"))
        c["ia_sin_contexto"] = bool(v.get("sin_contexto"))
        for key in ("titulo_en", "titulo_es"):
            t = str(v.get(key, "")).strip()
            c[f"ia_{key}"] = t if good_title(t, key[-2:]) else ""
        # nota final: 75 % la IA, 25 % la señal automática (audio + reacciones)
        c["ia_rank"] = round(0.75 * score + 25 * float(c.get("rank", 0)) / top_rank, 1)
    judged = [c for c in cands if "ia_score" in c]
    if not judged:
        return False
    for c in cands:
        if "ia_score" not in c:
            c["ia_rank"] = round(25 * float(c.get("rank", 0)) / top_rank, 1)
            c["ia_descartar"] = False
    cands.sort(key=lambda c: -c["ia_rank"])
    # descartados al final de toda la lista: nunca salen en la app si hay algo mejor
    clips[:] = ([c for c in cands if not c["ia_descartar"]] + clips[len(cands):]
                + [c for c in cands if c["ia_descartar"]])
    print(f"🧠 Departamento viral: {len(judged)} clips valorados, "
          f"{sum(c['ia_descartar'] for c in judged)} descartados.")
    return True
