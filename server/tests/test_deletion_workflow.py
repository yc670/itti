"""
Tests for the reviewer role and report deletion workflow: a publisher's
own PUBLISHED report requires a reviewer/admin's approval to delete
(server/models/report.py's request_report_deletion/cancel_deletion_
request, server/models/report_review.py's record_deletion_review, and
their routes in app.py). Admin's own instant delete bypasses all of
this, tested separately at the bottom.
"""
import io

from conftest import make_verified_user


def _upload_and_publish(client, csrf_headers, publisher_email, admin_email, title="Test Report"):
    """
    Shared setup most tests in this file need: a publisher uploads a
    report, an admin approves it, so the test can start from "a
    published report exists" rather than repeating this every time.
    """
    client.post("/api/auth/login", json={"email": publisher_email, "password": "password123"}, headers=csrf_headers)
    r = client.post(
        "/api/reports",
        data={
            "title": title,
            "description": "A" * 50,
            "category": "Research Publication",
            "file": (io.BytesIO(b"%PDF-1.4 fake"), "t.pdf"),
        },
        content_type="multipart/form-data",
        headers=csrf_headers,
    )
    report_id = r.get_json()["id"]
    client.post("/api/auth/logout", headers=csrf_headers)

    client.post("/api/auth/login", json={"email": admin_email, "password": "password123"}, headers=csrf_headers)
    client.post(f"/api/reports/{report_id}/review", json={"decision": "approve"}, headers=csrf_headers)
    client.post("/api/auth/logout", headers=csrf_headers)

    return report_id


class TestDeletionRequest:
    def test_publisher_cannot_instant_delete_a_published_report(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")

        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        r = client.delete(f"/api/reports/{report_id}", headers=csrf_headers)
        assert r.status_code == 409

    def test_deletion_request_requires_a_reason(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        r = client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": ""}, headers=csrf_headers)
        assert r.status_code == 400

    def test_report_stays_public_while_deletion_is_pending(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        r = client.post(
            f"/api/reports/{report_id}/request-deletion", json={"reason": "test reason"}, headers=csrf_headers
        )
        assert r.status_code == 200
        assert r.get_json()["review_status"] == "deletion_requested"
        client.post("/api/auth/logout", headers=csrf_headers)

        # Deliberately checked as a logged-out guest - this is the whole
        # point of REVIEW_STATUS_DELETION_REQUESTED staying visible.
        r = client.get(f"/api/reports/{report_id}")
        assert r.status_code == 200
        assert r.get_json()["review_status"] == "deletion_requested"


class TestDeletionReview:
    def test_reviewer_sees_pending_request_in_queue(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        rev_email = f"reviewer-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        make_verified_user(rev_email, role="reviewer")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": "x"}, headers=csrf_headers)
        client.post("/api/auth/logout", headers=csrf_headers)

        client.post("/api/auth/login", json={"email": rev_email, "password": "password123"}, headers=csrf_headers)
        r = client.get("/api/reports/deletion-requests")
        assert r.status_code == 200
        assert any(item["id"] == report_id for item in r.get_json())

    def test_reviewer_approval_soft_deletes_and_records_provenance(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        rev_email = f"reviewer-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        make_verified_user(rev_email, role="reviewer")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": "x"}, headers=csrf_headers)
        client.post("/api/auth/logout", headers=csrf_headers)

        client.post("/api/auth/login", json={"email": rev_email, "password": "password123"}, headers=csrf_headers)
        r = client.post(f"/api/reports/{report_id}/deletion-review", json={"decision": "approve"}, headers=csrf_headers)
        assert r.status_code == 200
        assert r.get_json()["deleted_via"] == "deletion_review"

        # Gone from public view now
        r = client.get(f"/api/reports/{report_id}")
        assert r.status_code == 404

    def test_reviewer_denial_keeps_report_published(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        rev_email = f"reviewer-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        make_verified_user(rev_email, role="reviewer")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": "x"}, headers=csrf_headers)
        client.post("/api/auth/logout", headers=csrf_headers)

        client.post("/api/auth/login", json={"email": rev_email, "password": "password123"}, headers=csrf_headers)
        r = client.post(f"/api/reports/{report_id}/deletion-review", json={"decision": "deny"}, headers=csrf_headers)
        assert r.status_code == 200
        assert r.get_json()["review_status"] == "published"

        r = client.get(f"/api/reports/{report_id}")
        assert r.status_code == 200

    def test_uploader_cannot_review_their_own_deletion_request(self, client, csrf_headers, unique_email):
        # The uploader themselves given reviewer role - still shouldn't
        # be able to decide their own request.
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="reviewer")
        make_verified_user(adm_email, role="admin")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": "x"}, headers=csrf_headers)

        r = client.post(f"/api/reports/{report_id}/deletion-review", json={"decision": "approve"}, headers=csrf_headers)
        assert r.status_code == 400

    def test_publisher_role_cannot_decide_deletion_requests(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        other_pub_email = f"other-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        make_verified_user(other_pub_email, role="publisher")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": pub_email, "password": "password123"}, headers=csrf_headers)
        client.post(f"/api/reports/{report_id}/request-deletion", json={"reason": "x"}, headers=csrf_headers)
        client.post("/api/auth/logout", headers=csrf_headers)

        client.post(
            "/api/auth/login", json={"email": other_pub_email, "password": "password123"}, headers=csrf_headers
        )
        r = client.post(f"/api/reports/{report_id}/deletion-review", json={"decision": "approve"}, headers=csrf_headers)
        assert r.status_code == 403


class TestAdminInstantDelete:
    def test_admin_deletes_published_report_instantly(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": adm_email, "password": "password123"}, headers=csrf_headers)
        r = client.delete(f"/api/reports/{report_id}", headers=csrf_headers)
        assert r.status_code == 200

        r = client.get("/api/reports/deleted")
        matching = [item for item in r.get_json() if item["id"] == report_id]
        assert len(matching) == 1
        assert matching[0]["deleted_via"] == "admin"

    def test_admin_can_repost_a_deleted_report(self, client, csrf_headers, unique_email):
        pub_email = unique_email
        adm_email = f"admin-{unique_email}"
        make_verified_user(pub_email, role="publisher")
        make_verified_user(adm_email, role="admin")
        report_id = _upload_and_publish(client, csrf_headers, pub_email, adm_email)

        client.post("/api/auth/login", json={"email": adm_email, "password": "password123"}, headers=csrf_headers)
        client.delete(f"/api/reports/{report_id}", headers=csrf_headers)

        r = client.post(f"/api/reports/{report_id}/repost", headers=csrf_headers)
        assert r.status_code == 200

        r = client.get(f"/api/reports/{report_id}")
        assert r.status_code == 200
        assert r.get_json()["review_status"] == "published"
