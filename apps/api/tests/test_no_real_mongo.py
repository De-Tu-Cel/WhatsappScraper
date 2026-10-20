"""Garantía de conftest.py: ningún test abre una conexión real a Mongo.

La única Mongo real es producción y apps/api/.env apunta a ella. Si alguien
quita o rompe el reemplazo de MongoClient en conftest.py, esto falla antes de
que otro test llegue a leer o escribir datos reales."""
import mongomock

from app import config


def test_backend_client_is_in_memory_even_with_the_production_uri_loaded():
    from app import database
    database._mongo_client = None  # fuerza a construirlo dentro de esta prueba
    client = database._get_client()
    assert isinstance(client, mongomock.MongoClient), config.MONGODB_URI.split("@")[-1]


def test_scraper_without_db_uses_the_shared_in_memory_connection():
    from app.scraper import WebsiteScraper
    scraper = WebsiteScraper()
    assert isinstance(scraper.companies_col.database.client, mongomock.MongoClient)
    assert scraper.companies_col.database.name == config.DATABASE_NAME


def test_any_direct_client_is_in_memory():
    import pymongo
    assert isinstance(pymongo.MongoClient("mongodb://user:secret@localhost:27018/?authSource=admin"), mongomock.MongoClient)
