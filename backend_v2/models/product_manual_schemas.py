"""手册健康检查、模型助手与版图接口的数据模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """描述手册服务运行状态。"""

    ok: bool
    name: str
    frontend: list[str]
    backend: str
    modelConfigured: bool
    layoutPipeline: bool


class ModelConfigRequest(BaseModel):
    """接收模型连接设置，保留原接口的可选字段。"""

    model_config = ConfigDict(extra="allow")

    baseUrl: str | None = None
    model: str | None = None
    authType: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None
    timeout: int | None = None
    apiKey: str | None = None
    clearApiKey: bool | None = None


class ModelConfigResponse(BaseModel):
    """返回公开模型设置，且不暴露 API Key。"""

    configured: bool
    baseUrl: str
    model: str
    authType: str
    hasApiKey: bool
    temperature: float
    maxTokens: int
    timeout: int


class ModelsResponse(BaseModel):
    """返回模型名称列表和查询端点。"""

    models: list[str]
    count: int
    endpoint: str


class ChatRequest(BaseModel):
    """接收模型对话消息，具体内容由原业务校验。"""

    messages: Any = None


class ChatResponse(BaseModel):
    """返回对话内容、模型与使用量。"""

    content: str
    model: str
    usage: dict[str, Any] | None
    elapsedMs: int
    endpoint: str


class ConnectionTestResponse(BaseModel):
    """返回模型连接测试结果。"""

    ok: bool
    reply: str
    model: str
    elapsedMs: int
    endpoint: str


class LayoutAssetsResponse(BaseModel):
    """返回原版图生成字段，保留场景对象结构。"""

    model_id: str
    dimension_image_data_url: str
    function_block_image_data_url: str
    function_block_scene: dict[str, Any]
    assembly_image_data_url: str
    dimension_scene: dict[str, Any]
    assembly_scene: dict[str, Any]
    pad_table_csv_text: str
    pad_table_xlsx_path: str
    report_path: str
    output_root: str
    stdout: str
