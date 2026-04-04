from __future__ import annotations

import copy
from typing import Any, Dict, List

from .constants import SCHEMA_VERSION

DEFAULT_MODEL_CONTEXT_WINDOW = 128000


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
    "memoryAutoQueryEnabled": True,
    "memoryWriteRequireEvidence": True,
    "memoryWriteMinImportance": 0.5,
    "memoryWriteMinConfidence": 0.6,
    "memoryConsolidateMinImportance": 0.75,
    "memoryConsolidateMinConfidence": 0.75,
    "memoryVectorEnabled": True,
    "memoryVectorDimensions": 256,
    "memoryGraphEnabled": True,
    "memoryGraphDefaultHops": 1,
    "memoryEmbeddingLocalModels": [],
    "memoryAutoSummarizeEnabled": True,
    "memoryToolModelId": "",
    "memoryEmbeddingModelId": "",
    "memoryGlobalEnabled": False,
    "memoryGlobalWriteEnabled": True,
    "memoryGlobalRetrieveCount": 3,
    "memoryScopeAutoEnabled": False,
    "memoryDefaultWriteScope": "workspace",
    "openclaw": {
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
    "tts": {
        "enabled": False,
        "provider": "macos_say",
        "model": "Samantha",
        "endpoint": "",
        "apiKey": "",
        "qwenModel": "qwen3-tts-flash",
        "qwenLanguageType": "Auto",
        "speed": 1.0,
        "pitch": 1.0,
        "volume": 1.0,
        "autoPlay": False,
        "testText": "你好，这是一段本地 TTS 试听文本。",
        "localModels": [],
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
    "coderProfiles": [
        {
            "id": "codex-default",
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
        }
    ],
    "activeCoderProfileId": "codex-default",
    "statusCenter": {
        "tray": {
            "enabled": True,
            "animated": True,
            "frameIntervalMs": 260,
            "fallbackToBuiltin": True,
            "icons": {
                "idle": {"sizes": {}, "frames": []},
                "running": {"sizes": {}, "frames": []},
                "waiting_user": {"sizes": {}, "frames": []},
                "done": {"sizes": {}, "frames": []},
                "error": {"sizes": {}, "frames": []},
            },
        }
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
            "models": [{"id": "qwen-acp", "isEnabled": True, "config": {"id": "qwen-acp", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}}],
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
            "models": [{"id": "codex-acp", "isEnabled": True, "config": {"id": "codex-acp", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}}],
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
                {"id": "gpt-5.2-codex", "isEnabled": True, "config": {"id": "gpt-5.2-codex", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}},
                {"id": "gpt-5.2-codex-low", "isEnabled": True, "config": {"id": "gpt-5.2-codex-low", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}},
                {"id": "gpt-5.2-codex-medium", "isEnabled": True, "config": {"id": "gpt-5.2-codex-medium", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}},
                {"id": "gpt-5.2-codex-high", "isEnabled": True, "config": {"id": "gpt-5.2-codex-high", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}},
                {"id": "gpt-5.2-codex-xhigh", "isEnabled": True, "config": {"id": "gpt-5.2-codex-xhigh", "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}},
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
    {
        "id": "ollama_local",
        "name": "Ollama (Local)",
        "type": "openai_compatible",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "http://127.0.0.1:11434/v1",
            "apiFormat": "chat_completions",
            "modelsFetched": True,
            "models": [
                {"id": "qwen3:8b", "isEnabled": True, "config": {"id": "qwen3:8b"}},
                {"id": "llama3.1:8b", "isEnabled": True, "config": {"id": "llama3.1:8b"}},
                {"id": "gemma3:12b", "isEnabled": True, "config": {"id": "gemma3:12b"}},
            ],
            "selectedModel": "qwen3:8b",
        },
    },
    {
        "id": "lmstudio_local",
        "name": "LM Studio (Local)",
        "type": "openai_compatible",
        "isEnabled": False,
        "config": {
            "apiKey": "",
            "baseUrl": "http://127.0.0.1:1234/v1",
            "apiFormat": "chat_completions",
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
