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
