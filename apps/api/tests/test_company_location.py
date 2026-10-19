from copy import deepcopy
import pytest
from app.company_location import resolve_company_location


@pytest.mark.parametrize('address,country,expected', [
    ('Calle 64 #56-60, Medellin, Antioquia', 'Colombia', 'Medell\u00edn'),
    ('Av. Calle 26 #59-15, Bogota, Colombia', 'CO', 'Bogot\u00e1'),
    ('39 rue des Martyrs, 75009 Paris', 'Francia', 'Par\u00eds'),
])
def test_table_can_resolve_city_from_saved_address_without_db_writes(address, country, expected):
    doc = {'city': '', 'address': address, 'country': country}
    before = deepcopy(doc)
    assert resolve_company_location(doc)['city'] == expected
    assert doc == before


def test_same_source_for_nested_location_and_detail():
    doc = {'city': '', '_extra': {'city': 'Monterrey', 'state': 'Nuevo Leon'}}
    assert resolve_company_location(doc)['city'] == 'Monterrey'


def test_phone_inferred_mexican_city_is_not_presented_as_foreign_business_location():
    doc = {'website': 'https://example.com.co/', 'location_source': 'lada',
           'city': 'Los Tepames', 'state': 'Colima', 'address': 'Calle 64, Medellin, Colombia'}
    resolved = resolve_company_location(doc)
    assert resolved['city'] == 'Medell\u00edn'
    assert not resolved['state']
    assert doc['city'] == 'Los Tepames'


def test_do_not_replace_verified_mexican_branch_of_foreign_domain():
    doc = {'website': 'https://example.co/', 'location_source': 'sitio', 'city': 'Monterrey'}
    assert resolve_company_location(doc)['city'] == 'Monterrey'


def test_do_not_choose_arbitrary_branch_from_multiple_cities():
    doc = {'country': 'Colombia', 'address': 'Oficinas en Medellin y Bogota'}
    assert not resolve_company_location(doc).get('city')


def test_scraper_matches_country_city_across_accents():
    from app.scraper import WebsiteScraper
    scraper = WebsiteScraper.__new__(WebsiteScraper)
    scraper._target_country_hint = 'Francia'
    assert scraper._extract_city('Nos boutiques a Paris, France') == 'Par\u00eds'
