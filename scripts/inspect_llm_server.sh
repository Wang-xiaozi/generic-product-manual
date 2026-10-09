#!/usr/bin/env bash
# Read-only diagnostics for a locally deployed OpenAI-compatible LLM service.
# The script does not change services, firewall rules, containers, or models.

set -o pipefail

SCRIPT_VERSION="1.0"
BASE_URL=""
EXTRA_PORT=""
AUTH_TYPE="bearer"
API_KEY_ENV="MANUAL_LLM_API_KEY"
ASK_KEY=0
TEST_CHAT=0
TEST_MODEL=""
CHAT_TEST_STATUS="not_requested"
CONNECT_TIMEOUT=3
REQUEST_TIMEOUT=15

usage() {
  cat <<'EOF'
用法：
  bash inspect_llm_server.sh [选项]

选项：
  --base-url URL       指定 API 根地址，例如 http://127.0.0.1:8000/v1
                       也接受完整的 .../chat/completions 地址
  --port PORT          除常用端口外，再探测一个自定义端口的 /v1
  --auth TYPE          bearer、api-key、x-api-key 或 none；默认 bearer
  --api-key-env NAME   从指定环境变量读取密钥；默认 MANUAL_LLM_API_KEY
  --ask-key            运行时静默输入密钥，不回显、不写入报告
  --test-chat          在找到接口后执行一次最小 Chat Completions 测试
  --model MODEL        测试调用使用的模型 ID；未指定时使用发现的第一个模型
  --connect-timeout N  TCP 连接超时秒数；默认 3
  --request-timeout N  单个 HTTP 请求总超时秒数；默认 15
  -h, --help           显示帮助

示例：
  bash inspect_llm_server.sh
  bash inspect_llm_server.sh --base-url http://127.0.0.1:8000/v1
  bash inspect_llm_server.sh --base-url https://中转域名/v1 \
    --auth bearer --ask-key --test-chat --model Qwen/Qwen3-8B

建议不要把真实密钥直接写成命令行参数。本脚本不会输出读取到的密钥。
EOF
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 2
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      [[ $# -ge 2 ]] || die "--base-url 缺少参数"
      BASE_URL="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || die "--port 缺少参数"
      EXTRA_PORT="$2"
      shift 2
      ;;
    --auth)
      [[ $# -ge 2 ]] || die "--auth 缺少参数"
      AUTH_TYPE="$2"
      shift 2
      ;;
    --api-key-env)
      [[ $# -ge 2 ]] || die "--api-key-env 缺少参数"
      API_KEY_ENV="$2"
      shift 2
      ;;
    --ask-key)
      ASK_KEY=1
      shift
      ;;
    --test-chat)
      TEST_CHAT=1
      shift
      ;;
    --model)
      [[ $# -ge 2 ]] || die "--model 缺少参数"
      TEST_MODEL="$2"
      shift 2
      ;;
    --connect-timeout)
      [[ $# -ge 2 ]] || die "--connect-timeout 缺少参数"
      CONNECT_TIMEOUT="$2"
      shift 2
      ;;
    --request-timeout)
      [[ $# -ge 2 ]] || die "--request-timeout 缺少参数"
      REQUEST_TIMEOUT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1（运行 --help 查看用法）"
      ;;
  esac
done

case "$AUTH_TYPE" in
  bearer|api-key|x-api-key|none) ;;
  *) die "--auth 只支持 bearer、api-key、x-api-key 或 none" ;;
esac
is_positive_integer "$CONNECT_TIMEOUT" || die "--connect-timeout 必须是正整数"
is_positive_integer "$REQUEST_TIMEOUT" || die "--request-timeout 必须是正整数"
if [[ -n "$EXTRA_PORT" ]]; then
  is_positive_integer "$EXTRA_PORT" || die "--port 必须是正整数"
  (( EXTRA_PORT <= 65535 )) || die "--port 不能超过 65535"
fi
[[ "$API_KEY_ENV" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "环境变量名无效：$API_KEY_ENV"

API_KEY="${!API_KEY_ENV-}"
if (( ASK_KEY )); then
  if [[ ! -t 0 ]]; then
    die "--ask-key 需要交互式终端"
  fi
  read -r -s -p 'API Key（不会回显）: ' API_KEY
  printf '\n' >&2
fi

TMP_DIR=""
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
  API_KEY=""
}
trap cleanup EXIT INT TERM

section() {
  printf '\n========== %s ==========\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

PYTHON_BIN=""
if command_exists python3 && python3 -c 'import sys; assert sys.version_info.major >= 3' >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command_exists python && python -c 'import sys; assert sys.version_info.major >= 3' >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

redact() {
  sed -E \
    -e 's/((--api-key|--token|--password|api[_-]?key|authorization)[= :]+)[^[:space:]]+/\1***REDACTED***/Ig' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]+/\1***REDACTED***/Ig'
}

normalize_base_url() {
  local value="$1"
  value="${value%/}"
  value="${value%/chat/completions}"
  printf '%s' "$value"
}

declare -a CANDIDATE_BASES=()
declare -a WORKING_BASES=()
declare -a DISCOVERED_MODELS=()

add_candidate() {
  local value
  value="$(normalize_base_url "$1")"
  [[ "$value" == http://* || "$value" == https://* ]] || return 0
  local existing
  for existing in "${CANDIDATE_BASES[@]-}"; do
    [[ "$existing" == "$value" ]] && return 0
  done
  CANDIDATE_BASES+=("$value")
}

add_unique_model() {
  local model="$1"
  [[ -n "$model" ]] || return 0
  local existing
  for existing in "${DISCOVERED_MODELS[@]-}"; do
    [[ "$existing" == "$model" ]] && return 0
  done
  DISCOVERED_MODELS+=("$model")
}

curl_headers() {
  CURL_AUTH_HEADERS=()
  [[ -n "$API_KEY" ]] || return 0
  local header_value=""
  case "$AUTH_TYPE" in
    bearer) header_value="Authorization: Bearer $API_KEY" ;;
    api-key) header_value="api-key: $API_KEY" ;;
    x-api-key) header_value="x-api-key: $API_KEY" ;;
    none) return 0 ;;
  esac
  # Keep the secret out of curl's process arguments. The temporary file is
  # readable only by the current user and is deleted by the EXIT trap.
  AUTH_HEADER_FILE="$TMP_DIR/auth_header"
  umask 077
  printf '%s\n' "$header_value" >"$AUTH_HEADER_FILE"
  CURL_AUTH_HEADERS=(-H "@$AUTH_HEADER_FILE")
}

extract_models() {
  local file="$1"
  if command_exists jq; then
    jq -r '.data[]? | (.id // .name // empty)' "$file" 2>/dev/null
  elif [[ -n "$PYTHON_BIN" ]]; then
    "$PYTHON_BIN" - "$file" <<'PY' 2>/dev/null
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
for item in payload.get("data", []):
    if isinstance(item, dict):
        value = item.get("id") or item.get("name")
        if isinstance(value, str) and value:
            print(value)
PY
  else
    grep -Eo '"(id|name)"[[:space:]]*:[[:space:]]*"[^"]+"' "$file" 2>/dev/null \
      | sed -E 's/^[^:]+:[[:space:]]*"([^"]+)"$/\1/'
  fi
}

extract_reply() {
  local file="$1"
  if command_exists jq; then
    jq -r '.choices[0].message.content // empty' "$file" 2>/dev/null
  elif [[ -n "$PYTHON_BIN" ]]; then
    "$PYTHON_BIN" - "$file" <<'PY' 2>/dev/null
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
value = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
if isinstance(value, str):
    print(value)
PY
  fi
}

make_chat_payload() {
  local model="$1"
  if [[ -n "$PYTHON_BIN" ]]; then
    "$PYTHON_BIN" - "$model" <<'PY'
import json
import sys

print(json.dumps({
    "model": sys.argv[1],
    "messages": [{"role": "user", "content": "这是连接测试，请只回复：连接成功"}],
    "temperature": 0,
    "max_tokens": 32,
    "stream": False,
}, ensure_ascii=True))
PY
  elif command_exists jq; then
    jq -cn --arg model "$model" '{model:$model,messages:[{role:"user",content:"这是连接测试，请只回复：连接成功"}],temperature:0,max_tokens:32,stream:false}'
  else
    return 1
  fi
}

primary_ip() {
  local candidate=""
  if command_exists hostname; then
    for candidate in $(hostname -I 2>/dev/null); do
      if [[ "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$candidate" != 127.* ]]; then
        printf '%s' "$candidate"
        return 0
      fi
    done
  fi
  if command_exists ip; then
    candidate="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
    printf '%s' "$candidate"
  fi
}

printf 'V10 手册本地大模型服务检查脚本 v%s\n' "$SCRIPT_VERSION"
printf '执行时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null || date)"
printf '说明：本脚本只读取状态并发送 HTTP 探测，不修改服务器。\n'

section "1. 服务器基本信息"
printf '主机名：%s\n' "$(hostname 2>/dev/null || printf '未知')"
printf '当前用户：%s\n' "$(id -un 2>/dev/null || whoami 2>/dev/null || printf '未知')"
printf '内核：%s\n' "$(uname -srmo 2>/dev/null || printf '未知')"
if [[ -r /etc/os-release ]]; then
  awk -F= '/^(NAME|VERSION)=/{gsub(/^"|"$/, "", $2); printf "%s：%s\n", $1, $2}' /etc/os-release
fi
ALL_IPS="$(hostname -I 2>/dev/null | xargs 2>/dev/null || true)"
PRIMARY_IP="$(primary_ip)"
printf '服务器 IP：%s\n' "${ALL_IPS:-未识别}"
printf '建议远程连接 IP：%s\n' "${PRIMARY_IP:-未识别，请向管理员确认}"

section "2. GPU 与显存"
if command_exists nvidia-smi; then
  nvidia-smi --query-gpu=index,name,driver_version,memory.total,memory.used,utilization.gpu \
    --format=csv,noheader 2>&1 | redact
else
  printf '未找到 nvidia-smi（可能没有 NVIDIA GPU，或命令不在 PATH）。\n'
fi

section "3. 可能的模型服务进程"
PROCESS_LINES="$(ps -eo user,pid,etime,args 2>/dev/null \
  | grep -Ei '[o]llama|[v]llm|[s]glang|[l]mstudio|llama[-_. ]?server|openai.*api_server' \
  | grep -v -E 'grep|inspect_llm_server' \
  | redact || true)"
if [[ -n "$PROCESS_LINES" ]]; then
  printf '%s\n' "$PROCESS_LINES"
else
  printf '未从主机进程中识别到常见模型服务；服务可能位于容器或使用了自定义名称。\n'
fi

section "4. 监听端口"
if command_exists ss; then
  LISTEN_LINES="$(ss -lntp 2>/dev/null \
    | grep -Ei 'State|:11434|:8000|:8001|:30000|:1234|ollama|vllm|sglang|llama|python' \
    | redact || true)"
  printf '%s\n' "${LISTEN_LINES:-未匹配到常见模型端口；可运行 sudo ss -lntp 查看全部端口。}"
elif command_exists netstat; then
  LISTEN_LINES="$(netstat -lntp 2>/dev/null \
    | grep -Ei ':11434|:8000|:8001|:30000|:1234|ollama|vllm|sglang|llama|python' \
    | redact || true)"
  printf '%s\n' "${LISTEN_LINES:-未匹配到常见模型端口；可运行 sudo netstat -lntp 查看全部端口。}"
else
  printf '未找到 ss 或 netstat。\n'
fi
printf '\n判断：127.0.0.1:端口仅服务器本机可访问；0.0.0.0:端口或 [::]:端口才可能被远程电脑访问。\n'

section "5. Docker 容器"
if command_exists docker; then
  DOCKER_LINES="$(docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null \
    | grep -Ei 'NAMES|ollama|vllm|sglang|lmstudio|llama|openai' \
    | redact || true)"
  printf '%s\n' "${DOCKER_LINES:-Docker 可用，但未匹配到常见模型容器。}"
else
  printf '未安装 Docker 或当前用户无法执行 docker。\n'
fi

section "6. systemd 服务"
if command_exists systemctl; then
  SYSTEMD_LINES="$(systemctl list-units --type=service --all --no-pager 2>/dev/null \
    | grep -Ei 'ollama|vllm|sglang|lmstudio|llama' || true)"
  printf '%s\n' "${SYSTEMD_LINES:-未匹配到常见 systemd 模型服务。}"
else
  printf '当前环境没有 systemctl。\n'
fi

section "7. 推理框架专用信息"
if command_exists ollama; then
  printf '%s\n' '[Ollama 版本]'
  ollama --version 2>&1 | redact
  printf '%s\n' '[Ollama 本地模型]'
  ollama list 2>&1 | redact
  printf '%s\n' '[Ollama 当前加载模型]'
  ollama ps 2>&1 | redact
else
  printf '未找到 ollama CLI。\n'
fi
if command_exists vllm; then
  printf '%s\n' '[vLLM 版本]'
  vllm --version 2>&1 | redact
elif [[ -n "$PYTHON_BIN" ]] && "$PYTHON_BIN" -c 'import vllm' >/dev/null 2>&1; then
  "$PYTHON_BIN" -c 'import vllm; print("vLLM", vllm.__version__)' 2>&1 | redact
else
  printf '未找到 vLLM CLI/Python 包。\n'
fi
if [[ -n "$PYTHON_BIN" ]] && "$PYTHON_BIN" -c 'import sglang' >/dev/null 2>&1; then
  "$PYTHON_BIN" -c 'import sglang; print("SGLang", getattr(sglang, "__version__", "版本未知"))' 2>&1 | redact
else
  printf '未在当前 Python 中找到 SGLang 包。\n'
fi
if command_exists lms; then
  printf '%s\n' '[LM Studio 模型]'
  lms ls 2>&1 | redact
else
  printf '未找到 LM Studio lms CLI。\n'
fi

if [[ -n "$BASE_URL" ]]; then
  add_candidate "$BASE_URL"
else
  add_candidate 'http://127.0.0.1:11434/v1'
  add_candidate 'http://127.0.0.1:8000/v1'
  add_candidate 'http://127.0.0.1:8001/v1'
  add_candidate 'http://127.0.0.1:30000/v1'
  add_candidate 'http://127.0.0.1:1234/v1'
fi
if [[ -n "$EXTRA_PORT" ]]; then
  add_candidate "http://127.0.0.1:${EXTRA_PORT}/v1"
fi

section "8. OpenAI 兼容接口探测"
if ! command_exists curl; then
  printf '未找到 curl，无法自动探测 HTTP 接口。请安装 curl 后重试。\n'
else
  TMP_DIR="$(mktemp -d 2>/dev/null || true)"
  if [[ -z "$TMP_DIR" ]]; then
    printf '无法创建临时目录，跳过 HTTP 探测。\n'
  else
    curl_headers
    if [[ "$AUTH_TYPE" != none && -z "$API_KEY" ]]; then
      printf '提示：未从环境变量 %s 读取到密钥，将先按无密钥方式探测。\n' "$API_KEY_ENV"
    fi
    probe_index=0
    for candidate in "${CANDIDATE_BASES[@]}"; do
      probe_index=$((probe_index + 1))
      response_file="$TMP_DIR/models_${probe_index}.json"
      error_file="$TMP_DIR/models_${probe_index}.err"
      http_code="$(curl -sS \
        --connect-timeout "$CONNECT_TIMEOUT" \
        --max-time "$REQUEST_TIMEOUT" \
        -o "$response_file" \
        -w '%{http_code}' \
        "${CURL_AUTH_HEADERS[@]}" \
        "$candidate/models" 2>"$error_file" || true)"
      if [[ "$http_code" == 200 ]]; then
        printf '[成功] %s/models\n' "$candidate"
        WORKING_BASES+=("$candidate")
        mapfile -t found_models < <(extract_models "$response_file" | tr -d '\r')
        if (( ${#found_models[@]} > 0 )); then
          printf '       模型 ID：\n'
          for model in "${found_models[@]}"; do
            printf '       - %s\n' "$model"
            add_unique_model "$model"
          done
        else
          printf '       接口返回 200，但未解析到 data[].id。\n'
        fi
      elif [[ "$http_code" == 401 || "$http_code" == 403 ]]; then
        printf '[需鉴权] %s/models -> HTTP %s\n' "$candidate" "$http_code"
      elif [[ "$http_code" != 000 && -n "$http_code" ]]; then
        printf '[未兼容] %s/models -> HTTP %s\n' "$candidate" "$http_code"
      else
        short_error="$(head -c 240 "$error_file" 2>/dev/null | tr '\r\n' ' ' | redact)"
        printf '[不可达] %s/models%s\n' "$candidate" "${short_error:+ -> $short_error}"
      fi
    done
  fi
fi

section "9. 可填写到 V10 手册的信息"
if (( ${#WORKING_BASES[@]} > 0 )); then
  RECOMMENDED_BASE="${WORKING_BASES[0]}"
  REMOTE_BASE="$RECOMMENDED_BASE"
  if [[ -n "$PRIMARY_IP" ]]; then
    REMOTE_BASE="${REMOTE_BASE/127.0.0.1/$PRIMARY_IP}"
    REMOTE_BASE="${REMOTE_BASE/localhost/$PRIMARY_IP}"
  fi
  printf '服务预设：自定义 / API 中转（确认框架后也可选对应预设）\n'
  printf '服务器本机 API 根地址：%s\n' "$RECOMMENDED_BASE"
  printf '手册电脑候选 API 根地址：%s\n' "$REMOTE_BASE"
  if (( ${#DISCOVERED_MODELS[@]} > 0 )); then
    printf '建议模型名称：%s\n' "${DISCOVERED_MODELS[0]}"
    printf '发现的全部模型：%s\n' "${DISCOVERED_MODELS[*]}"
  else
    printf '模型名称：接口可达但未自动解析，请查看上方响应或服务配置。\n'
  fi
  if [[ -n "$API_KEY" ]]; then
    printf 'API Key：已读取，但为安全起见不显示\n'
    printf '鉴权方式：%s\n' "$AUTH_TYPE"
  else
    printf 'API Key：未提供\n'
    printf '鉴权方式：%s（请按实际服务配置确认）\n' "$AUTH_TYPE"
  fi
  printf '\n远程地址只是候选值。请确认端口监听在 0.0.0.0/[::]，并从运行手册的 Windows 电脑执行：\n'
  printf '  Test-NetConnection -ComputerName %s -Port <端口>\n' "${PRIMARY_IP:-服务器IP}"
else
  printf '没有发现可用的 /v1/models 接口。\n'
  printf '请根据上面的进程和监听端口，使用 --base-url 或 --port 指定实际地址后重试。\n'
fi

if (( TEST_CHAT )); then
  CHAT_TEST_STATUS="failed"
  section "10. 最小 Chat Completions 调用"
  if (( ${#WORKING_BASES[@]} == 0 )); then
    printf '[失败] 没有可用 API 根地址，无法测试对话。\n'
  else
    CHAT_BASE="${WORKING_BASES[0]}"
    CHAT_MODEL="$TEST_MODEL"
    if [[ -z "$CHAT_MODEL" && ${#DISCOVERED_MODELS[@]} -gt 0 ]]; then
      CHAT_MODEL="${DISCOVERED_MODELS[0]}"
    fi
    if [[ -z "$CHAT_MODEL" ]]; then
      printf '[失败] 没有模型 ID。请增加 --model MODEL 后重试。\n'
    elif ! CHAT_PAYLOAD="$(make_chat_payload "$CHAT_MODEL")"; then
      printf '[失败] 生成安全 JSON 需要 python3 或 jq。\n'
    else
      chat_file="$TMP_DIR/chat.json"
      chat_error="$TMP_DIR/chat.err"
      chat_code="$(curl -sS \
        --connect-timeout "$CONNECT_TIMEOUT" \
        --max-time "$REQUEST_TIMEOUT" \
        -o "$chat_file" \
        -w '%{http_code}' \
        "${CURL_AUTH_HEADERS[@]}" \
        -H 'Content-Type: application/json' \
        -d "$CHAT_PAYLOAD" \
        "$CHAT_BASE/chat/completions" 2>"$chat_error" || true)"
      if [[ "$chat_code" == 200 ]]; then
        CHAT_REPLY="$(extract_reply "$chat_file")"
        if [[ -n "$CHAT_REPLY" ]]; then
          printf '[成功] POST %s/chat/completions\n' "$CHAT_BASE"
          printf '模型：%s\n' "$CHAT_MODEL"
          printf '回复：%s\n' "$CHAT_REPLY"
          CHAT_TEST_STATUS="passed"
        else
          printf '[异常] HTTP 200，但响应中没有 choices[0].message.content。\n'
        fi
      else
        printf '[失败] POST %s/chat/completions -> HTTP %s\n' "$CHAT_BASE" "${chat_code:-000}"
        head -c 800 "$chat_file" 2>/dev/null | redact
        head -c 400 "$chat_error" 2>/dev/null | redact
        printf '\n'
      fi
    fi
  fi
fi

section "检查完成"
if (( ${#WORKING_BASES[@]} > 0 )); then
  printf '已找到 %d 个可用 API 根地址。把第 9 节信息填入手册左侧“连接设置”，再点击“测试调用”。\n' "${#WORKING_BASES[@]}"
  if (( TEST_CHAT )) && [[ "$CHAT_TEST_STATUS" != "passed" ]]; then
    printf '接口已发现，但最小对话测试失败。\n'
    exit 4
  fi
  exit 0
fi
printf '尚未找到可用接口；请按提示检查监听地址、端口、鉴权、防火墙和容器端口映射。\n'
exit 3
