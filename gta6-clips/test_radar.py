"""Pruebas sin red del radar viral: análisis de tendencias, objetivos de Twitch y
uso de las tendencias en los títulos del clipper."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import clipper
import radar_viral as rv

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def short(title, vph, hours_ago=5, dur=30, desc=""):
    pub = NOW - timedelta(hours=hours_ago)
    return {"id": title[:5], "url": "u", "title": title, "channel": "c", "description": desc, "tags": [],
            "published": pub.strftime("%Y-%m-%dT%H:%M:%SZ"), "age_h": hours_ago, "duration_s": dur,
            "views": vph * hours_ago, "views_per_hour": vph, "engagement": 0.05}


class RadarTest(unittest.TestCase):
    def test_analyze_ranks_fast_growing_words(self):
        shorts = [short("Police chase madness GTA 6 #vicecity", 90000),
                  short("Police chase in Leonida GTA 6", 80000),
                  short("Boring menu GTA 6", 50)] + [short(f"random {i}", 10) for i in range(30)]
        t = rv.analyze(shorts)
        self.assertIn("police", t["palabras"][:3])
        self.assertIn("police chase", t["frases"])
        self.assertIn("#vicecity", t["hashtags"])

    def test_durations(self):
        self.assertEqual(rv.iso_duration_s("PT1M5S"), 65)
        self.assertEqual(rv.twitch_duration_s("3h2m1s"), 10921)

    def test_twitch_targets_only_finished_recent_gta_vods(self):
        cfg = {"campanas": [{"nombre": "x", "permiso": "https://whop.com/c",
                             "fuentes": ["https://www.twitch.tv/Streamer1"], "mencion": "@s1",
                             "hashtags_obligatorios": ["#s1"]},
                            {"nombre": "sin", "permiso": "", "fuentes": ["https://www.twitch.tv/nope"]}]}
        logins = rv.twitch_logins(cfg)
        self.assertEqual(list(logins), ["streamer1"])

        def fake(h, path, **p):
            if path == "users":
                return [{"id": "1", "login": "streamer1"}]
            if path == "streams":
                return []
            start = lambda h_ago: (NOW - timedelta(hours=h_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
            return [
                {"url": "https://twitch.tv/videos/new", "title": "GTA 6 día 2", "created_at": start(4), "duration": "3h0m0s", "view_count": 900},
                {"url": "https://twitch.tv/videos/old", "title": "GTA 6 día 1", "created_at": start(30), "duration": "3h0m0s", "view_count": 5000},
                {"url": "https://twitch.tv/videos/other", "title": "Just chatting", "created_at": start(4), "duration": "3h0m0s", "view_count": 50},
            ]
        with mock.patch.object(rv, "twitch_get", side_effect=fake):
            jobs = rv.twitch_targets({}, logins, 2.2, NOW)
        self.assertEqual([j["url"] for j in jobs], ["https://twitch.tv/videos/new"])
        self.assertEqual(jobs[0]["handle"], "@s1")
        self.assertEqual(jobs[0]["tags"], "#s1")

    def test_trends_feed_clip_titles_and_hashtags(self):
        clips = [clipper.Clip("s", i, 10, 0, 20, 2) for i in range(4)]
        trends = {"frases": ["police chase"], "palabras": ["leonida"], "hashtags": ["#physics", "#gta6"]}
        clipper.fill_metadata(clips, "", "@me", 1, trends)
        self.assertEqual(clips[0].title, "Police chase en GTA 6 🔥")
        self.assertIn("#physics", clips[0].hashtags)
        self.assertEqual(clips[0].hashtags.lower().count("#gta6"), 1)

    def test_main_without_keys_still_writes_report(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict("os.environ", {}, clear=True):
            rv.main(["--campanas", str(Path(d) / "no.json"), "--salida", d])
            self.assertEqual(json.loads((Path(d) / "objetivos.json").read_text()), [])
            self.assertIn("YT_API_KEY", (Path(d) / "RADAR.md").read_text())


if __name__ == "__main__":
    unittest.main()


class ExpandTest(unittest.TestCase):
    def test_long_stream_is_split_in_parallel_chunks(self):
        import boton
        jobs = boton.expand_jobs([{"url": "u", "titulo": "Dom", "clips": "10", "tramo": "", "dur": 6.5 * 3600}])
        self.assertEqual(len(jobs), 5)
        self.assertEqual(jobs[0]["tramo"], "0:00:00-1:30:00")
        self.assertEqual(jobs[-1]["tramo"], "6:00:00-6:30:00")
        self.assertNotIn("dur", jobs[0])

    def test_short_or_ranged_jobs_untouched(self):
        import boton
        self.assertEqual(boton.expand_jobs([{"url": "u", "tramo": "", "dur": 1200}])[0]["tramo"], "")
        self.assertEqual(boton.expand_jobs([{"url": "u", "tramo": "1:00:00-1:10:00"}])[0]["tramo"], "1:00:00-1:10:00")


class PublicarTest(unittest.TestCase):
    def test_ranks_reacting_clip_first_and_builds_page(self):
        import publicar
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d, "clips-gta6-0", "dom")
            folder.mkdir(parents=True)
            clips = []
            for i, score in ((1, 9.0), (2, 8.0)):
                Path(folder, f"clip_{i:02d}.mp4").write_bytes(b"x")
                clips.append({"file": f"clips/dom/clip_{i:02d}.mp4", "title": "GTA 6", "score": score,
                              "start": 0, "peak": 9, "hashtags": "#GTA6 #Shorts",
                              "description": "GTA 6\n\n🎥 Clip de @dasgasd3m\n", "notes": []})
            Path(folder, "clips.json").write_text(json.dumps(clips), encoding="utf-8")
            Path(folder, "clip_02.srt").write_text(
                "1\n00:00:08,000 --> 00:00:10,000\nNO WAY BRO WHAT\n\n", encoding="utf-8")
            out = Path(d, "out")
            ranked = publicar.collect(Path(d))
            self.assertEqual(Path(ranked[0]["mp4"]).name, "clip_02.mp4")  # reacciona → primero
            publicar.build(ranked, out, 5, datetime(2026, 11, 20, 10, 0, tzinfo=publicar.MADRID))
            names = sorted(p.name for p in out.glob("*.mp4"))
            self.assertTrue(names[0].startswith("01_dasgasd3m_"))
            notes = (out / "notas.md").read_text(encoding="utf-8")
            self.assertIn("NO WAY BRO WHAT", notes)
            self.assertIn("🎥 @dasgasd3m", notes)
            self.assertIn("vie 20/11 18:00", notes)  # Dom: horario EE. UU.
            self.assertIn("(Kick)", notes)  # textos en inglés
            cal = (out / "calendario.ics").read_text(encoding="utf-8")
            self.assertEqual(cal.count("BEGIN:VEVENT"), 1)  # un aviso diario
            self.assertIn("BEGIN:VALARM", cal)
            self.assertIn("DTSTART:20261120T110000Z", cal)  # 12:00 Madrid


class ViralIATest(unittest.TestCase):
    """El departamento viral reordena con la nota de la IA, descarta lo flojo y nunca
    rompe la publicación si falla."""

    def _fake(self, verdicts=None, error=None):
        from types import SimpleNamespace as NS
        calls = []

        def create(**kw):
            calls.append(kw)
            if error:
                raise error
            return NS(stop_reason="end_turn", content=[NS(type="text", text=json.dumps({"clips": verdicts}))])
        return NS(beta=NS(messages=NS(create=create))), calls

    def _clips(self):
        return [{"credit": "@a", "rank": 20.0, "score": 9, "transcript": "menu loading"},
                {"credit": "@b", "rank": 10.0, "score": 5, "transcript": "NO WAY BRO the car flew"},
                {"credit": "@c", "rank": 5.0, "score": 3, "transcript": ""}]

    def test_ai_reorders_discards_and_writes_titles(self):
        import viral_ia
        v = lambda i, s, d=False, sp=False, t="Car flies into space 💀": {
            "id": i, "puntuacion": s, "sin_contexto": True, "spoiler": sp, "descartar": d,
            "motivo": "m", "titulo_en": t, "titulo_es": "El coche sale volando"}
        client, calls = self._fake([v(0, 20, d=True), v(1, 95), v(2, 60, t="nigga moment")])
        clips = self._clips()
        self.assertTrue(viral_ia.judge(clips, {"frases": ["police chase"]}, client=client))
        self.assertEqual([c["credit"] for c in clips], ["@b", "@c", "@a"])  # flojo al final
        self.assertEqual(clips[0]["ia_titulo_en"], "Car flies into space 💀")
        self.assertEqual(clips[1]["ia_titulo_en"], "")  # insulto → sin título
        kw = calls[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["output_config"]["format"]["type"], "json_schema")
        import publicar
        self.assertTrue(publicar.captions_en(clips[0], "@b", 1)["TikTok"].startswith("Car flies"))
        self.assertIn("🧠 IA 95/100", publicar.why({**clips[0], "words": 0, "reactions": 0}))

    def test_without_key_or_on_error_nothing_changes(self):
        import viral_ia
        clips = self._clips()
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertFalse(viral_ia.judge(clips))
        client, _ = self._fake(error=RuntimeError("boom"))
        self.assertFalse(viral_ia.judge(clips, client=client))
        self.assertEqual([c["credit"] for c in clips], ["@a", "@b", "@c"])
        self.assertNotIn("ia_score", clips[0])


class ViralLocalTest(unittest.TestCase):
    def test_free_local_model_scores_each_clip(self):
        import viral_ia
        sent = []

        def post(payload, timeout):
            sent.append(payload)
            good = "flew" in payload["messages"][1]["content"]
            return {"message": {"content": json.dumps({
                "puntuacion": 90 if good else 30, "sin_contexto": good, "spoiler": False,
                "descartar": not good, "motivo": "m", "titulo_en": "Car flew 💀", "titulo_es": "Vuela"})}}
        clips = [{"credit": "@a", "rank": 20.0, "transcript": "menu"},
                 {"credit": "@b", "rank": 10.0, "transcript": "the car flew"}]
        with mock.patch.dict("os.environ", {"VIRAL_IA_LOCAL": "qwen2.5:3b"}, clear=True):
            self.assertTrue(viral_ia.judge(clips, post=post))
        self.assertEqual([c["credit"] for c in clips], ["@b", "@a"])
        self.assertEqual(len(sent), 2)
        self.assertEqual(sent[0]["model"], "qwen2.5:3b")
        self.assertNotIn("id", sent[0]["format"]["properties"])


class AvisosTest(unittest.TestCase):
    def test_push_once_per_slot_and_only_within_three_days(self):
        import avisos
        now = datetime.now(timezone.utc)
        mk = lambda h, r: {"rank": r, "cuando": (now + timedelta(hours=h)).isoformat(), "cuando_txt": "vie 20/11 18:00",
                           "hora_ny": "12:00", "campana_nombre": "Dom", "ia_puntuacion": 80}
        with tempfile.TemporaryDirectory() as d:
            cj = Path(d, "clips.json")
            cj.write_text(json.dumps({"clips": [mk(2, 1), mk(5, 2), mk(100, 3), mk(-1, 4)]}))
            st = Path(d, "avisos.json")
            sent = []
            fake = lambda topic, title, msg, delay=None, **kw: sent.append((title, delay))
            with mock.patch.dict("os.environ", {"NTFY_TOPIC": "t"}):
                avisos.main([str(cj), "--estado", str(st)], sender=fake)
                self.assertEqual(len(sent), 2)  # solo las 2 horas próximas (no >70 h ni pasadas)
                self.assertTrue(sent[0][0].startswith("📲 Sube AHORA el clip #1"))
                sent.clear()
                avisos.main([str(cj), "--estado", str(st)], sender=fake)
                self.assertEqual(len(sent), 0)  # al republicar no repite avisos
            with mock.patch.dict("os.environ", {}, clear=True):
                sent.clear()
                avisos.main([str(cj), "--estado", str(st)], sender=fake)
                self.assertEqual(sent, [])


class TelegramPlanTest(unittest.TestCase):
    def _clips(self):
        mk = lambda r, en: {"rank": r, "archivo": f"0{r}_x.mp4", "cuando": "2026-11-21T18:00:00+01:00",
                            "hora_ny": "12:00" if en else "", "tiktok": f"Title {r} 💀\n\n#GTA6",
                            "shorts": f"Title {r} 💀 #Shorts", "campana_url": "https://cr/c", "ia_puntuacion": 90 - r}
        return {"base": "videos/", "clips": [mk(i, True) for i in range(1, 7)]}

    def _run(self, st, now, calls, probe=None, updates=None):
        import telegram_avisos as ta
        clips = self._clips()

        def tg(token, method, fields, file=None):
            calls.append((method, fields, file))
            return updates or [] if method == "getUpdates" else {}
        fetch = lambda url: json.dumps(clips).encode() if url.endswith("clips.json") else b"MP4"
        with mock.patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "42"}):
            ta.main(["--estado", st], tg=tg, fetch=fetch, now=now, probe=probe or (lambda u: {}))

    def test_one_morning_plan_with_all_videos_then_silence(self):
        import telegram_avisos as ta
        with tempfile.TemporaryDirectory() as d:
            st = str(Path(d, "tg.json"))
            calls = []
            self._run(st, datetime(2026, 11, 21, 8, 0, tzinfo=ta.MADRID), calls)  # antes de las 9: nada
            self.assertEqual([m for m, _, _ in calls if m != "getUpdates"], [])
            self._run(st, datetime(2026, 11, 21, 9, 5, tzinfo=ta.MADRID), calls)
            videos = [f for m, f, _ in calls if m == "sendVideo"]
            self.assertEqual(len(videos), 4)  # 4 horas de EE. UU. de hoy (18:00, 21:00, 00:30, 02:30)
            self.assertIn("PROGRAMA para las 18:00", videos[0]["caption"])
            self.assertIn("00:30 de esta madrugada", videos[2]["caption"])
            calls.clear()
            self._run(st, datetime(2026, 11, 21, 15, 0, tzinfo=ta.MADRID), calls)  # resto del día: silencio
            self.assertEqual([m for m, _, _ in calls if m != "getUpdates"], [])

    def test_pasted_links_are_matched_by_text_and_listed_for_campaign(self):
        import telegram_avisos as ta
        with tempfile.TemporaryDirectory() as d:
            st = str(Path(d, "tg.json"))
            calls = []
            self._run(st, datetime(2026, 11, 21, 9, 5, tzinfo=ta.MADRID), calls)
            ups = [{"update_id": 5, "message": {"chat": {"id": 42}, "text":
                    "https://www.tiktok.com/@a/video/2 https://youtube.com/shorts/1"}}]
            probe = lambda u: {"title": "Title 2 💀"} if "video/2" in u else {"title": "Title 1 💀 #Shorts"}
            calls.clear()
            self._run(st, datetime(2026, 11, 22, 9, 5, tzinfo=ta.MADRID), calls, probe=probe, updates=ups)
            state = json.loads(Path(st).read_text())
            self.assertEqual(state["publicados"]["02_x.mp4"]["enlaces"], {"tiktok": "https://www.tiktok.com/@a/video/2"})
            self.assertEqual(state["publicados"]["01_x.mp4"]["enlaces"], {"shorts": "https://youtube.com/shorts/1"})
            reply = next(f["text"] for m, f, _ in calls if m == "sendMessage" and "Apuntados" in f.get("text", ""))
            self.assertIn("https://cr/c", reply)

    def test_quiet_hours(self):
        import telegram_avisos as ta
        self.assertTrue(ta.is_quiet(datetime(2026, 11, 22, 8, 15, tzinfo=ta.MADRID)))
        self.assertFalse(ta.is_quiet(datetime(2026, 11, 22, 8, 30, tzinfo=ta.MADRID)))


class ResultsTest(unittest.TestCase):
    def test_real_views_become_ai_context(self):
        import publicar
        with tempfile.TemporaryDirectory() as d:
            f = Path(d, "tg.json")
            f.write_text(json.dumps({"publicados": {
                "a": {"titulo": "Car flies 💀", "ia": 80, "vistas": {"tiktok": 5000, "shorts": 100}},
                "b": {"titulo": "Menu", "ia": 40, "vistas": {"tiktok": 90}},
                "c": {"titulo": "Sin enlaces"}}}))
            r = publicar.load_results(f)
        self.assertEqual([x["vistas"] for x in r], [5100, 90])
