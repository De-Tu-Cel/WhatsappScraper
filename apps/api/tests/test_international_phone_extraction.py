"""International phones must not become Mexican numbers or addresses."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from bs4 import BeautifulSoup

from app.international_phone import normalize_extracted_phone, site_country
from app.scraper import WebsiteScraper


@pytest.mark.parametrize('raw,code,expected', [
    ('+57 312 288 2088', '+52', '+573122882088'),
    ('573122882088', '+52', '+573122882088'),
    ('0057 312 288 2088', '+52', '+573122882088'),
    ('312 288 2088', '+57', '+573122882088'),
    ('601 744 3466', '+57', '+576017443466'),
    ('+44 20 7946 0958', '+52', '+442079460958'),
    ('020 7946 0958', '+44', '+442079460958'),
    ('01 42 34 56 78', '+33', '+33142345678'),
    ('+34 911 234 567', '+52', '+34911234567'),
    ('+39 06 6982', '+52', '+39066982'),
    ('+55 11 3234 5678', '+52', '+551132345678'),
    ('+52 1 81 2038 6801', '+57', '+528120386801'),
    ('044 442 208 7967', '+52', '+524422087967'),
    ('tel:+573122882088;ext=123', '+52', '+573122882088'),
    ('%2B573122882088', '+52', '+573122882088'),
])
def test_full_prefix_and_country_trunk_are_preserved(raw, code, expected):
    assert normalize_extracted_phone(raw, code) == expected


@pytest.mark.parametrize('url,explicit,expected', [
    ('https://example.com.co/contacto', None, 'Colombia'),
    ('https://example.co/', None, 'Colombia'),
    ('https://example.com.mx/', None, 'M\u00e9xico'),
    ('https://example.co.uk/', None, 'Reino Unido'),
    ('https://example.com/', 'Colombia', 'Colombia'),
    ('https://example.com.co/', 'Mexico', 'M\u00e9xico'),
    ('https://example.com.co.evil.com/', None, None),
])
def test_explicit_search_country_precedes_cc_domain(url, explicit, expected):
    assert site_country(url, explicit) == expected


def scraper(code='+52', country=None):
    result = WebsiteScraper.__new__(WebsiteScraper)
    result._default_country_code = code
    result._default_local_digits = 10
    result._target_country_hint = country
    result._target_state_raw = ''
    return result


@pytest.mark.parametrize('raw,expected', [
    ('+57 312 288 2088', '+573122882088'),
    ('+33 1 42 34 56 78', '+33142345678'),
    ('+44 20 7946 0958', '+442079460958'),
])
def test_foreign_text_does_not_also_create_a_local_mexican_number(raw, expected):
    s = scraper()
    text = 'Contacto: ' + raw
    assert s._extract_phone_numbers(BeautifulSoup(text, 'html.parser'), text) == [expected]
    assert s._extract_from_scripts(BeautifulSoup(f'<script>const phone="{raw}";</script>', 'html.parser')) == ([expected], [])


def test_foreign_site_is_not_located_in_mexico_from_a_mexican_contact():
    result = {'country': 'Colombia', '_contacts_raw': {'phone_numbers': ['+523122882088']}}
    scraper(country='Colombia')._finalize_location(result)
    assert not result.get('city') and not result.get('state')


def test_foreign_state_abbreviations_are_not_expanded_as_mexican_states():
    result = {'country': 'Colombia', 'state': 'Col', 'city': 'Example'}
    scraper(country='Colombia')._finalize_location(result)
    assert result['state'] == 'Col'


def test_unknown_country_does_not_authorize_local_mexican_fallback():
    assert normalize_extracted_phone('3122882088', None) is None
    assert normalize_extracted_phone('+573122882088', None) == '+573122882088'


def test_job_persists_search_country_before_another_user_consumes_the_idea():
    from app.scrape_jobs import create_scrape_job
    db = MagicMock()
    db.db.search_ideas.find.return_value = [{'url': 'https://example.com', 'target_country': 'Colombia'}]
    db.db.scrape_jobs.insert_one.return_value.inserted_id = 'dummy'
    with patch('app.scrape_jobs._claim_and_dispatch'):
        doc = create_scrape_job(db, 'search', ['https://example.com'], {'username': 'alice'})
    assert doc['url_countries'] == [{'url': 'https://example.com', 'country': 'Colombia'}]
