"""Give every compatibility-API pytest run its own disposable SQLite database."""
import os
import shutil
import tempfile
from pathlib import Path


_test_data_dir = Path(tempfile.mkdtemp(prefix="digital-time-capsule-compat-tests-"))
os.environ["PYTHON_DATABASE_PATH"] = str(_test_data_dir / "compat-tests.sqlite3")


def pytest_unconfigure(config):
    shutil.rmtree(_test_data_dir, ignore_errors=True)
