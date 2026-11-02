"""按请求读取工艺节点配置，供 HTTP 服务和独立分析脚本共同使用。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

DEFAULT_PROCESS_CONFIG = Path(__file__).with_name("process_nodes.json")
LAYER_ROLES = ("pad", "metal", "ground_via", "io_marker")
NODE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


class ProcessConfigError(ValueError):
    """表示配置文件无效或所选工艺节点不存在。"""


def load_process_config(path: Path = DEFAULT_PROCESS_CONFIG) -> dict[str, Any]:
    """每次重新读取 UTF-8 JSON；返回已校验配置，不缓存可变的全局节点。"""
    try:
        config = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ProcessConfigError(f"无法读取工艺节点配置：{path}；{exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("nodes"), dict):
        raise ProcessConfigError("工艺配置必须包含 nodes 对象")
    nodes = config["nodes"]
    default = config.get("default_node")
    if not isinstance(default, str) or default not in nodes:
        raise ProcessConfigError("default_node 必须指向已配置的工艺节点")
    checked = {}
    for node_id, node in nodes.items():
        if not NODE_ID_PATTERN.fullmatch(node_id) or not isinstance(node, dict):
            raise ProcessConfigError(f"无效工艺节点：{node_id}")
        label = node.get("label", node_id)
        if not isinstance(label, str) or not label.strip():
            raise ProcessConfigError(f"工艺节点 {node_id} 的 label 不能为空")
        layers = node.get("layers")
        if not isinstance(layers, dict):
            raise ProcessConfigError(f"工艺节点 {node_id} 缺少 layers 对象")
        selected = {}
        for role in LAYER_ROLES:
            value = layers.get(role)
            if not isinstance(value, str) or not value.strip() or "\0" in value:
                raise ProcessConfigError(f"工艺节点 {node_id} 的层名 {role} 必须是非空字符串")
            selected[role] = value.strip()
        checked[node_id] = {"label": label.strip(), "layers": selected}
    return {"default_node": default, "nodes": checked}


def select_process_node(config: dict[str, Any], node_id: str | None = None) -> dict[str, Any]:
    """按 ID 取得一次生成所用的独立配置；省略 ID 时采用默认节点。"""
    selected = config["default_node"] if node_id is None else node_id
    if selected not in config["nodes"]:
        raise ProcessConfigError(f"未知工艺节点：{selected}，请刷新页面或检查 process_nodes.json")
    node = config["nodes"][selected]
    return {"id": selected, "label": node["label"], "layers": dict(node["layers"])}
