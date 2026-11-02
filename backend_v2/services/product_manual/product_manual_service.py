"""编排原模型代理与版图生成逻辑，不依赖 HTTP 框架。"""

from __future__ import annotations

from typing import Any, BinaryIO

from config.settings import Settings

from ._thirdparty.agent_model_client import ModelConfig, ModelGateway
from ._thirdparty.layout_service import LayoutService, LayoutServiceError


class ProductManualService:
    """提供手册模型助手、版图产物与健康状态业务。"""

    def __init__(self, settings: Settings) -> None:
        """使用项目设置初始化原有业务对象；不返回值。"""
        self.settings = settings
        self.model_gateway = ModelGateway(
            ModelConfig(
                base_url=settings.llm_base_url,
                model=settings.llm_model,
                api_key=settings.llm_api_key,
                auth_type=settings.llm_auth_type,
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                timeout=settings.llm_timeout,
            )
        )
        self.layout_service = LayoutService(settings)

    def health(self) -> dict[str, Any]:
        """检查模型设置与版图脚本；返回服务状态。"""
        config = self.settings.business["product_manual"]
        return {
            "ok": True,
            "name": config["health_name"],
            "frontend": config["frontend_stack"],
            "backend": config["backend_stack"],
            "modelConfigured": self.model_gateway.public_config()["configured"],
            "layoutPipeline": self.settings.pipeline_script.exists(),
        }

    def get_model_config(self) -> dict[str, Any]:
        """返回不含密钥的模型连接设置。"""
        return self.model_gateway.public_config()

    def update_model_config(self, values: dict[str, Any]) -> dict[str, Any]:
        """更新进程内模型设置；返回公开配置。"""
        return self.model_gateway.update(values)

    def list_models(self) -> dict[str, Any]:
        """读取模型服务列表；返回名称和端点。"""
        return self.model_gateway.list_models()

    def test_connection(self) -> dict[str, Any]:
        """向模型发送测试消息；返回连接结果。"""
        return self.model_gateway.test_connection()

    def chat(self, messages: Any) -> dict[str, Any]:
        """转交原对话校验与请求；返回模型回复。"""
        return self.model_gateway.chat(messages)

    def list_process_nodes(self) -> dict[str, Any]:
        """读取可用节点，刷新网页即可取得配置文件的新内容。"""
        return self.layout_service.list_process_nodes()

    def generate_layout(
        self, filename: str, payload: bytes, process_node: str | None = None
    ) -> dict[str, Any]:
        """调用原版图生成流程；返回图像和场景数据。"""
        try:
            return self.layout_service.generate(filename, payload, process_node)
        except LayoutServiceError as exc:
            if "WinError 14001" in exc.message:
                raise LayoutServiceError(
                    "无法启动 L-Edit：系统缺少 Microsoft.VC90.MFC x86。"
                    "请安装 Microsoft Visual C++ 2008 SP1 可再发行组件包（x86），然后重试。",
                    status_code=503,
                ) from exc
            raise

    def generate_layout_upload(
        self, filename: str | None, source: BinaryIO, process_node: str | None = None
    ) -> dict[str, Any]:
        """读取并校验上传文件，再生成版图；返回原业务字段。"""
        config = self.settings.business["product_manual"]
        max_size = int(config["max_tdb_size"])
        payload = source.read(max_size + 1)
        if len(payload) > max_size:
            size_mb = max_size / (1024 * 1024)
            raise LayoutServiceError(f".tdb 文件不能超过 {size_mb:g} MB", status_code=413)
        return self.generate_layout(filename or config["default_tdb_name"], payload, process_node)
