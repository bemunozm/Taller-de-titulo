import os
import time

from lpr.utils.retention import purge_old_files


def _touch(path, age_seconds=0, size=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'wb') as f:
        f.write(b'x' * size)
    if age_seconds:
        old = time.time() - age_seconds
        os.utime(path, (old, old))


def test_purge_old_files_by_age(tmp_path):
    old_file = tmp_path / 'old.jpg'
    new_file = tmp_path / 'new.jpg'
    _touch(old_file, age_seconds=10 * 86400)  # 10 días
    _touch(new_file, age_seconds=1 * 86400)   # 1 día

    result = purge_old_files(str(tmp_path), retention_days=7, max_mb=0)

    assert result['deleted'] == 1
    assert not old_file.exists()
    assert new_file.exists()


def test_purge_disabled_when_retention_days_zero(tmp_path):
    old_file = tmp_path / 'ancient.jpg'
    _touch(old_file, age_seconds=365 * 86400)

    result = purge_old_files(str(tmp_path), retention_days=0, max_mb=0)

    assert result['deleted'] == 0
    assert old_file.exists()


def test_purge_by_max_mb_deletes_oldest_first(tmp_path):
    # 3 archivos de 1MB c/u, presupuesto de 2MB -> debe borrar el más viejo
    oldest = tmp_path / 'a.jpg'
    middle = tmp_path / 'b.jpg'
    newest = tmp_path / 'c.jpg'
    one_mb = 1024 * 1024
    _touch(oldest, age_seconds=300, size=one_mb)
    _touch(middle, age_seconds=200, size=one_mb)
    _touch(newest, age_seconds=100, size=one_mb)

    result = purge_old_files(str(tmp_path), retention_days=0, max_mb=2)

    assert result['deleted'] == 1
    assert not oldest.exists()
    assert middle.exists()
    assert newest.exists()


def test_purge_missing_directory_is_noop():
    result = purge_old_files('/path/that/does/not/exist', retention_days=7, max_mb=100)
    assert result == {'deleted': 0, 'freed_bytes': 0}


def test_purge_empty_directory_argument_is_noop(tmp_path):
    result = purge_old_files('', retention_days=7, max_mb=100)
    assert result == {'deleted': 0, 'freed_bytes': 0}


def test_purge_recurses_into_subdirectories(tmp_path):
    nested = tmp_path / 'crops' / 'cam1'
    old_file = nested / 'old.jpg'
    _touch(old_file, age_seconds=10 * 86400)

    result = purge_old_files(str(tmp_path), retention_days=7, max_mb=0)

    assert result['deleted'] == 1
    assert not old_file.exists()
