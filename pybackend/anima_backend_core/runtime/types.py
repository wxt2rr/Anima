from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


class ArtifactSource(TypedDict, total=False):
    toolName: str
    toolCallId: str
    traceId: str


class Artifact(TypedDict, total=False):
    id: str
    kind: Literal["image", "video", "file"]
    path: str
    mime: str
    sizeBytes: int
    title: str
    caption: str
    source: ArtifactSource


class ToolPreview(TypedDict, total=False):
    text: str
    truncated: bool


class ToolDiff(TypedDict):
    path: str
    oldContent: str
    newContent: str


class ToolTraceError(TypedDict, total=False):
    message: str


class ToolTrace(TypedDict, total=False):
    id: str
    toolCallId: str
    name: str
    status: Literal["running", "succeeded", "failed"]
    startedAt: int
    endedAt: int
    durationMs: int
    argsPreview: ToolPreview
    resultPreview: ToolPreview
    diffs: List[ToolDiff]
    error: ToolTraceError
    artifacts: List[Artifact]


class Usage(TypedDict, total=False):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class RateLimit(TypedDict, total=False):
    remainingTokens: int
    limitTokens: int
    resetMs: int


class ToolFunctionCall(TypedDict):
    name: str
    arguments: str


class ToolCall(TypedDict, total=False):
    id: str
    type: Literal["function"]
    function: ToolFunctionCall


class SystemMessage(TypedDict):
    role: Literal["system"]
    content: str


class UserMessage(TypedDict):
    role: Literal["user"]
    content: str


class AssistantMessage(TypedDict, total=False):
    role: Literal["assistant"]
    content: str
    tool_calls: List[ToolCall]
    reasoning_content: str


class ToolMessage(TypedDict):
    role: Literal["tool"]
    content: str
    tool_call_id: str


ChatMessage = Union[SystemMessage, UserMessage, AssistantMessage, ToolMessage]


class RunState(TypedDict):
    run_id: str
    thread_id: str
    messages: List[Dict[str, Any]]
    composer: Dict[str, Any]
    settings: Dict[str, Any]
    temperature: float
    max_tokens: int
    extra_body: Optional[Dict[str, Any]]
    step: int
    traces: List[ToolTrace]
    artifacts: List[Artifact]
    usage: Optional[Usage]
    rate_limit: Optional[RateLimit]
    reasoning: str
    final_content: str


class RunStatusEvent(TypedDict, total=False):
    type: Literal["run"]
    status: Literal["running", "done", "error"]
    runId: str
    threadId: str


class DeltaEvent(TypedDict):
    type: Literal["delta"]
    content: str
    step: int


class ReasoningDeltaEvent(TypedDict):
    type: Literal["reasoning_delta"]
    content: str
    step: int


class TraceEvent(TypedDict):
    type: Literal["trace"]
    trace: ToolTrace


class ArtifactEvent(TypedDict):
    type: Literal["artifact"]
    artifact: Artifact


class StageEvent(TypedDict):
    type: Literal["stage"]
    stage: str
    step: int


class ErrorEvent(TypedDict):
    type: Literal["error"]
    error: str


class DoneEvent(TypedDict, total=False):
    type: Literal["done"]
    usage: Usage
    rateLimit: RateLimit
    traces: List[ToolTrace]
    artifacts: List[Artifact]
    reasoning: str


RuntimeEvent = Union[RunStatusEvent, DeltaEvent, ReasoningDeltaEvent, TraceEvent, ArtifactEvent, StageEvent, DoneEvent, ErrorEvent]
