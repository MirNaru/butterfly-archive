from app.database import connect_database


def test_sqlite_persists_test_data(tmp_path):
    target = tmp_path / "nested" / "test.sqlite3"
    with connect_database(target) as connection:
        connection.execute("CREATE TABLE connection_test (value TEXT NOT NULL)")
        connection.execute("INSERT INTO connection_test VALUES (?)", ("test",))
    with connect_database(target) as connection:
        assert connection.execute("SELECT value FROM connection_test").fetchone() == ("test",)
