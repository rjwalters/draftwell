import hashlib
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from anvil.lib.review_schema import Review
from pydantic import ValidationError
from adapter import CheckRequest, check, ANVIL_COMMIT
from server import make_handler


def payload(text="Alpha had 70 points, Beta had 56, and Gamma had 54. Alpha finished 70 points ahead of Beta."):
    return dict(schema_version="1", document_id="doc-1", revision=2, content=text,
                content_hash=hashlib.sha256(text.encode()).hexdigest())


class AdapterTests(unittest.TestCase):
    def test_numeric_evidence_and_revision_identity(self):
        result = check(CheckRequest(**payload()))
        self.assertEqual(result["anvil_commit"], ANVIL_COMMIT)
        self.assertEqual(result["revision"], 2)
        self.assertEqual(result["numeric"]["findings"][0]["computed"], 14)
        Review.model_validate(result["review"])

    def test_word_diff_and_rhetoric(self):
        request = payload("We delve into writing.")
        result = check(CheckRequest(**request, previous_content="We improve writing."))
        self.assertGreater(result["rhetoric"]["warnings"], 0)
        self.assertIn("<ins>", json.dumps(result["diff"]))

    def test_rejects_hash_mismatch_and_client_paths(self):
        request = payload()
        request["content_hash"] = "0" * 64
        with self.assertRaises(ValidationError):
            CheckRequest(**request)
        with self.assertRaises(ValidationError):
            CheckRequest(**payload(), path="/etc/passwd")

    def test_http_auth_validation_and_roundtrip(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler("test-only-token"))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/check"
        try:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url, data=json.dumps(payload()).encode()))
            self.assertEqual(caught.exception.code, 401)
            headers = {"Authorization": "Bearer test-only-token"}
            with urlopen(Request(url, headers=headers, data=json.dumps(payload()).encode())) as response:
                self.assertEqual(json.load(response)["document_id"], "doc-1")
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url, headers=headers, data=b"{}"))
            self.assertEqual(caught.exception.code, 400)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
