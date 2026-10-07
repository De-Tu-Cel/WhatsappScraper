"""La pareja que pinta Warmup tiene que ser la de hoy, y de los dos lados."""
from datetime import datetime, timedelta

import random

from app.warmup_queue import (
    _clean_warmup_text, _session_persona, _stable_int, resolve_display_partners,
)


class TestWarmupSoundsHuman:
    # Warmup (2026-10-06): los dos lados escribían igual, con "wey" y emoji en cada
    # mensaje, y copiaban los ejemplos del prompt.
    def test_each_side_is_a_different_person_and_it_is_stable(self):
        for sid in ("s1", "6a1f00", "otra-sesion"):
            a, b = _session_persona(sid, "a"), _session_persona(sid, "b")
            assert a[0] != b[0]
            assert _session_persona(sid, "a") == a

    def test_topic_seed_does_not_depend_on_the_process(self):
        assert _stable_int("abc", "topic") == _stable_int("abc", "topic")

    def test_wey_is_not_repeated_message_after_message(self):
        hist = [{"speaker": "a", "content": "oye wey ya viste lo nuevo"}]
        out = _clean_warmup_text("simon wey, suena bien", hist, "a", 0.0, True, random.Random(1))
        assert "wey" not in out

    def test_style_without_slang_drops_wey(self):
        out = _clean_warmup_text("no manches wey que buena", [], "a", 0.0, False, random.Random(1))
        assert out == "no manches que buena"

    def test_at_most_one_emoji_and_not_two_messages_in_a_row(self):
        hist = [{"speaker": "a", "content": "jaja si 😂"}]
        out = _clean_warmup_text("ya quiero ir 🔥😂🤘", hist, "a", 1.0, True, random.Random(1))
        assert out == "ya quiero ir"
        out = _clean_warmup_text("ya quiero ir 🔥😂🤘", [], "a", 1.0, True, random.Random(1))
        assert out == "ya quiero ir 🔥"

    def test_never_says_it_is_a_bot_but_can_talk_about_ai(self):
        assert _clean_warmup_text("jaja no soy un bot eh", [], "a", 0.0, True) == ""
        assert _clean_warmup_text("como IA no tengo gustos", [], "a", 0.0, True) == ""
        assert _clean_warmup_text("viste lo de la inteligencia artificial que dibuja", [], "a", 0.0, True)

    def test_repeating_a_recent_message_is_dropped(self):
        hist = [{"speaker": "b", "content": "jajaja neta"}]
        assert _clean_warmup_text("Jajaja, neta.", hist, "a", 0.0, True) == ""

    def test_strips_name_prefix_quotes_and_final_period(self):
        assert _clean_warmup_text('Luis: "ya llegue a la casa."', [], "a", 0.0, True) == "ya llegue a la casa"

    def test_quotes_inside_the_message_are_kept(self):
        out = _clean_warmup_text('"The Boys" es una locura', [], "a", 0.0, True, random.Random(3))
        assert out.lower().startswith('"the boys"')

    def test_paragraphs_are_cut_to_a_chat_message(self):
        long = ("¡Qué chido que ya tienes boletos! Estar en el estadio siempre es una experiencia única. "
                "Yo creo que el sábado voy a quedarme en casa. Espero que gane, ¡suerte!")
        out = _clean_warmup_text(long, [], "b", 0.0, True, random.Random(2))
        assert len(out) <= 110 and "¡" not in out and "experiencia única" not in out

    def test_assistant_filler_is_removed(self):
        out = _clean_warmup_text("Totalmente, el final fue lo mejor, sin duda", [], "a", 0.0, True, random.Random(5))
        assert out.lower() == "el final fue lo mejor"


def test_todays_rotation_wins_on_both_sides():
    # sender666 y gely-wa (2026-10-06): una sesión vieja dejaba a cada una
    # apuntando a alguien que ya tenía otra pareja, y el borde salía de un color solo.
    t0 = datetime(2026, 10, 6, 15, 0)
    sessions = [
        {"instance_a": "sender666", "instance_b": "tania-sesion-1",
         "messages": [{"ts": t0}]},
        {"instance_a": "gely-wa", "instance_b": "tania-sesion-4",
         "messages": [{"ts": t0}]},
        {"instance_a": "tania-sesion-1", "instance_b": "tania-sesion-3",
         "messages": [{"ts": t0 + timedelta(minutes=30)}]},
        {"instance_a": "marco-wa", "instance_b": "tania-sesion-4",
         "messages": [{"ts": t0 + timedelta(minutes=30)}]},
    ]
    expected = [
        ("sender666", "tania-sesion-1"),
        ("gely-wa", "tania-sesion-4"),
        ("marco-wa", "tania-sesion-3"),
    ]
    partners = resolve_display_partners(sessions, expected)
    assert partners["sender666"] == "tania-sesion-1"
    assert partners["tania-sesion-1"] == "sender666"
    assert partners["gely-wa"] == "tania-sesion-4"
    assert partners["tania-sesion-4"] == "gely-wa"
    assert partners["marco-wa"] == "tania-sesion-3"
    assert partners["tania-sesion-3"] == "marco-wa"


def test_without_a_rotation_the_newest_session_wins():
    t0 = datetime(2026, 10, 6, 15, 0)
    sessions = [
        {"instance_a": "a", "instance_b": "b", "messages": [{"ts": t0}]},
        {"instance_a": "a", "instance_b": "c", "messages": [{"ts": t0 + timedelta(hours=1)}]},
    ]
    partners = resolve_display_partners(sessions, [])
    assert partners["a"] == "c"
    assert partners["c"] == "a"
    assert partners["b"] == "a"
