from unittest.mock import MagicMock

import pytest
from bs4 import BeautifulSoup

from app.industry_evidence import industry_context, keyword_industry
from app.scraper import WebsiteScraper


@pytest.fixture
def scraper():
    result = WebsiteScraper(db=MagicMock())
    result._classify_industry_deepseek = MagicMock(return_value='')
    return result


@pytest.mark.parametrize('name,service,expected', [
    ('Claro Colombia', 'Telefonía móvil, planes postpago e internet de fibra óptica.', 'Telecomunicaciones'),
    ('Compañía de Gases del Pacífico', 'Producción y comercialización de gases industriales y medicinales.', 'Gases industriales / Medicinales'),
    ('Transestrella', 'Transporte terrestre de carga masiva y semi masiva.', 'Transporte / Logística'),
    ('Gaservicio', 'Distribución de gas LP para hogares y empresas.', 'Gas LP / Energía'),
    ('Surtigas', 'Distribución de gas natural.', 'Gas LP / Energía'),
    ('Frontiers', 'A research publisher of scientific journals.', 'Editorial / Publicaciones'),
    ('Clínica Veterinaria', 'Hospital veterinario para mascotas.', 'Veterinaria'),
])
def test_explicit_services_precede_generic_navigation(scraper, name, service, expected):
    html = '<nav>' + 'Tienda eventos accesorios teléfono legal ' * 100 + '</nav>'
    html += f'<main><h1>{name}</h1><p>{service}</p></main>'
    html += '<footer>Servicios asesoría productos</footer>'
    soup = BeautifulSoup(html, 'html.parser')
    assert scraper._detect_industry(soup.get_text(' ', strip=True), soup, company_name=name) == expected
    assert soup.nav is not None  # Extracting evidence must not mutate contact HTML.


def test_no_sector_inferred_from_contact_details(scraper):
    soup = BeautifulSoup('<main>Contacto teléfono accesorios</main>', 'html.parser')
    assert scraper._detect_industry(soup.get_text(' '), soup, company_name='Gaservicio') == 'No detectada'


def test_content_after_large_menu_is_present_in_llm_context(scraper):
    soup = BeautifulSoup('<nav>' + 'Inicio ' * 500 + '</nav><main><h1>Acme</h1><p>Reparación de equipos especializados.</p></main>', 'html.parser')
    scraper._detect_industry(soup.get_text(' '), soup, company_name='Acme')
    context = scraper._classify_industry_deepseek.call_args.args[0]
    assert 'Reparación de equipos especializados' in context
    assert 'Inicio' not in context
    assert len(context) <= 6500


def test_structured_description_and_maps_category_are_evidence():
    soup = BeautifulSoup('<meta name="description" content="Transporte terrestre"><main>Acme</main>', 'html.parser')
    context = industry_context('', soup, 'Acme', 'Transportadora')
    assert 'Transporte terrestre' in context and 'Transportadora' in context


def test_weak_conflicting_terms_abstain():
    assert keyword_industry('Tienda teléfono legal contacto eventos', {
        'Retail General': ['tienda'], 'Electrónica': ['teléfono'], 'Legal': ['legal']
    }) == 'No detectada'


def test_keyword_repetition_does_not_change_result():
    categories = {'Transporte': ['transporte', 'carga'], 'Tienda': ['compra']}
    assert keyword_industry('transporte carga ' + 'compra ' * 100, categories) == 'Transporte'


def test_html_only_navigation_does_not_fall_back_to_unfiltered_text(scraper):
    soup = BeautifulSoup('<nav>Telecomunicaciones telefonía móvil</nav><main>Bienvenido</main>', 'html.parser')
    assert scraper._detect_industry(soup.get_text(' '), soup, company_name='Acme') == 'No detectada'


def test_english_service_evidence(scraper):
    soup = BeautifulSoup('<main><h1>Medical gases</h1><p>Medical oxygen supply.</p></main>', 'html.parser')
    assert scraper._detect_industry(soup.get_text(' '), soup) == 'Gases industriales / Medicinales'
