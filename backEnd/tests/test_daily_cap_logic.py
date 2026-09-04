"""
Tests para check_contacted (database.py) y la lógica de newContactPoints.
Run: python -m pytest tests/test_daily_cap_logic.py -v
  or: python test_daily_cap_logic.py
"""
from datetime import datetime
from unittest.mock import MagicMock
import sys, os


# ── Implementación inline de check_contacted (copia exacta de database.py) ──
# Testeamos la lógica directamente en vez de importar MongoDBManager completo,
# para evitar que la conexión real a Mongo interfiera con los tests.

def _check_contacted(db, company_ids: list) -> dict:
    """Copia de MongoDBManager.check_contacted para tests aislados."""
    result = {}
    for cid in company_ids:
        first = db.message_logs.find_one(
            {"company_id": cid, "direction": "outbound"},
            sort=[("created_at", 1)],
            projection={"sent_by_name": 1, "sent_by_username": 1, "created_at": 1}
        )
        if first:
            contacted_nums = db.message_logs.distinct(
                "to_number",
                {"company_id": cid, "direction": "outbound"},
            )
            result[cid] = {
                "contacted": True,
                "by_name":     first.get("sent_by_name", ""),
                "by_username": first.get("sent_by_username", ""),
                "at":          first["created_at"].isoformat() if first.get("created_at") else None,
                "contacted_numbers": [n for n in contacted_nums if n],
            }
        else:
            result[cid] = {"contacted": False}
    return result


def _make_mock_db(find_one_result, distinct_result):
    mock_ml = MagicMock()
    mock_ml.find_one.return_value = find_one_result
    mock_ml.distinct.return_value = distinct_result
    mock_db = MagicMock()
    mock_db.message_logs = mock_ml
    return mock_db


# ── check_contacted — empresa NO contactada ─────────────────────────────────

def test_check_contacted_not_contacted():
    db = _make_mock_db(find_one_result=None, distinct_result=[])
    result = _check_contacted(db, ['cid_new'])
    assert result['cid_new']['contacted'] is False
    assert 'contacted_numbers' not in result['cid_new']
    print('✓ empresa no contactada → contacted=False, sin contacted_numbers')


# ── check_contacted — empresa SÍ contactada ─────────────────────────────────

def test_check_contacted_with_numbers():
    first = {
        'sent_by_name': 'Marco',
        'sent_by_username': 'marco',
        'created_at': datetime(2025, 6, 1, 10, 0, 0),
    }
    db = _make_mock_db(find_one_result=first, distinct_result=['+521234', '+525678', ''])
    result = _check_contacted(db, ['cid_known'])
    r = result['cid_known']
    assert r['contacted'] is True
    assert r['by_name'] == 'Marco'
    assert r['by_username'] == 'marco'
    assert r['at'] == '2025-06-01T10:00:00'
    assert '+521234' in r['contacted_numbers']
    assert '+525678' in r['contacted_numbers']
    assert '' not in r['contacted_numbers']   # vacíos filtrados
    print('✓ empresa contactada → contacted=True, contacted_numbers sin vacíos')


# ── check_contacted — múltiples empresas ────────────────────────────────────

def test_check_contacted_multiple():
    mock_ml = MagicMock()
    mock_ml.find_one.side_effect = [
        {'sent_by_name': 'Ana', 'sent_by_username': 'ana', 'created_at': datetime(2025, 1, 1)},
        None,
    ]
    mock_ml.distinct.return_value = ['+521111']
    mock_db = MagicMock()
    mock_db.message_logs = mock_ml

    result = _check_contacted(mock_db, ['cid_a', 'cid_b'])
    assert result['cid_a']['contacted'] is True
    assert '+521111' in result['cid_a']['contacted_numbers']
    assert result['cid_b']['contacted'] is False
    print('✓ múltiples empresas → cada una con su estado correcto')


# ── Lógica de newContactPoints (simulación del cálculo de los componentes) ──

def _compute_new_contact_points(wa_rows, effective_wa_selected, extra_selected):
    """Replica exacta del JS: calcula cuántos contactos de la selección son nuevos."""
    contacted_cids = {r['company_id'] for r in wa_rows if r.get('already_contacted', {}) and r['already_contacted'].get('contacted')}
    new_primary = sum(
        1 for r in wa_rows
        if r['company_id'] in effective_wa_selected and r['company_id'] not in contacted_cids
    )
    new_extra = sum(
        1 for key in extra_selected
        if (cid := key.split('::')[0]) in effective_wa_selected and cid not in contacted_cids
    )
    return new_primary + new_extra


def test_new_contact_points_all_new():
    wa_rows = [
        {'company_id': 'a', 'already_contacted': {'contacted': False}},
        {'company_id': 'b', 'already_contacted': None},
    ]
    result = _compute_new_contact_points(wa_rows, {'a', 'b'}, set())
    assert result == 2
    print('✓ todas nuevas → newContactPoints = 2')


def test_new_contact_points_mix():
    wa_rows = [
        {'company_id': 'a', 'already_contacted': {'contacted': True}},   # ya contactada
        {'company_id': 'b', 'already_contacted': {'contacted': False}},  # nueva
        {'company_id': 'c', 'already_contacted': None},                   # nueva
    ]
    extra = {'b::+521111', 'a::+522222'}  # b→nuevo, a→ya contactada
    result = _compute_new_contact_points(wa_rows, {'a', 'b', 'c'}, extra)
    # primarios nuevos: b, c (a está contactada) = 2
    # extras nuevos: b::+521111 (b no contactada) = 1; a::+522222 (a contactada) = 0
    assert result == 3
    print('✓ mix nuevo/recontacto → newContactPoints = 3')


def test_new_contact_points_all_contacted():
    wa_rows = [
        {'company_id': 'a', 'already_contacted': {'contacted': True}},
        {'company_id': 'b', 'already_contacted': {'contacted': True}},
    ]
    result = _compute_new_contact_points(wa_rows, {'a', 'b'}, set())
    assert result == 0
    print('✓ todas ya contactadas → newContactPoints = 0')


def test_new_contact_points_unselected_ignored():
    wa_rows = [
        {'company_id': 'a', 'already_contacted': {'contacted': False}},
        {'company_id': 'b', 'already_contacted': {'contacted': False}},
    ]
    result = _compute_new_contact_points(wa_rows, {'a'}, set())  # b no seleccionada
    assert result == 1
    print('✓ empresa no seleccionada no cuenta en newContactPoints')


# ── Runner manual ────────────────────────────────────────────────────────────

if __name__ == '__main__':
    tests = [
        test_check_contacted_not_contacted,
        test_check_contacted_with_numbers,
        test_check_contacted_multiple,
        test_new_contact_points_all_new,
        test_new_contact_points_mix,
        test_new_contact_points_all_contacted,
        test_new_contact_points_unselected_ignored,
    ]
    passed = failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as e:
            print(f'✗ {t.__name__}: {e}')
            failed += 1
    print(f'\n{"─"*50}')
    print(f'{passed}/{passed + failed} passed')
    if failed:
        sys.exit(1)
