import re
from pathlib import Path
from string import Formatter

import pytest
from datawalk_hub import i18n
from datawalk_hub.app import create_app
from datawalk_hub.config import Config
from fastapi.testclient import TestClient

EN, DE = i18n.CATALOGS["en"], i18n.CATALOGS["de"]
PACKAGE = Path(i18n.__file__).parent


def placeholders(text: str) -> set[str]:
    return {f"{name}!{conv}" for _, name, _, conv in Formatter().parse(text) if name is not None}


def test_catalogs_match():
    assert set(DE) == set(EN)
    for key in EN:
        assert placeholders(DE[key]) == placeholders(EN[key]), key


def test_every_key_in_use_exists():
    sources = [*PACKAGE.glob("templates/*.html"), PACKAGE / "app.py", PACKAGE / "auth.py"]
    used = {
        k
        for f in sources
        for k in re.findall(r"\btr?\((?:request, )?[\"']([\w.]+)[\"']", f.read_text())
    }
    assert len(used) > 100
    for key in used:  # "role." ~ name: a prefix
        assert key in EN or (key.endswith(".") and any(k.startswith(key) for k in EN)), key


def test_t_formats_and_falls_back():
    assert i18n.t("report.your_role", role="owner") == "Your role: owner"
    assert i18n.t("report.your_role", "de", role="x") == "Ihre Rolle: x"
    assert i18n.t("login.sign_in", "fr") == "Sign in"


@pytest.fixture
def anon(tmp_path):
    cfg = Config(
        data_dir=tmp_path,
        base_url="http://hub.test",
        secret_key="s" * 32,
        encryption_key=b"k" * 32,
        secure_cookies=False,
    )
    return TestClient(create_app(cfg), base_url="http://hub.test")


def test_language_choice(anon):
    page = anon.get("/login")
    assert (
        '<html lang="en">' in page.text
        and "Password" in page.text
        and i18n.COOKIE not in page.cookies
    )
    page = anon.get("/login?lang=de")
    assert '<html lang="de">' in page.text and "Passwort" in page.text
    assert page.cookies[i18n.COOKIE] == "de"
    assert "Passwort" in anon.get("/login").text  # the cookie remembers
    fresh = TestClient(anon.app, base_url="http://hub.test")
    assert (
        "Passwort"
        in fresh.get("/login", headers={"Accept-Language": "de-DE,de;q=0.9,en;q=0.8"}).text
    )
    assert "Password" in fresh.get("/login", headers={"Accept-Language": "fr, en;q=0.5"}).text
    assert fresh.get("/login?lang=xx").cookies.get(i18n.COOKIE) is None
    assert fresh.get("/account?lang=de").json() == {"detail": "Melden Sie sich zuerst an."}
