"""测试隔离：不读取用户 .env，不访问外网。"""

from __future__ import annotations

import os

os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("GEMINI_API_KEY", None)

import pytest
from fastapi.testclient import TestClient

from app.api import create_app

TOKEN = "t" * 32


@pytest.fixture
def library(tmp_path):
    return tmp_path / "library"


@pytest.fixture
def client(library):
    app = create_app(library, TOKEN)
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as session:
        yield session
    # TestClient 退出时会触发 lifespan，关闭写锁
