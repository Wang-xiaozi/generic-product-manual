"""验证整合后的信封、错误码、自动路由和原数据字段。"""

from __future__ import annotations

import asyncio
import sys
import unittest
import xml.etree.ElementTree as ElementTree
import zipfile
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend_v2"
sys.path.insert(0, str(BACKEND_ROOT))

from config.settings import settings
from main import create_app
from services.product_manual._thirdparty.agent_model_client import (
    ModelConfig,
    ModelGateway,
    ModelGatewayError,
)
from services.product_manual._thirdparty.layout_service import (
    LayoutServiceError,
)


class ContractApiTests(unittest.TestCase):
    """检查新功能入口和兼容数据。"""

    def setUp(self) -> None:
        """为每个测试创建独立应用。"""
        self.app = create_app()

    def test_public_defaults_start_without_model_and_do_not_call_upstream(self) -> None:
        gateway = ModelGateway(ModelConfig(base_url="", model=""))
        self.assertFalse(gateway.public_config()["configured"])
        with patch.object(gateway, "_request_json") as send:
            with self.assertRaises(ModelGatewayError):
                gateway.chat([{"role": "user", "content": "ping"}])
            with self.assertRaises(ModelGatewayError):
                gateway.list_models()
            send.assert_not_called()

    def request(
        self, method: str, path: str, *, raise_app_exceptions: bool = True, **kwargs: object
    ) -> httpx.Response:
        """向内存应用发请求；返回 HTTP 响应。"""

        async def perform() -> httpx.Response:
            transport = httpx.ASGITransport(
                app=self.app, raise_app_exceptions=raise_app_exceptions
            )
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(perform())

    def test_discovered_health_route_uses_envelope(self) -> None:
        """确认自动发现路由及健康数据字段。"""
        response = self.request("GET", "/api/product-manual/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["code"], 0)
        self.assertEqual(response.json()["msg"], "ok")
        self.assertEqual(response.json()["data"]["name"], "Pre-installed Manual")

    def test_excel_templates_are_downloaded_from_backend(self) -> None:
        """确认合并模板由后端提供，且包含 Sheet1 和 Sheet2。"""
        filename = "数据指标模板.xlsx"
        response = self.request("GET", f"/api/product-manual/templates/{filename}")
        expected = (BACKEND_ROOT / "templates" / filename).read_bytes()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, expected)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertIn("attachment", response.headers["content-disposition"])
        with zipfile.ZipFile(BytesIO(response.content)) as workbook:
            root = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
        namespace = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheet_names = [sheet.attrib["name"] for sheet in root.findall("main:sheets/main:sheet", namespace)]
        self.assertEqual(sheet_names, ["Sheet1", "Sheet2"])

    def test_unknown_excel_template_returns_404_envelope(self) -> None:
        """确认模板下载接口仅允许已登记文件。"""
        response = self.request("GET", "/api/product-manual/templates/unknown.xlsx")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"code": 404, "msg": "模板不存在", "data": None})

    def test_model_secret_stays_private_after_update(self) -> None:
        """确认模型更新仍返回原公开字段，且不泄漏密钥。"""
        response = self.request(
            "POST", "/api/product-manual/agent/config",
            json={"baseUrl": "http://127.0.0.1:11434/v1", "model": "local-model",
                  "authType": "none", "temperature": 0.2, "maxTokens": 2048,
                  "timeout": 180},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["model"], "local-model")
        self.assertNotIn("apiKey", data)

    def test_explicit_model_request_uses_public_example(self) -> None:
        """确认模型地址、鉴权和正式对话 token 上限。"""
        example = (BACKEND_ROOT / ".env.example").read_text(encoding="utf-8")
        values = dict(line.split("=", 1) for line in example.splitlines() if line.startswith("APP_"))
        gateway = ModelGateway(
            ModelConfig(
                base_url="http://127.0.0.1:11434/v1",
                model="example-model",
                api_key="test-only-key",
                auth_type=values["APP_LLM_AUTH_TYPE"],
                max_tokens=int(values["APP_LLM_MAX_TOKENS"]),
            )
        )
        fake_response = {
            "choices": [{"message": {"content": "pong"}}],
            "model": "gemma-4-e4b-it",
        }
        with patch.object(gateway, "_request_json", return_value=fake_response) as send:
            gateway.chat([{"role": "user", "content": "ping"}])
        endpoint, config = send.call_args.args
        body = send.call_args.kwargs["body"]
        self.assertEqual(endpoint, "http://127.0.0.1:11434/v1/chat/completions")
        self.assertEqual(body["model"], "example-model")
        self.assertEqual(body["max_tokens"], 1024)
        self.assertEqual(gateway._headers(config)["Authorization"], "Bearer test-only-key")

    def test_context_overflow_retries_with_smaller_output_budget(self) -> None:
        """不要把上游报告的输入下界误当成实际 token 数。"""
        gateway = ModelGateway(ModelConfig(base_url="http://model.test/v1", model="gemma-4-e4b-it",
                                           max_tokens=1024))
        overflow = ModelGatewayError(
            "模型接口返回 HTTP 400",
            detail='{"error":{"message":"This model\'s maximum context length is 4096 tokens. '
                   'However, you requested 1024 output tokens and your prompt contains at least '
                   '3073 input tokens, for a total of at least 4097 tokens."}}',
            status=502,
        )
        response = {"choices": [{"message": {"content": "ok"}}]}
        with patch.object(gateway, "_request_json", side_effect=[overflow, overflow, response]) as send:
            result = gateway.chat([{"role": "user", "content": "ping"}])
        self.assertEqual(result["content"], "ok")
        self.assertEqual(
            [call.kwargs["body"]["max_tokens"] for call in send.call_args_list],
            [1024, 512, 256],
        )

    def test_context_overflow_after_minimum_budget_has_clear_error(self) -> None:
        """输入本身过长时给出可操作提示。"""
        gateway = ModelGateway(ModelConfig(base_url="http://model.test/v1", model="gemma-4-e4b-it",
                                           max_tokens=256))
        overflow = ModelGatewayError(
            "模型接口返回 HTTP 400",
            detail='{"error":{"message":"This model\'s maximum context length is 4096 tokens."}}',
            status=502,
        )
        with (
            patch.object(gateway, "_request_json", side_effect=overflow),
            self.assertRaisesRegex(ModelGatewayError, "缩短系统指令或当前手册内容"),
        ):
            gateway.chat([{"role": "user", "content": "ping"}])

    def test_invalid_tdb_uses_real_http_error_and_envelope(self) -> None:
        """确认文件业务错误的状态码与信封。"""
        response = self.request(
            "POST", "/api/product-manual/layout/generate-layout-assets",
            files={"tdb_file": ("layout.txt", b"not-a-tdb")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], 400)
        self.assertIn(".tdb", response.json()["msg"])

    def test_validation_error_uses_422_envelope(self) -> None:
        """确认缺少文件时返回 422 统一格式。"""
        response = self.request("POST", "/api/product-manual/layout/generate-layout-assets")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["msg"], "请求参数错误")

    def test_unexpected_error_uses_500_envelope(self) -> None:
        """确认未知异常也返回统一信封。"""
        with patch.object(
            self.app.state.product_manual_service,
            "health",
            side_effect=RuntimeError("audit test"),
        ):
            response = self.request(
                "GET", "/api/product-manual/health", raise_app_exceptions=False
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(), {"code": 500, "msg": "服务器内部错误", "data": None}
        )

    def test_upload_limit_message_uses_business_config(self) -> None:
        """确认上传上限提示随业务配置变化。"""
        business = {
            **settings.business,
            "product_manual": {**settings.business["product_manual"], "max_tdb_size": 1048576},
        }
        self.app = create_app(replace(settings, business=business))
        response = self.request(
            "POST",
            "/api/product-manual/layout/generate-layout-assets",
            files={"tdb_file": ("layout.tdb", b"x" * 1048577)},
        )
        self.assertEqual(response.status_code, 413)
        self.assertIn("1 MB", response.json()["msg"])

    def test_missing_vc90_mfc_has_actionable_error(self) -> None:
        """确认 L-Edit 依赖缺失时返回明确诊断。"""
        def fail_launch(_filename: str, _payload: bytes) -> dict[str, object]:
            raise LayoutServiceError("OSError: [WinError 14001] side-by-side")

        self.app.state.product_manual_service.layout_service.generate = fail_launch
        response = self.request(
            "POST", "/api/product-manual/layout/generate-layout-assets",
            files={"tdb_file": ("layout.tdb", b"test")},
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("Microsoft.VC90.MFC x86", response.json()["msg"])


if __name__ == "__main__":
    unittest.main()
