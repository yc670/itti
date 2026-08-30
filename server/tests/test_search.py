"""
Tests for GET /api/reports/search (server/models/report.py's
search_published_reports, backing the sitewide search feature).
"""
import io

from conftest import make_verified_user


def test_blank_query_returns_empty_list(client):
    r = client.get("/api/reports/search?q=")
    assert r.status_code == 200
    assert r.get_json() == []


def test_missing_query_param_returns_empty_list(client):
    r = client.get("/api/reports/search")
    assert r.status_code == 200
    assert r.get_json() == []


def test_finds_a_published_report_by_title(client, csrf_headers, unique_email):
    pub_email = unique_email
    adm_email = f"admin-{unique_email}"
    make_verified_user(pub_email, role="publisher")
    make_verified_user(adm_email, role="admin")

    client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
    r = client.post(
        "/api/reports",
        data={
            "title": "Unique Searchable Title Xyzzy123",
            "description": "some description",
            "category": "Research Publication",
            "file": (io.BytesIO(b"%PDF-1.4 fake"), "t.pdf"),
        },
        content_type="multipart/form-data",
        headers=csrf_headers,
    )
    report_id = r.get_json()["id"]
    client.post("/api/auth/logout", headers=csrf_headers)

    client.post("/api/auth/login", json={"email": adm_email, "password": "password123"}, headers=csrf_headers)
    client.post(f"/api/reports/{report_id}/review", json={"decision": "approve"}, headers=csrf_headers)
    client.post("/api/auth/logout", headers=csrf_headers)

    r = client.get("/api/reports/search?q=Xyzzy123")
    assert r.status_code == 200
    titles = [item["title"] for item in r.get_json()]
    assert "Unique Searchable Title Xyzzy123" in titles


def test_does_not_find_an_unpublished_report(client, csrf_headers, unique_email):
    pub_email = unique_email
    make_verified_user(pub_email, role="publisher")

    client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
    client.post(
        "/api/reports",
        data={
            "title": "Never Published Xyzzy456",
            "description": "some description",
            "category": "Research Publication",
            "file": (io.BytesIO(b"%PDF-1.4 fake"), "t.pdf"),
        },
        content_type="multipart/form-data",
        headers=csrf_headers,
    )

    client.post("/api/auth/logout", headers=csrf_headers)
    r = client.get("/api/reports/search?q=Xyzzy456")
    assert r.status_code == 200
    assert r.get_json() == []
