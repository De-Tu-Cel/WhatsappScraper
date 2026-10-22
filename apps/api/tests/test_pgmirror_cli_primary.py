"""An old Mongo-first repair must never overwrite a Postgres primary collection."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize("arguments", [
    ["reconcile", "instances", "--fix"],
    ["reconcile", "aaa,instances", "--fix"],
    ["reconcile", "--all", "--fix"],
    ["reconcile", "fs.files", "--fix"],
])
def test_primary_repair_is_rejected_before_any_collection_is_written(monkeypatch, arguments):
    spec = importlib.util.spec_from_file_location(
        "pg_mirror_primary_cli", Path(__file__).resolve().parents[1] / "scripts" / "pg_mirror.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    raw, store, repair = Mock(), Mock(), Mock()
    raw.list_collection_names.return_value = ["aaa", "instances", "fs.files"]
    monkeypatch.setenv("POSTGRES_URL", "postgresql://unused/test")
    monkeypatch.setenv("DB_MODES", "aaa=postgres,instances=primary,archivos=primary")
    monkeypatch.setattr(cli, "_connect", lambda: (raw, store))
    monkeypatch.setattr(cli, "reconcile", repair)
    with pytest.raises(SystemExit, match="Postgres es la fuente de verdad"):
        cli.main(arguments)
    repair.assert_not_called()
    store.close.assert_called_once()
