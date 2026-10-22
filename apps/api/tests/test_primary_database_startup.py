from unittest.mock import MagicMock

from app import database
from app.pgmirror import config


def test_fully_primary_client_does_not_require_mongo_to_open(monkeypatch):
    client = MagicMock()
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr(database, '_mongo_client', None)
    monkeypatch.setattr(database, 'MongoClient', constructor)
    monkeypatch.setattr(config, 'collection_mode', lambda name: 'primary')
    assert database._get_client() is client
    assert constructor.call_args.kwargs['connect'] is False
    assert constructor.call_args.kwargs['minPoolSize'] == 0
    client.admin.command.assert_not_called()
    client.__getitem__.assert_not_called()


def test_partial_migration_still_initializes_mongo_indexes(monkeypatch):
    client = MagicMock()
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr(database, '_mongo_client', None)
    monkeypatch.setattr(database, 'MongoClient', constructor)
    monkeypatch.setattr(config, 'collection_mode', lambda name: 'mongo' if name == 'contacts' else 'primary')
    assert database._get_client() is client
    assert constructor.call_args.kwargs['connect'] is True
    client.admin.command.assert_called_once_with('ping')
    client.__getitem__.return_value.contacts.create_index.assert_called()
