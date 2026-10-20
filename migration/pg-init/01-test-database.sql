-- Solo corre la primera vez que se crea el volumen de Postgres local.
-- pgmirror_test: base desechable de tests/test_pgmirror*.py; "commercial" queda
-- libre para el ensayo de carga con la copia real de staging.
CREATE DATABASE pgmirror_test;
