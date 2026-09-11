"""Small, deterministic Anvil boundary. No agents, filesystem inputs, or model calls."""
from dataclasses import asdict
from hashlib import sha256
from typing import Literal, Optional

from anvil.lib.numeric_consistency import NumericConsistencyResult, check_text
from anvil.lib.prose_diff import diff_prose
from anvil.lib.rhetoric_lint import lint_rhetoric
from pydantic import BaseModel, ConfigDict, Field, model_validator

ANVIL_COMMIT = "422a295da45b85d40aa628a01df9c6d2d88e300a"


class CheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal["1"]
    document_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    revision: int = Field(ge=0)
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    content: str = Field(max_length=100_000)
    previous_content: Optional[str] = Field(default=None, max_length=100_000)

    @model_validator(mode="after")
    def check_hash(self):
        if sha256(self.content.encode()).hexdigest() != self.content_hash:
            raise ValueError("Content hash does not match the supplied revision snapshot")
        return self


def check(request: CheckRequest) -> dict:
    findings, numbers, claims = check_text(request.content)
    version = f"{request.document_id}.{request.revision}"
    numeric = NumericConsistencyResult(
        version_dir=version, body_path="document.md", numbers_extracted=numbers,
        claims_checked=claims, findings=findings,
    )
    return {
        "schema_version": "1", "anvil_commit": ANVIL_COMMIT,
        "document_id": request.document_id, "revision": request.revision,
        "content_hash": request.content_hash,
        "rhetoric": lint_rhetoric(request.content).to_json(),
        "numeric": numeric.to_json(),
        # Preserve upstream evidence, even though the initial UI uses the flat findings.
        "review": numeric.to_review(version_dir=version).model_dump(mode="json"),
        "diff": asdict(diff_prose(request.previous_content, request.content))
        if request.previous_content is not None else None,
    }
