"""Quality audit regressions: valid dental clinics and third-party profiles."""
import pytest

from app import llm, searcher


@pytest.fixture
def approve_all(monkeypatch):
    monkeypatch.setattr(searcher, 'OPENAI_API_KEY', 'test-key')
    monkeypatch.setattr(searcher, 'DEEPSEEK_API_KEY', '')
    monkeypatch.setattr(llm, 'call_llm', lambda *args, **kwargs: '[1,2,3,4,5,6]')


@pytest.mark.parametrize('industry', ['dentist', 'dentists'])
def test_approved_dental_clinics_survive_domain_checks(approve_all, industry):
    urls = [
        'https://www.bostondental.com/',
        'https://www.dentalpartnersofboston.com/',
        'https://www.dentalhealthandwellnessboston.com/',
        'https://acedentalboston.com/',
        'https://www.bostonsmile.com/',
        'https://www.drnoredds.com/',
    ]
    assert searcher._ai_filter_urls(urls, industry, country='United States') == urls


def test_dental_domain_is_still_unrelated_for_other_sectors(approve_all):
    urls = ['https://acedentalboston.com/', 'https://panaderiaeldorado.com/']
    assert searcher._ai_filter_urls(urls, 'panaderia', country='Colombia') == urls[1:]


@pytest.mark.parametrize('url', [
    'https://findglocal.com/CO/Bogota/123/Panaderia-Local',
    'https://www.findglocal.com/US/Boston/123/Dental-Clinic',
    'https://m.findglocal.com/BR/Curitiba/123/Padaria',
])
def test_findglocal_profiles_are_excluded_at_discovery(url):
    assert not searcher._is_business_url(url)


@pytest.mark.parametrize('answer', ['[1,2]', '[]', 'not-json'])
def test_findglocal_does_not_return_through_approval_rescue_or_fallback(monkeypatch, approve_all, answer):
    monkeypatch.setattr(llm, 'call_llm', lambda *args, **kwargs: answer)
    directory = 'https://www.findglocal.com/CO/Bogota/123/Panaderia-Local'
    own_site = 'https://panaderiaeldorado.com/'
    kept = searcher._ai_filter_urls([directory, own_site], 'panaderia', country='Colombia')
    assert directory not in kept
    assert own_site in kept


def test_findglocal_like_name_does_not_block_an_unrelated_own_domain(approve_all):
    url = 'https://findglocalbakery.com/'
    assert searcher._is_business_url(url)
    assert searcher._ai_filter_urls([url], 'panaderia', country='Colombia') == [url]
