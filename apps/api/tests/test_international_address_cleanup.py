import pytest
from app.scraper import WebsiteScraper


@pytest.mark.parametrize('label', ['Correo electrónico:', 'Correo:', 'Email:', 'E-mail:'])
def test_contact_email_label_is_not_part_of_a_colombian_address(label):
    scraper = WebsiteScraper.__new__(WebsiteScraper)
    address = 'Av. Calle 26 # 59-15, local 6, edificio Avianca, Bogotá'
    assert scraper._clean_extracted_address(address + ' ' + label + ' servicio@example.com') == address


def test_correo_mayor_street_name_is_preserved():
    scraper = WebsiteScraper.__new__(WebsiteScraper)
    assert scraper._clean_extracted_address('Correo Mayor 12, Centro') == 'Correo Mayor 12, Centro'
