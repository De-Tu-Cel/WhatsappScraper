from datetime import datetime, timedelta

from app.database import collapse_echoed_messages


def _msg(direction, body, seconds, mid=None):
    return {
        "direction": direction,
        "message_body": body,
        "created_at": datetime(2026, 10, 8, 17, 9, 0) + timedelta(seconds=seconds),
        "message_id": mid,
    }


def test_supergas_double_hola_disappears_from_the_thread():
    rows = collapse_echoed_messages([
        _msg("outbound", "Hola", 0),
        _msg("inbound", "Hola", 2571),
        _msg("inbound", "Hola", 2571.002),
        _msg("outbound", "oye qué tal", 2580),
        _msg("inbound", "Disculpa estas equivocado", 2763),
        _msg("inbound", "Disculpa estas equivocado", 2763.002),
    ])
    bodies = [(r["direction"], r["message_body"]) for r in rows]
    assert bodies == [
        ("outbound", "Hola"),
        ("inbound", "Hola"),
        ("outbound", "oye qué tal"),
        ("inbound", "Disculpa estas equivocado"),
    ]


def test_two_real_holas_a_minute_apart_stay():
    rows = collapse_echoed_messages([
        _msg("inbound", "Hola", 0),
        _msg("inbound", "Hola", 60),
    ])
    assert len(rows) == 2


def test_mx_sync_and_webhook_aliases_collapse_even_when_messages_are_interleaved():
    first = {**_msg('inbound', 'Bienvenido', 0, 'welcome'), 'from_number': '+527222720404'}
    second = {**_msg('inbound', 'Horario de atención', 0, 'hours'), 'from_number': '+527222720404'}
    echoes = [{**_msg('inbound', body, 0.9 + i * 0.1), 'from_number': '5217222720404'}
              for i, body in enumerate(('Horario de atención', 'Bienvenido'))]
    assert collapse_echoed_messages([first, second, *echoes]) == [first, second]


def test_country_codes_and_receiving_sessions_are_never_merged():
    base = _msg('inbound', 'Hola', 0)
    assert len(collapse_echoed_messages([{**base, 'from_number': '+523112000000'},
                                        {**base, 'from_number': '+573112000000'}])) == 2
    assert len(collapse_echoed_messages([{**base, 'from_number': '+527222720404', 'received_on_instance': 'one'},
                                        {**base, 'from_number': '5217222720404', 'received_on_instance': 'two'}])) == 2


def test_two_distinct_whatsapp_ids_survive_after_a_missing_id_copy():
    rows = [_msg('inbound', 'Hola', 0), _msg('inbound', 'Hola', 0.1, 'one'),
            _msg('inbound', 'Hola', 0.2, 'two')]
    result = collapse_echoed_messages(rows)
    assert len(result) == 2
    assert [r['message_id'] for r in result] == ['one', 'two']
    assert rows[0]['message_id'] is None


def test_generic_media_or_distinct_attachments_are_not_hidden():
    assert len(collapse_echoed_messages([_msg('inbound', '[media]', 0), _msg('inbound', '[media]', 0.1)])) == 2
    assert len(collapse_echoed_messages([{**_msg('inbound', 'Foto', 0), 'media_url': 'a.jpg'},
                                        {**_msg('inbound', 'Foto', 0.1), 'media_url': 'b.jpg'}])) == 2
