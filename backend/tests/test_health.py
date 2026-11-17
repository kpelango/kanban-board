import pytest
from fastapi.testclient import TestClient

from app.main import STATIC_DIR, app

client = TestClient(app)


def test_health_endpoint_returns_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "message": "Hello from FastAPI",
    }


# Only the Docker image bundles the frontend build; on Vercel the frontend is its own service
@pytest.mark.skipif(not STATIC_DIR.exists(), reason="no frontend build in backend/static")
def test_root_serves_static_html() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Kanban Studio" in response.text
