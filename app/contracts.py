"""Versioned domain contracts. No environment secrets or .env loading."""

from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextInput(Input):
    text: str = Field(min_length=1, max_length=2_000_000)
    title: str = Field(default="文字摘录", max_length=300)
    url: str = Field(default="", max_length=4096)


class URLInput(Input):
    url: str = Field(min_length=1, max_length=4096)
    title: str = Field(default="网页资料", max_length=300)


class RevisionInput(Input):
    expected_revision: int = Field(ge=1)


class TopicsInput(RevisionInput):
    topic_ids: list[str] = Field(max_length=10)
    primary_topic_id: str | None = None
    confirmed: bool = True
    allow_other_mix: bool = False


class MetadataInput(RevisionInput):
    title: str = Field(min_length=1, max_length=300)
    bibliography: dict[str, str] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list, max_length=50)
    keywords: list[str] = Field(default_factory=list, max_length=10)


class SummaryInput(RevisionInput):
    text: str = Field(min_length=1, max_length=20000)


class NoteInput(Input):
    source_id: str
    block_id: str | None = None
    markdown: str = Field(max_length=100000)
    quote: str = Field(default="", max_length=10000)
    id: str | None = None
    expected_revision: int | None = None
    draft: bool = False


class SearchInput(Input):
    query: str = Field(min_length=1, max_length=1000)
    topic_ids: list[str] = Field(default_factory=list)
    topic_mode: Literal["any", "all"] = "any"
    source_ids: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=100)
    cloud: bool = False
    authorized: bool = False


class AnalyzeInput(Input):
    destination: str = Field(default="", max_length=2048)
    stage: Literal["parse", "classify", "summary", "ocr", "llm_parse", "translation"] = "parse"
    cloud: bool = False
    authorized: bool = False


class ProviderInput(Input):
    base_url: str = Field(default="https://api.openai.com/v1", max_length=2048)
    model: str = Field(default="", max_length=100)
    key: str = Field(default="", max_length=8192)
    enabled: bool = False
    summary: bool = False
    translation: bool = False
    answers: bool = False
    ocr: bool = False

    @model_validator(mode="before")
    @classmethod
    def ignore_legacy_prices(cls, value):
        if isinstance(value, dict):
            value = {
                k: v
                for k, v in value.items()
                if k
                not in {
                    "price_currency",
                    "pricing_mode",
                    "request_budget",
                    "daily_budget",
                    "input_per_million",
                    "output_per_million",
                }
            }
        return value


class Highlight(Input):
    id: str = Field(min_length=1, max_length=100)
    block_id: str = Field(min_length=1, max_length=200)
    parse_revision: int = Field(ge=0)
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=100000)
    view: Literal["raw", "clean"]
    style: Literal["underline", "bold", "purple"]


class HighlightsInput(RevisionInput):
    highlights: list[Highlight] = Field(max_length=1000)
