from __future__ import annotations

from typing import Any, Dict, Iterator, List, Optional, Union

from anima_backend_shared.providers import ChatProvider, ProviderSpec, create_chat_provider, get_provider_spec


def resolve_provider_spec(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> ProviderSpec:
    provider_override_id = None
    if isinstance(composer, dict):
        v = composer.get("providerOverrideId")
        if isinstance(v, str) and v.strip():
            provider_override_id = v.strip()

    spec = get_provider_spec(settings_obj, provider_override_id)
    if spec is None:
        raise RuntimeError("No provider configured. Please configure a provider in Settings.")
    return spec


def create_provider(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> ChatProvider:
    spec = resolve_provider_spec(settings_obj, composer)
    return create_chat_provider(spec)


def _provider_meta(provider: Any) -> str:
    spec = getattr(provider, "_spec", None)
    if spec is None:
        return ""
    provider_id = str(getattr(spec, "provider_id", "") or "").strip()
    provider_type = str(getattr(spec, "provider_type", "") or "").strip()
    base_url = str(getattr(spec, "base_url", "") or "").strip()
    api_key_present = bool(str(getattr(spec, "api_key", "") or "").strip())
    if base_url:
        try:
            from urllib.parse import urlsplit, urlunsplit

            parts = urlsplit(base_url)
            if parts.username or parts.password:
                hostname = parts.hostname or ""
                netloc = hostname
                if parts.port:
                    netloc = f"{netloc}:{parts.port}"
                base_url = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        except Exception:
            pass
    if not (provider_id or provider_type or base_url):
        return ""
    return f"provider={provider_id} type={provider_type} baseUrl={base_url} apiKeyPresent={api_key_present}"


def call_chat_completion(
    provider: ChatProvider,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
    model_override: Optional[str] = None,
    extra_body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        return provider.chat_completion(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools,
            tool_choice=tool_choice,
            model_override=model_override,
            extra_body=extra_body,
        )
    except Exception as e:
        msg = str(e)
        spec = getattr(provider, "_spec", None)
        if spec is not None:
            api_key = str(getattr(spec, "api_key", "") or "")
            if api_key and api_key in msg:
                msg = msg.replace(api_key, "***")
        meta = _provider_meta(provider)
        if meta and "provider=" not in msg:
            raise RuntimeError(f"{msg} | {meta}")
        raise


def call_chat_completion_stream(
    provider: ChatProvider,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
    model_override: Optional[str] = None,
    extra_body: Optional[Dict[str, Any]] = None,
) -> Iterator[Dict[str, Any]]:
    fn = getattr(provider, "chat_completion_stream", None)
    if fn is None:
        raise RuntimeError("Provider does not support streaming.")
    try:
        return fn(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools,
            tool_choice=tool_choice,
            model_override=model_override,
            extra_body=extra_body,
        )
    except Exception as e:
        msg = str(e)
        spec = getattr(provider, "_spec", None)
        if spec is not None:
            api_key = str(getattr(spec, "api_key", "") or "")
            if api_key and api_key in msg:
                msg = msg.replace(api_key, "***")
        meta = _provider_meta(provider)
        if meta and "provider=" not in msg:
            raise RuntimeError(f"{msg} | {meta}")
        raise


def get_last_rate_limit(provider: Any) -> Optional[Dict[str, Any]]:
    v = getattr(provider, "last_rate_limit", None)
    return v if isinstance(v, dict) else None
