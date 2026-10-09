"""OpenAI-compatible model gateway used by the manual editing agent.

Only the Python process talks to the upstream model service.  The browser never
receives a configured API key, which also keeps secrets out of exported HTML.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, replace
from typing import Any

AUTH_TYPES = {"bearer", "api-key", "x-api-key", "none"}


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Keep an Authorization header from being forwarded through redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


class ModelGatewayError(Exception):
    """A user-facing configuration or upstream request error."""

    def __init__(self, message: str, *, detail: str = "", status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.status = status


@dataclass(frozen=True)
class ModelConfig:
    base_url: str = "http://127.0.0.1:11434/v1"
    model: str = ""
    api_key: str = ""
    auth_type: str = "bearer"
    temperature: float = 0.2
    max_tokens: int = 2048
    timeout: int = 180


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ModelGatewayError(f"{name} 必须是数字") from exc
    if not minimum <= result <= maximum:
        raise ModelGatewayError(f"{name} 必须在 {minimum:g} 到 {maximum:g} 之间")
    return result


def _validate_base_url(value: Any) -> str:
    base_url = str(value or "").strip().rstrip("/")
    if not base_url:
        raise ModelGatewayError("模型接口地址不能为空")
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ModelGatewayError("模型接口地址必须是完整的 http:// 或 https:// 地址")
    if parsed.username or parsed.password:
        raise ModelGatewayError("请不要把账号或密钥写在 URL 中，请使用 API Key 输入框")
    if parsed.fragment:
        raise ModelGatewayError("模型接口地址不能包含 # 片段")
    if any(ord(character) < 32 for character in base_url):
        raise ModelGatewayError("模型接口地址包含无效控制字符")
    return base_url


def _api_endpoints(base_url: str) -> tuple[str, str]:
    """Return (chat endpoint, models endpoint) for a compatible base URL.

    Both a conventional base URL ending in ``/v1`` and a complete
    ``.../chat/completions`` relay endpoint are accepted. Query parameters on a
    complete endpoint are retained for chat calls.
    """
    parsed = urllib.parse.urlsplit(base_url)
    path = parsed.path.rstrip("/")
    suffix = "/chat/completions"
    if path.endswith(suffix):
        root_path = path[: -len(suffix)]
        chat_path = path
    else:
        root_path = path
        chat_path = path + suffix
    chat_url = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, chat_path, parsed.query, "")
    )
    models_url = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, root_path + "/models", "", "")
    )
    return chat_url, models_url


def _extract_content(payload: dict[str, Any]) -> str:
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelGatewayError(
            "模型响应格式不是 OpenAI Chat Completions 格式",
            detail="响应中缺少 choices[0].message",
            status=502,
        ) from exc

    content = message.get("content")
    if isinstance(content, list):
        pieces: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                pieces.append(item["text"])
        content = "".join(pieces)
    if not isinstance(content, str) or not content.strip():
        content = (
            message.get("reasoning_content")
            or message.get("reasoning")
            or payload["choices"][0].get("text")
        )
    if not isinstance(content, str) or not content.strip():
        raise ModelGatewayError("模型返回了空内容", status=502)
    return content


def _is_context_overflow(error: ModelGatewayError) -> bool:
    """Recognize an upstream context error without treating its lower bound as usage."""
    if error.message != "模型接口返回 HTTP 400":
        return False
    try:
        detail = json.loads(error.detail)
        upstream = detail.get("error", {})
        message = upstream.get("message", "")
    except (TypeError, ValueError, AttributeError):
        return False
    return isinstance(message, str) and "maximum context length" in message


class ModelGateway:
    """Thread-safe, runtime-editable OpenAI-compatible model connection."""

    def __init__(self, config: ModelConfig) -> None:
        if config.auth_type not in AUTH_TYPES:
            raise ModelGatewayError("不支持的鉴权方式")
        _number(config.temperature, "temperature", 0, 2)
        _number(config.max_tokens, "maxTokens", 1, 131072)
        _number(config.timeout, "timeout", 5, 1800)
        base_url = _validate_base_url(config.base_url) if config.base_url.strip() else ""
        self._config = replace(config, base_url=base_url)
        self._lock = threading.RLock()

    def snapshot(self) -> ModelConfig:
        with self._lock:
            return self._config

    def public_config(self) -> dict[str, Any]:
        config = self.snapshot()
        return {
            "configured": bool(config.base_url and config.model),
            "baseUrl": config.base_url,
            "model": config.model,
            "authType": config.auth_type,
            "hasApiKey": bool(config.api_key),
            "temperature": config.temperature,
            "maxTokens": config.max_tokens,
            "timeout": config.timeout,
        }

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(values, dict):
            raise ModelGatewayError("配置必须是 JSON 对象")
        current = self.snapshot()
        base_url = _validate_base_url(values.get("baseUrl", current.base_url))
        model = str(values.get("model", current.model) or "").strip()
        if len(model) > 300:
            raise ModelGatewayError("模型名称过长")
        auth_type = str(values.get("authType", current.auth_type) or "bearer")
        if auth_type not in AUTH_TYPES:
            raise ModelGatewayError("不支持的鉴权方式")
        temperature = _number(
            values.get("temperature", current.temperature), "temperature", 0, 2
        )
        max_tokens = int(
            _number(values.get("maxTokens", current.max_tokens), "maxTokens", 1, 131072)
        )
        timeout = int(_number(values.get("timeout", current.timeout), "timeout", 5, 1800))

        # A blank password field means "keep the current secret". Clearing is
        # deliberately explicit so a page reload cannot accidentally erase it.
        api_key = current.api_key
        if values.get("clearApiKey") is True:
            api_key = ""
        elif isinstance(values.get("apiKey"), str) and values["apiKey"].strip():
            api_key = values["apiKey"].strip()
        if len(api_key) > 10000:
            raise ModelGatewayError("API Key 过长")
        if "\r" in api_key or "\n" in api_key:
            raise ModelGatewayError("API Key 不能包含换行符")

        updated = ModelConfig(
            base_url=base_url,
            model=model,
            api_key=api_key,
            auth_type=auth_type,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
        with self._lock:
            self._config = updated
        return self.public_config()

    @staticmethod
    def _headers(config: ModelConfig) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if config.api_key and config.auth_type != "none":
            if config.auth_type == "bearer":
                headers["Authorization"] = "Bearer " + config.api_key
            elif config.auth_type == "api-key":
                headers["api-key"] = config.api_key
            elif config.auth_type == "x-api-key":
                headers["x-api-key"] = config.api_key
        return headers

    @staticmethod
    def _request_json(
        url: str,
        config: ModelConfig,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url, data=data, headers=ModelGateway._headers(config), method=method
        )
        try:
            opener = urllib.request.build_opener(_NoRedirectHandler())
            with opener.open(request, timeout=config.timeout) as response:
                raw = response.read(20 * 1024 * 1024 + 1)
                if len(raw) > 20 * 1024 * 1024:
                    raise ModelGatewayError("模型响应超过 20 MB", status=502)
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read(4000).decode("utf-8", errors="replace")
            raise ModelGatewayError(
                f"模型接口返回 HTTP {exc.code}", detail=detail, status=502
            ) from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            raise ModelGatewayError(
                "无法连接模型接口",
                detail=f"{reason}；请检查地址、端口、防火墙及服务监听地址",
                status=502,
            ) from exc
        except TimeoutError as exc:
            raise ModelGatewayError(
                "模型接口请求超时", detail=f"当前超时为 {config.timeout} 秒", status=504
            ) from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ModelGatewayError(
                "模型接口没有返回有效 JSON", detail=str(exc), status=502
            ) from exc

    def list_models(self) -> dict[str, Any]:
        config = self.snapshot()
        if not config.base_url:
            raise ModelGatewayError("尚未配置模型接口地址")
        _, endpoint = _api_endpoints(config.base_url)
        payload = self._request_json(endpoint, config)
        items = payload.get("data")
        if not isinstance(items, list):
            raise ModelGatewayError(
                "模型列表响应格式不兼容", detail="响应中缺少 data 数组", status=502
            )
        models: list[str] = []
        for item in items:
            if isinstance(item, dict):
                model_id = item.get("id") or item.get("name")
                if isinstance(model_id, str) and model_id and model_id not in models:
                    models.append(model_id)
        return {"models": models, "count": len(models), "endpoint": endpoint}

    def chat(
        self,
        messages: Any,
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        config = self.snapshot()
        if not config.base_url:
            raise ModelGatewayError("尚未配置模型接口地址")
        if not config.model:
            raise ModelGatewayError("尚未配置模型名称")
        if not isinstance(messages, list) or not messages:
            raise ModelGatewayError("messages 必须是非空数组")
        if len(messages) > 60:
            raise ModelGatewayError("单次请求最多允许 60 条消息")
        normalized: list[dict[str, str]] = []
        total_chars = 0
        for item in messages:
            if not isinstance(item, dict):
                raise ModelGatewayError("messages 中存在无效消息")
            role = str(item.get("role") or "")
            content = item.get("content")
            if role not in {"system", "user", "assistant", "tool"} or not isinstance(content, str):
                raise ModelGatewayError("messages 中的 role 或 content 无效")
            total_chars += len(content)
            normalized.append({"role": role, "content": content})
        if total_chars > 1_000_000:
            raise ModelGatewayError("发送给模型的上下文超过 100 万字符，请缩小手册内容")

        chat_endpoint, _ = _api_endpoints(config.base_url)
        body: dict[str, Any] = {
            "model": config.model,
            "messages": normalized,
            "temperature": config.temperature if temperature is None else temperature,
            "max_tokens": config.max_tokens if max_tokens is None else max_tokens,
            "stream": False,
        }
        started = time.perf_counter()
        while True:
            try:
                payload = self._request_json(chat_endpoint, config, method="POST", body=body)
                break
            except ModelGatewayError as exc:
                if not _is_context_overflow(exc):
                    raise
                next_tokens = max(256, body["max_tokens"] // 2)
                if next_tokens >= body["max_tokens"]:
                    raise ModelGatewayError(
                        "模型上下文不足，请缩短系统指令或当前手册内容",
                        detail="已将输出预算降至 256 tokens，模型仍提示上下文溢出。",
                        status=502,
                    ) from exc
                body = {**body, "max_tokens": next_tokens}
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return {
            "content": _extract_content(payload),
            "model": payload.get("model") or config.model,
            "usage": payload.get("usage") if isinstance(payload.get("usage"), dict) else None,
            "elapsedMs": elapsed_ms,
            "endpoint": chat_endpoint,
        }

    def test_connection(self) -> dict[str, Any]:
        result = self.chat(
            [{"role": "user", "content": "不要思考，只回复四个字：连接成功"}],
            max_tokens=256,
            temperature=0,
        )
        return {
            "ok": True,
            "reply": result["content"],
            "model": result["model"],
            "elapsedMs": result["elapsedMs"],
            "endpoint": result["endpoint"],
        }
