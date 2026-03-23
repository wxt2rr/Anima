from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class ConfigKeySpec:
    group: str
    key: str
    storage_path: str
    value_type: str
    description: str
    ui_path: str
    risk: str = "low"
    choices: Optional[List[str]] = None
    scope_allowed: Optional[List[str]] = None


GROUPS: Dict[str, str] = {
    "general": "通用",
    "provider": "提供商",
    "chat": "聊天",
    "coder": "Coder",
    "memory": "记忆",
    "im": "IM",
    "skill": "技能",
    "network": "网络",
    "data": "数据",
    "voice": "语音",
    "shortcut": "快捷键",
    "about": "关于",
}


KEYS: List[ConfigKeySpec] = [
    ConfigKeySpec("general", "language", "settings.language", "string", "界面语言", "设置 -> 通用 -> 语言", choices=["zh", "en", "ja"]),
    ConfigKeySpec("general", "theme", "settings.theme", "string", "主题模式", "设置 -> 通用 -> 主题", choices=["light", "dark", "system"]),
    ConfigKeySpec("general", "theme_color", "settings.themeColor", "string", "主题色", "设置 -> 通用 -> 主题色"),
    ConfigKeySpec("general", "density", "settings.density", "string", "显示密度", "设置 -> 通用 -> 密度", choices=["comfortable", "compact"]),
    ConfigKeySpec("general", "workspace_dir", "settings.workspaceDir", "string", "默认工作区", "设置 -> 通用 -> 工作区", risk="medium"),
    ConfigKeySpec("chat", "stream", "settings.enableStreamingResponse", "bool", "是否开启流式返回", "设置 -> 聊天 -> 流式返回"),
    ConfigKeySpec("chat", "stream_timeout_ms", "settings.streamingNoProgressTimeoutMs", "int", "流式超时阈值", "设置 -> 聊天 -> 流式超时"),
    ConfigKeySpec("chat", "token_usage", "settings.showTokenUsage", "bool", "显示 token 用量", "设置 -> 聊天 -> Token 用量"),
    ConfigKeySpec("chat", "markdown", "settings.enableMarkdown", "bool", "启用 Markdown 渲染", "设置 -> 聊天 -> Markdown"),
    ConfigKeySpec("chat", "collapse_historical_process", "settings.collapseHistoricalProcess", "bool", "默认折叠历史过程", "设置 -> 聊天 -> 折叠历史过程"),
    ConfigKeySpec("chat", "render_single_dollar_math", "settings.renderSingleDollarMath", "bool", "渲染单美元数学公式", "设置 -> 聊天 -> 数学公式"),
    ConfigKeySpec("chat", "info_card_visualization", "settings.enableInfoCardVisualization", "bool", "信息卡片可视化", "设置 -> 聊天 -> 信息卡片"),
    ConfigKeySpec("chat", "temperature", "settings.temperature", "float", "采样温度", "设置 -> 聊天 -> Temperature"),
    ConfigKeySpec("chat", "max_tokens", "settings.maxTokens", "int", "最大输出 Token", "设置 -> 聊天 -> Max Tokens"),
    ConfigKeySpec("chat", "auto_compression", "settings.enableAutoCompression", "bool", "自动压缩上下文", "设置 -> 聊天 -> 自动压缩"),
    ConfigKeySpec("chat", "compression_threshold", "settings.compressionThreshold", "int", "压缩触发阈值", "设置 -> 聊天 -> 压缩阈值"),
    ConfigKeySpec("chat", "keep_recent_messages", "settings.keepRecentMessages", "int", "压缩后保留消息数", "设置 -> 聊天 -> 保留消息数"),
    ConfigKeySpec("coder", "enabled", "settings.coder.enabled", "bool", "启用 Coder 委托", "设置 -> Coder -> 启用"),
    ConfigKeySpec("coder", "name", "settings.coder.name", "string", "Coder 名称", "设置 -> Coder -> 名称"),
    ConfigKeySpec(
        "coder",
        "backend_kind",
        "settings.coder.backendKind",
        "string",
        "Coder 底层类型",
        "设置 -> Coder -> 底层",
        choices=["codex", "cursor", "custom"],
    ),
    ConfigKeySpec("coder", "backend_label", "settings.coder.backendLabel", "string", "自定义底层名称", "设置 -> Coder -> 自定义底层名称"),
    ConfigKeySpec(
        "coder",
        "endpoint_type",
        "settings.coder.endpointType",
        "string",
        "Coder 端类型",
        "设置 -> Coder -> 端类型",
        choices=["terminal", "desktop"],
    ),
    ConfigKeySpec(
        "coder",
        "transport",
        "settings.coder.transport",
        "string",
        "Coder 通信方式",
        "设置 -> Coder -> 通信方式",
        choices=["acp", "cdpbridge"],
    ),
    ConfigKeySpec("coder", "auto_start", "settings.coder.autoStart", "bool", "是否自动启动 Coder", "设置 -> Coder -> 自动启动", risk="medium"),
    ConfigKeySpec("coder", "command", "settings.coder.command", "string", "Coder 启动命令", "设置 -> Coder -> 启动命令", risk="high"),
    ConfigKeySpec("coder", "args", "settings.coder.args", "json", "Coder 启动参数列表", "设置 -> Coder -> 启动参数", risk="medium"),
    ConfigKeySpec("coder", "cwd", "settings.coder.cwd", "string", "Coder 工作目录", "设置 -> Coder -> 工作目录", risk="medium"),
    ConfigKeySpec("coder", "env", "settings.coder.env", "json", "Coder 环境变量", "设置 -> Coder -> 环境变量", risk="high"),
    ConfigKeySpec("coder", "remote_debugging_port", "settings.coder.remoteDebuggingPort", "int", "远程调试端口", "设置 -> Coder -> 远程调试端口"),
    ConfigKeySpec("coder", "cmd_status", "settings.coder.commandTemplates.status", "string", "Coder status 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("coder", "cmd_send", "settings.coder.commandTemplates.send", "string", "Coder send 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("coder", "cmd_ask", "settings.coder.commandTemplates.ask", "string", "Coder ask 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("coder", "cmd_read", "settings.coder.commandTemplates.read", "string", "Coder read 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("coder", "cmd_new", "settings.coder.commandTemplates.new", "string", "Coder new 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("coder", "cmd_screenshot", "settings.coder.commandTemplates.screenshot", "string", "Coder screenshot 命令模板", "设置 -> Coder -> 命令模板"),
    ConfigKeySpec("memory", "enabled", "settings.memoryEnabled", "bool", "启用记忆", "设置 -> 记忆 -> 启用"),
    ConfigKeySpec("memory", "retrieval_enabled", "settings.memoryRetrievalEnabled", "bool", "启用记忆检索", "设置 -> 记忆 -> 检索"),
    ConfigKeySpec("memory", "max_retrieve_count", "settings.memoryMaxRetrieveCount", "int", "最大检索条数", "设置 -> 记忆 -> 最大检索条数"),
    ConfigKeySpec("memory", "similarity_threshold", "settings.memorySimilarityThreshold", "float", "检索相似度阈值", "设置 -> 记忆 -> 相似度阈值"),
    ConfigKeySpec("memory", "auto_summarize_enabled", "settings.memoryAutoSummarizeEnabled", "bool", "自动摘要记忆", "设置 -> 记忆 -> 自动摘要"),
    ConfigKeySpec("memory", "tool_model_id", "settings.memoryToolModelId", "string", "记忆工具模型", "设置 -> 记忆 -> 工具模型"),
    ConfigKeySpec("memory", "embedding_model_id", "settings.memoryEmbeddingModelId", "string", "记忆向量模型", "设置 -> 记忆 -> 向量模型"),
    ConfigKeySpec("network", "proxy_url", "settings.proxyUrl", "string", "代理地址", "设置 -> 网络 -> 代理"),
    ConfigKeySpec("voice", "enabled", "settings.voice.enabled", "bool", "启用语音", "设置 -> 语音 -> 启用"),
    ConfigKeySpec("voice", "model", "settings.voice.model", "string", "语音模型", "设置 -> 语音 -> 模型"),
    ConfigKeySpec("voice", "language", "settings.voice.language", "string", "语音语言", "设置 -> 语音 -> 语言"),
    ConfigKeySpec("voice", "auto_detect", "settings.voice.autoDetect", "bool", "自动识别语音语言", "设置 -> 语音 -> 自动识别"),
    ConfigKeySpec("im", "telegram_enabled", "settings.im.telegram.enabled", "bool", "启用 Telegram", "设置 -> IM -> Telegram", risk="high"),
    ConfigKeySpec("im", "telegram_allow_groups", "settings.im.telegram.allowGroups", "bool", "允许群组消息", "设置 -> IM -> Telegram"),
    ConfigKeySpec("skill", "default_mode", "settings.defaultSkillMode", "string", "默认技能模式", "设置 -> 技能 -> 默认模式", choices=["auto", "all", "disabled"]),
    ConfigKeySpec("data", "auto_compression", "settings.enableAutoCompression", "bool", "自动压缩上下文", "设置 -> 数据 -> 自动压缩"),
    ConfigKeySpec("shortcut", "bindings", "settings.shortcuts.bindings", "json", "快捷键绑定", "设置 -> 快捷键", risk="medium"),
]


KEYS_BY_GROUP: Dict[str, List[ConfigKeySpec]] = {g: [] for g in GROUPS.keys()}
KEY_INDEX: Dict[str, ConfigKeySpec] = {}
for _k in KEYS:
    KEYS_BY_GROUP.setdefault(_k.group, []).append(_k)
    KEY_INDEX[f"{_k.group}.{_k.key}"] = _k
    KEY_INDEX[_k.storage_path] = _k


def list_group_keys(group: str) -> List[ConfigKeySpec]:
    return list(KEYS_BY_GROUP.get(group, []))


def resolve_key(group: str, key: str) -> Optional[ConfigKeySpec]:
    g = str(group or "").strip()
    k = str(key or "").strip()
    if not g or not k:
        return None
    return KEY_INDEX.get(f"{g}.{k}") or KEY_INDEX.get(k)
