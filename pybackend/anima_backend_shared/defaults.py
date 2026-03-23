from __future__ import annotations

import copy
from typing import Any, Dict, List

from .constants import SCHEMA_VERSION


DEFAULT_SYSTEM_PROMPT = (
    "你是 Anima。请先给出可执行结论，再给依据；"
    "当需求不明确时先澄清；避免臆测与过度设计。"
)


DEFAULT_SETTINGS: Dict[str, Any] = {
    "proxyUrl": "",
    "language": "zh",
    "theme": "system",
    "themeColor": "zinc",
    "density": "comfortable",
    "maxContextMessages": 20,
    "temperature": 0.7,
    "maxTokens": 2048,
    "enableStreamingResponse": True,
    "streamingNoProgressTimeoutMs": 30000,
    "showTokenUsage": False,
    "enableMarkdown": True,
    "collapseHistoricalProcess": False,
    "renderSingleDollarMath": False,
    "enableInfoCardVisualization": False,
    "workspaceDir": "",
    "projects": [],
    "defaultToolMode": "auto",
    "toolsEnabledIds": [],
    "commandBlacklist": [],
    "commandWhitelist": [],
    "mcpEnabledServerIds": [],
    "defaultSkillMode": "auto",
    "skillsEnabledIds": [],
    "enableStreamingSoundEffects": False,
    "enableAutoCompression": True,
    "compressionThreshold": 80,
    "keepRecentMessages": 4,
    "systemPrompts": [
        {
            "id": "default",
            "name": "Default",
            "content": DEFAULT_SYSTEM_PROMPT,
        }
    ],
    "selectedSystemPromptId": "default",
    "memoryEnabled": True,
    "memories": [],
    "memoryRetrievalEnabled": True,
    "memoryMaxRetrieveCount": 8,
    "memorySimilarityThreshold": 0.6,
    "memoryAutoSummarizeEnabled": True,
    "memoryToolModelId": "",
    "memoryEmbeddingModelId": "",
    "openclaw": {
        "enabled": False,
        "heartbeatEnabled": True,
        "heartbeatTelegramChatId": "",
    },
    "voice": {
        "enabled": True,
        "model": "openai/whisper-large-v3-turbo",
        "language": "auto",
        "autoDetect": True,
        "localModels": [],
        "remoteModels": [],
    },
    "shortcuts": {
        "bindings": {},
    },
    "acp": {
        "enabled": True,
        "defaultAgentId": "anima",
        "approvalMode": "per_action",
        "agents": [
            {"id": "mock", "name": "Mock Agent", "kind": "acpx_bridge"},
            {"id": "anima", "name": "Anima (Embedded)", "kind": "embedded"},
        ],
    },
    "coder": {
        "enabled": False,
        "name": "Codex",
        "backendKind": "codex",
        "backendLabel": "",
        "endpointType": "desktop",
        "transport": "cdpbridge",
        "autoStart": False,
        "command": "/usr/bin/open",
        "args": ["-a", "Codex", "--args", "--remote-debugging-port=9222"],
        "cwd": "",
        "env": {},
        "remoteDebuggingPort": 9222,
        "commandTemplates": {
            "status": "",
            "send": "",
            "ask": "codex exec \"{prompt}\"",
            "read": "",
            "new": "codex",
            "screenshot": "",
        },
    },
    "im": {
        "provider": "telegram",
        "telegram": {
            "enabled": False,
            "botToken": "",
            "allowedUserIds": [],
            "pollingIntervalMs": 1000,
            "providerOverrideId": "",
            "modelOverride": "",
            "allowGroups": False,
        },
    },
    "plugins": [
        {
            "id": "concise",
            "name": "Concise Answers",
            "description": "Prefer short, direct answers.",
            "isEnabled": False,
            "systemPromptAddon": "Prefer concise answers. Avoid unnecessary filler.",
        },
        {
            "id": "actionable",
            "name": "Actionable Steps",
            "description": "End with practical next steps.",
            "isEnabled": False,
            "systemPromptAddon": "When relevant, provide a short checklist of next steps.",
        },
    ],
    "mcpServers": [],
    "media": {
        "imageEnabled": False,
        "videoEnabled": False,
        "imageProviderId": "",
        "videoProviderId": "",
        "defaultImageModel": "",
        "defaultImageSize": "1024x1024",
        "defaultVideoModel": "",
    },
}


DEFAULT_PROVIDERS: List[Dict[str, Any]] = [
    {
        "id": "qwen_acp",
        "name": "Qwen Code (ACP)",
        "type": "acp",
        "isEnabled": False,
        "config": {
            "models": [{"id": "qwen-acp", "isEnabled": True, "config": {"id": "qwen-acp"}}],
            "selectedModel": "qwen-acp",
            "acp": {
                "kind": "native_acp",
                "command": "qwen",
                "args": ["--acp"],
                "env": {},
                "framing": "jsonl",
                "approvalMode": "per_action",
            },
        },
    },
    {
        "id": "codex_acp",
        "name": "Codex (codex-acp)",
        "type": "acp",
        "isEnabled": False,
        "config": {
            "models": [{"id": "codex-acp", "isEnabled": True, "config": {"id": "codex-acp"}}],
            "selectedModel": "codex-acp",
            "acp": {
                "kind": "native_acp",
                "command": "codex-acp",
                "args": [],
                "env": {},
                "framing": "jsonl",
                "approvalMode": "per_action",
            },
        },
    },
    {
        "id": "openai_codex",
        "name": "OpenAI Codex (ChatGPT)",
        "type": "openai_codex",
        "isEnabled": False,
        "auth": {"mode": "oauth_openai_codex", "profileId": "default"},
        "config": {
            "baseUrl": "https://chatgpt.com/backend-api",
            "apiFormat": "responses",
            "modelsFetched": True,
            "models": [
                {"id": "gpt-5.2-codex", "isEnabled": True, "config": {"id": "gpt-5.2-codex"}},
                {"id": "gpt-5.2-codex-low", "isEnabled": True, "config": {"id": "gpt-5.2-codex-low"}},
                {"id": "gpt-5.2-codex-medium", "isEnabled": True, "config": {"id": "gpt-5.2-codex-medium"}},
                {"id": "gpt-5.2-codex-high", "isEnabled": True, "config": {"id": "gpt-5.2-codex-high"}},
                {"id": "gpt-5.2-codex-xhigh", "isEnabled": True, "config": {"id": "gpt-5.2-codex-xhigh"}},
            ],
            "selectedModel": "gpt-5.2-codex",
            "apiKey": "",
        },
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "https://api.openai.com/v1",
            "apiFormat": "responses",
            "modelsFetched": False,
            "models": [],
            "selectedModel": "",
        },
    },
    {
        "id": "anthropic",
        "name": "Anthropic",
        "type": "anthropic",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "https://api.anthropic.com/v1",
            "modelsFetched": False,
            "models": [],
            "selectedModel": "",
        },
    },
    {
        "id": "google",
        "name": "Google",
        "type": "google",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
            "modelsFetched": False,
            "models": [],
            "selectedModel": "",
        },
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "type": "deepseek",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "https://api.deepseek.com/v1",
            "modelsFetched": False,
            "models": [],
            "selectedModel": "",
        },
    },
    {
        "id": "moonshot",
        "name": "Moonshot",
        "type": "moonshot",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "https://api.moonshot.cn/v1",
            "modelsFetched": False,
            "models": [],
            "selectedModel": "",
        },
    },
]


DEFAULT_APP_SETTINGS: Dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "settings": DEFAULT_SETTINGS,
    "providers": DEFAULT_PROVIDERS,
}


def default_app_settings() -> Dict[str, Any]:
    return copy.deepcopy(DEFAULT_APP_SETTINGS)
