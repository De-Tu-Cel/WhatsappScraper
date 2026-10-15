from bs4 import BeautifulSoup
from app import searcher
from app.scraper import WebsiteScraper
from unittest.mock import MagicMock


def test_gas_services_preserve_city_and_do_not_include_petrol(monkeypatch):
    monkeypatch.setattr(searcher, '_ai_expand_synonyms', lambda *args: [])
    queries = searcher._build_variations('gaseras', 'Hermosillo', 'México', 20)
    assert 'gas lp a domicilio Hermosillo' in queries
    assert 'llenado de cilindros de gas Hermosillo' in queries
    assert all('Hermosillo' in query for query in queries)
    assert searcher._service_search_terms('gasolineras', 'México') == []
    assert searcher._service_search_terms('gaseras', 'Colombia') == []


def test_branch_hub_only_follows_unvisited_local_internal_pages():
    sc = WebsiteScraper.__new__(WebsiteScraper)
    soup = BeautifulSoup('''<a href="/sucursales/hermosillo-centro">Hermosillo Centro</a>
        <a href="/sucursales/hermosillo-norte">Hermosillo Norte</a>
        <a href="/sucursales/tijuana">Tijuana</a>
        <a href="https://other.example/hermosillo">Hermosillo</a>''', 'html.parser')
    hub = 'https://gas.example/sucursales'
    data = {'source_url': hub, 'internal_links': sc._find_all_internal_links(soup, hub, 'gas.example')}
    assert sc._branch_followup_urls(data, {hub}, 'gas.example', 'Hermosillo') == [
        'https://gas.example/sucursales/hermosillo-centro', 'https://gas.example/sucursales/hermosillo-norte']
    assert sc._branch_followup_urls(data, {hub}, 'gas.example', None) == []
    assert not sc._branch_page_matches_city({'city': 'Tijuana', 'headings': 'Sucursal Tijuana'}, 'Hermosillo')
    assert sc._branch_page_matches_city({'headings': 'Sucursal Hermosillo Centro'}, 'Hermosillo')


def test_second_level_branch_recovers_distinct_labelled_numbers(monkeypatch):
    sc = WebsiteScraper.__new__(WebsiteScraper)
    pages = {'https://gas.example/sucursales/hermosillo-centro': '''<h1>Sucursal Hermosillo Centro</h1>
        <a href="tel:+526622341234">Llamar</a>''',
        'https://gas.example/sucursales/hermosillo-norte': '''<h1>Sucursal Hermosillo Norte</h1>
        <a href="tel:+526622341235">Llamar</a>'''}
    monkeypatch.setattr(sc, '_scrape_subpage', lambda url: (BeautifulSoup(pages[url], 'html.parser'), BeautifulSoup(pages[url], 'html.parser').get_text(' ', strip=True)))
    monkeypatch.setattr(sc, '_extract_address_structured', lambda *args: {})
    monkeypatch.setattr(sc, '_extract_business_hours', lambda *args: '')
    contacts = {'phone_contacts': []}
    for url in pages:
        data = sc._fetch_sub(url)
        assert sc._branch_page_matches_city(data, 'Hermosillo')
        sc._merge_phone_labels(contacts, data['phone_contacts'])
        sc._merge_phone_labels(contacts, data['phone_contacts'])
    assert len(contacts['phone_contacts']) == 2
    assert {item['label'] for item in contacts['phone_contacts']} == {'Sucursal Hermosillo Centro', 'Sucursal Hermosillo Norte'}


def test_phone_branch_label_is_preserved_when_saved():
    sc = WebsiteScraper.__new__(WebsiteScraper)
    sc.contacts_col = MagicMock()
    sc._save_contacts({
        'phone_numbers': ['+526622341234'],
        'phone_contacts': [{'number': '+526622341234', 'label': 'Sucursal Hermosillo Centro'}],
        'all_whatsapp_numbers': [], 'whatsapp_numbers': []}, '111111111111111111111111', 'https://gas.example', verify_phones=False)
    saved = sc.contacts_col.update_one.call_args.args[1]['$set']
    assert saved['label'] == 'Sucursal Hermosillo Centro'
