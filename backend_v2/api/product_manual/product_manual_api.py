"""预装手册功能的参数校验、服务调用与响应包装。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, Depends, FastAPI, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from common.exception_handler import CustomException
from common.result import Result
from models.product_manual_schemas import (
    ChatRequest,
    ChatResponse,
    ConnectionTestResponse,
    HealthResponse,
    LayoutAssetsResponse,
    ModelConfigRequest,
    ModelConfigResponse,
    ModelsResponse,
)
from services.product_manual._thirdparty.agent_model_client import ModelGatewayError
from services.product_manual._thirdparty.layout_service import LayoutServiceError
from services.product_manual.product_manual_service import ProductManualService

router = APIRouter(prefix="/product-manual", tags=["预装手册"])
TEMPLATE_DIRECTORY = Path(__file__).resolve().parents[2] / "templates"
TEMPLATE_FILES = frozenset({"数据指标模板.xlsx"})
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def setup_feature(app: FastAPI) -> None:
    """使用应用配置安装手册服务；不返回值。"""
    app.state.product_manual_service = ProductManualService(app.state.settings)


def get_service(request: Request) -> ProductManualService:
    """从应用状态取得手册服务；返回服务实例。"""
    return request.app.state.product_manual_service


def _translate_error(exc: ModelGatewayError | LayoutServiceError) -> CustomException:
    if isinstance(exc, ModelGatewayError):
        message = exc.message + (f"：{exc.detail}" if exc.detail else "")
        return CustomException(message, code=exc.status, http_status=exc.status)
    return CustomException(exc.message, code=exc.status_code, http_status=exc.status_code)


@router.get("/health", response_model=Result[HealthResponse])
def health(service: ProductManualService = Depends(get_service)) -> Result[HealthResponse]:
    """检查服务配置；返回统一信封。"""
    return Result.success(HealthResponse.model_validate(service.health()))


@router.get("/templates/{template_name}", response_class=FileResponse)
def download_template(template_name: str) -> FileResponse:
    """从后端模板目录下载指定 Excel 模板；返回文件响应。"""
    if template_name not in TEMPLATE_FILES:
        raise CustomException("模板不存在", code=404, http_status=404)
    template_path = TEMPLATE_DIRECTORY / template_name
    if not template_path.is_file():
        raise CustomException("模板文件缺失", code=404, http_status=404)
    return FileResponse(template_path, media_type=XLSX_MEDIA_TYPE, filename=template_name)


@router.get("/agent/config", response_model=Result[ModelConfigResponse])
def get_config(service: ProductManualService = Depends(get_service)) -> Result[ModelConfigResponse]:
    """取得公开模型设置；返回统一信封。"""
    return Result.success(ModelConfigResponse.model_validate(service.get_model_config()))


@router.post("/agent/config", response_model=Result[ModelConfigResponse])
def update_config(
    payload: ModelConfigRequest = Body(default_factory=ModelConfigRequest),
    service: ProductManualService = Depends(get_service),
) -> Result[ModelConfigResponse]:
    """更新模型设置；返回统一信封。"""
    try:
        data = service.update_model_config(payload.model_dump(exclude_unset=True))
    except ModelGatewayError as exc:
        raise _translate_error(exc) from exc
    return Result.success(ModelConfigResponse.model_validate(data))


@router.post("/agent/models", response_model=Result[ModelsResponse])
def list_models(service: ProductManualService = Depends(get_service)) -> Result[ModelsResponse]:
    """获取可用模型；返回统一信封。"""
    try:
        data = service.list_models()
    except ModelGatewayError as exc:
        raise _translate_error(exc) from exc
    return Result.success(ModelsResponse.model_validate(data))


@router.post("/agent/test", response_model=Result[ConnectionTestResponse])
def test_connection(
    service: ProductManualService = Depends(get_service),
) -> Result[ConnectionTestResponse]:
    """测试模型连接；返回统一信封。"""
    try:
        data = service.test_connection()
    except ModelGatewayError as exc:
        raise _translate_error(exc) from exc
    return Result.success(ConnectionTestResponse.model_validate(data))


@router.post("/agent/chat", response_model=Result[ChatResponse])
def chat(
    payload: ChatRequest = Body(default_factory=ChatRequest),
    service: ProductManualService = Depends(get_service),
) -> Result[ChatResponse]:
    """请求模型对话；返回统一信封。"""
    try:
        data = service.chat(payload.messages)
    except ModelGatewayError as exc:
        raise _translate_error(exc) from exc
    return Result.success(ChatResponse.model_validate(data))


@router.post("/layout/generate-layout-assets", response_model=Result[LayoutAssetsResponse])
async def generate_layout_assets(
    tdb_file: UploadFile = File(...),
    service: ProductManualService = Depends(get_service),
) -> Result[LayoutAssetsResponse]:
    """将上传文件交给服务层处理；返回统一信封。"""
    try:
        data = await run_in_threadpool(
            service.generate_layout_upload, tdb_file.filename, tdb_file.file
        )
    except LayoutServiceError as exc:
        raise _translate_error(exc) from exc
    finally:
        await tdb_file.close()
    return Result.success(LayoutAssetsResponse.model_validate(data))
