from datetime import datetime
from unittest.mock import MagicMock

import pytest
from bson import ObjectId
from bs4 import BeautifulSoup

from app.classifier import _response_quality_from_svc
from app.database import MongoDBManager
from app.scraper import WebsiteScraper


def test_brand_after_service_title_precedes_generic_site_name():
    scraper = WebsiteScraper(db=MagicMock())
    soup = BeautifulSoup('''<title>Accesorios para estufas - Gas Accesorios de Tijuana</title>
      <meta property="og:site_name" content="Accesorios para estufas">
      <h1>Accesorios para estufas en Tijuana</h1>''', 'html.parser')
    assert scraper._extract_company_name(soup, 'https://gasaccesoriosdetijuana.com.mx/') == 'Gas Accesorios de Tijuana'


def test_unrelated_title_part_is_not_assumed_to_be_brand():
    scraper = WebsiteScraper(db=MagicMock())
    soup = BeautifulSoup('<title>Accesorios - Otra empresa</title><meta property="og:site_name" content="Acme">', 'html.parser')
    assert scraper._extract_company_name(soup, 'https://acme.com/') == 'Acme'


def test_quality_uses_evaluated_service_dimensions_only():
    assert _response_quality_from_svc(dict.fromkeys(['svc_prof', 'svc_comp', 'svc_empa', 'svc_solu', 'svc_next', 'svc_proact'], 4)) == 4
    assert _response_quality_from_svc({'svc_prof': 4, 'svc_comp': None}) == 4
    assert _response_quality_from_svc({'svc_prof': None}) is None


@pytest.mark.parametrize('score,expected', [(None, None), (0, None), (4, 4), (float('nan'), None)])
def test_analytics_never_counts_unrated_company_as_zero(score, expected):
    manager = MongoDBManager.__new__(MongoDBManager)
    manager.db = MagicMock()
    cid = str(ObjectId())
    group = {'_id': cid, 'last_at': datetime(2026, 10, 19), 'category': 'humano',
             'is_ai': False, 'response_quality': score, 'total_responses': 1, 'notes': ''}
    calls = iter([[group]])
    manager.db.message_logs.aggregate.side_effect = lambda *a, **k: next(calls, [])
    manager.db.companies.find.return_value = [{'_id': ObjectId(cid), 'name': 'QA', 'domain': 'example.com'}]
    manager.db.message_logs.find.return_value = [{'company_id': cid, 'direction': 'outbound', 'to_number': '+524421234567', 'created_at': datetime(2026, 10, 18), 'status': 'sent'}]
    manager.db.contacts.find.return_value = []
    result = manager.get_analytics()
    assert result['items'][0]['response_quality'] == expected
    assert result['avg_quality'] == expected
