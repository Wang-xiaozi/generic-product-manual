<script setup>
// 手册主工作区：保留原有页面结构，在 Vue 挂载后加载已隔离的业务脚本。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { appConfig } from '@/config'
import {
  productManualPromptGroups as promptGroups,
  productManualPromptTemplates as promptTemplates,
} from '../../../../product-manual-prompt-templates.js'
import {
  generateLayoutAssets,
  getTemplateDownloadUrl,
  requestLegacy,
} from '@/api/product-manual/product-manual-api.js'

const templateDownloadUrl = getTemplateDownloadUrl('数据指标模板.xlsx')

const promptInput = ref(null)
const promptTemplateDetails = ref(null)
const isExportingWord = ref(false)

async function exportWord() {
  if (isExportingWord.value) return
  isExportingWord.value = true
  try {
    const { exportManualAsWord } = await import('@/utils/export-word.js')
    const result = await exportManualAsWord(document.getElementById('manual'))
    window.ElementPlus?.ElMessage?.success(`已导出 ${result.fileName}`)
  } catch (error) {
    console.error('Word 导出失败', error)
    window.ElementPlus?.ElMessage?.error(`Word 导出失败：${error.message}`)
  } finally {
    isExportingWord.value = false
  }
}

function choosePrompt(event) {
  const template = promptTemplates.find((item) => item.id === event.target.value)
  if (!template) return
  event.target.value = ''
  if (promptTemplateDetails.value) promptTemplateDetails.value.open = false
  const input = promptInput.value
  if (!input) return
  input.value = template.text
  input.focus()
  const placeholder = /【[^】]+】/.exec(input.value)
  if (placeholder) input.setSelectionRange(placeholder.index, placeholder.index + placeholder[0].length)
}

const LEGACY_SCRIPTS = [
  '/_thirdparty/assets/js/tools/template-panel.js',
  '/_thirdparty/assets/js/tools/curve-panel_sparam_integrated_v3.js',
  '/_thirdparty/assets/js/tools/overlay-image-editor.js',
  '/_thirdparty/assets/js/tools/layout-panel_tdb.js',
  '/_thirdparty/assets/js/core_sparam_integrated_v3_curve_paging_fix.js',
  '/_thirdparty/assets/js/tools/layout-pad-table-default.js',
  '/_thirdparty/assets/js/tools/multi-voltage-feature-import.js',
  '/_thirdparty/assets/js/tools/manual-agent.js'
]
const LEGACY_ASSET_VERSION = Date.now().toString()
const loadedScripts = []
let isActive = false

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${path}?v=${LEGACY_ASSET_VERSION}`
    script.async = false
    script.addEventListener('load', resolve, { once: true })
    script.addEventListener('error', () => reject(new Error(`无法加载 ${path}`)), { once: true })
    document.body.appendChild(script)
    loadedScripts.push(script)
  })
}

onMounted(async () => {
  isActive = true
  window.ProductManualTemplateTools = {}
  window.ProductManualApi = {
    requestLegacy,
    generateLayoutAssets,
    snpDirectoryPath: appConfig.snpDirectoryPath,
  }
  try {
    for (const script of LEGACY_SCRIPTS) {
      if (!isActive) return
      await loadScript(script)
    }
    if (!isActive) return
    window.dispatchEvent(new CustomEvent('preinstalled-manual:ready'))
  } catch (error) {
    if (!isActive) return
    console.error('Pre-installed Manual 启动失败', error)
    window.ElementPlus?.ElMessage?.error(`应用启动失败：${error.message}`)
  }
})

onBeforeUnmount(() => {
  isActive = false
  window.ProductManualAgentDispose?.()
  window.ProductManualTemplateTools?.disposeOverlayImageEditor?.()
  window.ProductManualLegacyDispose?.()
  loadedScripts.forEach((script) => script.remove())
  loadedScripts.length = 0
  delete window.ProductManualAgentDispose
  delete window.ProductManualLegacyDispose
  delete window.ProductManualTemplateToolContext
  delete window.ProductManualTemplateTools
  delete window.ProductManualApi
})
</script>

<template>
<el-config-provider>
  <div class="editor-actions" data-editor-toolbar>
    <button class="btn" type="button" id="exportHtml">导出 HTML</button>
    <button class="btn" type="button" id="printManual">打印/导出 PDF</button>
    <button
      class="btn"
      type="button"
      id="exportWord"
      :disabled="isExportingWord"
      :aria-busy="isExportingWord"
      @click="exportWord"
    >
      {{ isExportingWord ? '正在导出 Word…' : '导出 Word' }}
    </button>
  </div>

  <div class="workspace-shell workspace-shell--streamlined">
    <aside class="side-panel workspace-sidebar resource-panel resource-panel--disabled" data-resource-panel aria-hidden="true">
      <h2 class="panel-title">资源管理器</h2>
      <div class="panel-actions">
        <button class="btn" type="button" id="addRootNode">新建一级</button>
        <button class="btn" type="button" id="addSiblingNode">添加同级</button>
        <button class="btn" type="button" id="addChildNode">添加子级</button>
        <button class="btn" type="button" id="renameNode">重命名</button>
        <button class="btn" type="button" id="deleteNode">删除</button>
      </div>
      <ul class="resource-tree" data-resource-tree>
        <li class="tree-node" data-node-kind="folder">
          <div class="tree-row">
            <button class="tree-toggle" type="button" title="展开/折叠">▾</button>
            <span class="tree-label" contenteditable="false">材料</span>
          </div>
          <ul>
            <li class="tree-node" data-node-kind="folder">
              <div class="tree-row">
                <button class="tree-toggle" type="button" title="展开/折叠">▾</button>
                <span class="tree-label" contenteditable="false">芯片数据汇总1</span>
              </div>
              <ul>
                <li class="tree-node" data-node-kind="folder">
                  <div class="tree-row">
                    <button class="tree-toggle" type="button" title="展开/折叠">▾</button>
                    <span class="tree-label" contenteditable="false">低噪声放大器芯片</span>
                  </div>
                  <ul>
                    <li class="tree-node is-active" data-node-kind="folder">
                      <div class="tree-row is-selected">
                        <button class="tree-toggle is-empty" type="button" title="展开/折叠">▸</button>
                        <span class="tree-label" contenteditable="false">PRODUCT-001</span>
                      </div>
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </aside>

    <aside class="side-panel workspace-sidebar agent-panel" data-agent-panel aria-label="手册智能助手">
      <div class="agent-heading">
        <div class="agent-mark" aria-hidden="true">AI</div>
        <div class="agent-heading-copy">
          <h2 class="panel-title">手册智能助手</h2>
          <p class="agent-subtitle">读取曲线数值，生成可确认的手册修改</p>
        </div>
        <button class="agent-new-chat" type="button" data-agent-new-chat title="清空对话上下文并开启新对话">新对话</button>
      </div>
      <div class="agent-status" data-agent-status><span></span><b>正在检查模型配置…</b></div>
      <div class="agent-messages" data-agent-messages aria-live="polite">
        <div class="agent-message agent-message--assistant">
          你好，我可以读取已导入的曲线数据并修改当前手册。例如：“5GHz时增益是多少？”、“增益曲线的趋势怎样？”或“将典型曲线的线宽改为6”。也可展开下方的提示词模板快速填入。
        </div>
      </div>
      <section class="agent-proposal" data-agent-proposal hidden>
        <div class="agent-proposal-head">
          <strong>修改建议</strong><span data-agent-change-count></span>
        </div>
        <div class="agent-change-list" data-agent-change-list></div>
        <div class="agent-proposal-actions">
          <button class="btn agent-primary" type="button" data-agent-apply>应用修改</button>
          <button class="btn" type="button" data-agent-discard>放弃</button>
        </div>
      </section>
      <form class="agent-composer" data-agent-form>
        <details ref="promptTemplateDetails" class="agent-prompt-templates">
          <summary>
            <strong>常用提示词模板</strong>
            <span>8 个场景 · 选择后自动收起</span>
          </summary>
          <div class="agent-prompt-content">
            <label for="agent-prompt-select">选择要做的事</label>
            <select id="agent-prompt-select" data-agent-prompt-select value="" @change="choosePrompt">
              <option value="" disabled>请选择提示词…</option>
              <optgroup v-for="group in promptGroups" :key="group" :label="group">
                <option
                  v-for="template in promptTemplates.filter((item) => item.group === group)"
                  :key="template.id"
                  :value="template.id"
                >
                  {{ template.title }}
                </option>
              </optgroup>
            </select>
            <p>选中后会自动填入下方输入框，并选中第一个【待替换内容】。</p>
          </div>
        </details>
        <textarea ref="promptInput" data-agent-input rows="4" placeholder="输入修改要求…" required></textarea>
        <div class="agent-composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <div class="agent-composer-actions">
            <button class="btn agent-primary" type="submit" data-agent-send>发送</button>
          </div>
        </div>
      </form>
    </aside>

  <main class="manual" id="manual">
    <section class="page page-one">
      <header class="manual-header">
        <div class="header-top">
          <div class="header-title">
            <div class="model editable" contenteditable="true">PRODUCT-001</div>
            <div class="subtitle editable" contenteditable="true">产品名称与规格（点击编辑）</div>
          </div>
        </div>
        <div class="header-strip">
          <div class="version editable" contenteditable="true">v1.0</div>
        </div>
      </header>

      <div class="page-content">
        <section class="two-column">
          <div class="half-panel">
            <h2 class="section-title">性能特点</h2>
            <ul class="feature-list" data-feature-list data-agent-section-id="performance-features">
              <li data-feature-key="频率范围" data-agent-item-id="feature:频率范围"><span class="feature-label">频率范围：</span><span class="feature-value editable" contenteditable="true" data-feature-value="频率范围" data-agent-id="feature:频率范围:value"></span></li>
              <li data-feature-key="增益" data-agent-item-id="feature:增益"><span class="feature-label">增益：</span><span class="feature-value editable" contenteditable="true" data-feature-value="增益" data-agent-id="feature:增益:value"></span></li>
              <li data-feature-key="噪声系数" data-agent-item-id="feature:噪声系数"><span class="feature-label">噪声系数：</span><span class="feature-value editable" contenteditable="true" data-feature-value="噪声系数" data-agent-id="feature:噪声系数:value"></span></li>
              <li data-feature-key="输出1dB压缩功率" data-agent-item-id="feature:输出1dB压缩功率"><span class="feature-label">输出1dB压缩功率：</span><span class="feature-value editable" contenteditable="true" data-feature-value="输出1dB压缩功率" data-agent-id="feature:输出1dB压缩功率:value"></span></li>
              <li data-feature-key="直流供电" data-agent-item-id="feature:直流供电"><span class="feature-label">直流供电：</span><span class="feature-value editable" contenteditable="true" data-feature-value="直流供电" data-agent-id="feature:直流供电:value"></span></li>
              <li data-feature-key="芯片尺寸" data-agent-item-id="feature:芯片尺寸"><span class="feature-label">芯片尺寸：</span><span class="feature-value editable" contenteditable="true" data-feature-value="芯片尺寸" data-agent-id="feature:芯片尺寸:value"></span></li>
            </ul>
          </div>
          <div class="half-panel">
            <h2 class="section-title">功能框图</h2>
            <div class="image-drop single-image function-block-image" data-image-zone data-multiple="false" tabindex="0">
              <div class="placeholder">点击或粘贴功能框图图片</div>
              <div class="image-list"></div>
            </div>
          </div>
        </section>

        <section class="section" data-agent-role="product-introduction">
          <h2 class="section-title">产品简介</h2>
          <div class="intro-text editable" contenteditable="true" data-agent-id="product-intro" data-agent-role="product-intro"></div>
        </section>

        <section class="section table-block" data-table-block>
          <h2 class="section-title editable" contenteditable="true">直流电参数 <span class="condition">（TA = +25℃）</span></h2>
          <div class="table-toolbar">
            <button class="btn" type="button" data-action="add-row">添加行</button>
            <button class="btn" type="button" data-action="delete-row">删除行</button>
            <button class="btn" type="button" data-action="add-col">添加列</button>
            <button class="btn" type="button" data-action="delete-col">删除列</button>
            <button class="btn" type="button" data-action="clear-table">清空表格</button>
          </div>
          <table class="manual-table wide" data-editable-table>
            <thead>
              <tr>
                <th contenteditable="true">指标</th>
                <th contenteditable="true">符号</th>
                <th contenteditable="true">最小值</th>
                <th contenteditable="true">典型值</th>
                <th contenteditable="true">最大值</th>
                <th contenteditable="true">单位</th>
                <th contenteditable="true">备注</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td contenteditable="true">漏极工作电压</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">静态漏极电流</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="section table-block" data-table-block>
          <h2 class="section-title editable" contenteditable="true">微波电参数 <span class="condition">（TA = +25℃，Vd = +5V）</span></h2>
          <div class="table-toolbar">
            <button class="btn" type="button" data-action="add-row">添加行</button>
            <button class="btn" type="button" data-action="delete-row">删除行</button>
            <button class="btn" type="button" data-action="add-col">添加列</button>
            <button class="btn" type="button" data-action="delete-col">删除列</button>
            <button class="btn" type="button" data-action="clear-table">清空表格</button>
          </div>
          <table class="manual-table wide" data-editable-table>
            <thead>
              <tr>
                <th contenteditable="true">指标</th>
                <th contenteditable="true">符号</th>
                <th contenteditable="true">最小值</th>
                <th contenteditable="true">典型值</th>
                <th contenteditable="true">最大值</th>
                <th contenteditable="true">单位</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td contenteditable="true">频率范围</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">增益</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">增益平坦度</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">噪声系数</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">输出1dB压缩功率</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">输入驻波</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
              <tr>
                <td contenteditable="true">输出驻波</td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer class="footer editable" contenteditable="true">产品手册  ◆  技术支持信息请自行填写</footer>
    </section>

    <section class="page page-two">
      <header class="manual-header">
        <div class="header-top">
          <div class="header-title">
            <div class="model editable" contenteditable="true">PRODUCT-001</div>
            <div class="subtitle editable" contenteditable="true">产品名称与规格（点击编辑）</div>
          </div>
        </div>
        <div class="header-strip">
          <div class="version editable" contenteditable="true">v1.0</div>
        </div>
      </header>

      <div class="page-content">
        <section class="section table-block" data-table-block>
          <h2 class="section-title">使用限制参数</h2>
          <div class="table-toolbar">
            <button class="btn" type="button" data-action="add-row">添加行</button>
            <button class="btn" type="button" data-action="delete-row">删除行</button>
            <button class="btn" type="button" data-action="add-col">添加列</button>
            <button class="btn" type="button" data-action="delete-col">删除列</button>
            <button class="btn" type="button" data-action="clear-table">清空表格</button>
          </div>
          <table class="manual-table narrow" data-editable-table>
            <thead>
              <tr>
                <th contenteditable="true">参数</th>
                <th contenteditable="true">符号</th>
                <th contenteditable="true">极限值</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td contenteditable="true">最大漏源电压</td>
                <td contenteditable="true">Vd</td>
                <td contenteditable="true">+6V</td>
              </tr>
              <tr>
                <td contenteditable="true">最高输入功率（CW）</td>
                <td contenteditable="true">Pp</td>
                <td contenteditable="true">+15dBm</td>
              </tr>
              <tr>
                <td contenteditable="true">储存温度</td>
                <td contenteditable="true">TSTG</td>
                <td contenteditable="true">-65℃～+150℃</td>
              </tr>
              <tr>
                <td contenteditable="true">使用温度</td>
                <td contenteditable="true">Top</td>
                <td contenteditable="true">-55℃～+125℃</td>
              </tr>
              <tr>
                <td contenteditable="true">最高工作沟道温度</td>
                <td contenteditable="true">Top</td>
                <td contenteditable="true">+175℃</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="section curve-section" data-curve-section>
          <h2 class="section-title editable" contenteditable="true">典型曲线</h2>
          <div class="curve-drop" data-curve-target>
            <div class="placeholder">从右侧工具读取 S参数并生成手册曲线图，点击曲线可编辑</div>
            <div class="curve-frame-list" data-curve-frame-list></div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title">外形尺寸</h2>
          <div class="dimension-caption editable" contenteditable="true">PRODUCT-001 的外形尺寸</div>
          <div class="image-drop multi-image dimension-images" data-image-zone data-multiple="true" tabindex="0">
            <div class="placeholder">点击或粘贴外形尺寸图，可插入多张图片</div>
            <div class="image-list"></div>
          </div>
          <div class="dimension-note editable" contenteditable="true">注：图中单位均为微米(μm)； 外形尺寸公差±100μm。</div>
        </section>

        <section class="section table-block" data-table-block>
          <h2 class="section-title">键合压点定义</h2>
          <div class="table-toolbar">
            <button class="btn" type="button" data-action="add-row">添加行</button>
            <button class="btn" type="button" data-action="delete-row">删除行</button>
            <button class="btn" type="button" data-action="add-col">添加列</button>
            <button class="btn" type="button" data-action="delete-col">删除列</button>
            <button class="btn" type="button" data-action="clear-table">清空表格</button>
          </div>
          <table class="manual-table wide pad-definition-table" data-editable-table>
            <thead>
              <tr>
                <th contenteditable="true">压点编号</th>
                <th contenteditable="true">功能符号</th>
                <th contenteditable="true">功能描述</th>
                <th contenteditable="true">位置（μm）</th>
                <th contenteditable="true">尺寸</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td contenteditable="true">2</td>
                <td contenteditable="true">RFin</td>
                <td contenteditable="true">射频信号输入端</td>
                <td contenteditable="true">(-, -)</td>
                <td contenteditable="true">100×110μm²</td>
              </tr>
              <tr>
                <td contenteditable="true">6</td>
                <td contenteditable="true">RFout</td>
                <td contenteditable="true">射频信号输出端</td>
                <td contenteditable="true">(-, -)</td>
                <td contenteditable="true">100×110μm²</td>
              </tr>
              <tr>
                <td contenteditable="true">4</td>
                <td contenteditable="true">Vd</td>
                <td contenteditable="true">放大器漏电压馈电端</td>
                <td contenteditable="true">(-, -)</td>
                <td contenteditable="true">100×120μm²</td>
              </tr>
              <tr>
                <td contenteditable="true">1,3,5,7</td>
                <td contenteditable="true">GND</td>
                <td contenteditable="true">供探针测试用的接地压点</td>
                <td contenteditable="true">1: (-, -)<br>3: (-, -)<br>4: (-, -)<br>6: (-, -)</td>
                <td contenteditable="true">100×110μm²</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer class="footer editable" contenteditable="true">产品手册  ◆  技术支持信息请自行填写</footer>
    </section>

    <section class="page page-three">
      <header class="manual-header">
        <div class="header-top">
          <div class="header-title">
            <div class="model editable" contenteditable="true">PRODUCT-001</div>
            <div class="subtitle editable" contenteditable="true">产品名称与规格（点击编辑）</div>
          </div>
        </div>
        <div class="header-strip">
          <div class="version editable" contenteditable="true">v1.0</div>
        </div>
      </header>

      <div class="page-content">
        <section class="section">
          <h2 class="section-title">建议装配图</h2>
          <div class="image-drop single-image assembly-image" data-image-zone data-multiple="false" tabindex="0">
            <div class="placeholder">点击或粘贴建议装配图图片</div>
            <div class="image-list"></div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title">注意事项</h2>
          <div class="note-text editable" contenteditable="true">
            <div>1） 在净化环境装配使用；</div>
            <div>2） GaAs 材料很脆，芯片表面很容易受损伤（不要碰触表面），使用时必须小心；</div>
            <div>3） 输入输出用2 根键合线（直径25μm 金丝），键合线尽量短，不要长于300μm；</div>
            <div>4） 输入输出有隔直电容；</div>
            <div>5） 用80/20 金锡焊料烧结，烧结温度不要超过300℃，烧结时间尽可能短，不要超过30 秒；</div>
            <div>6） 本品属于静电敏感器件，储存和使用时注意防静电；</div>
            <div>7） 干燥、氮气环境储存；</div>
            <div>8） 不要试图用干或湿化学方法清洁芯片表面；</div>
            <div>9） 有问题请与供货商联系。</div>
          </div>
          <div class="static-warning editable" contenteditable="true">该产品对静电较敏感<br>使用中请注意防静电</div>
        </section>
      </div>

      <footer class="footer editable" contenteditable="true">产品手册  ◆  技术支持信息请自行填写</footer>
    </section>
  </main>

    <aside class="side-panel workspace-sidebar tools-panel" data-tools-panel>
      <h2 class="panel-title">工具</h2>
      <div class="tool-actions">
        <button class="btn" type="button" id="toggleTemplatePanelSide">参数</button>
        <button class="btn" type="button" id="toggleCurvePanel">曲线</button>
        <button class="btn" type="button" id="toggleLayoutPanel">&#29256;&#22270;</button>
      </div>
      <div class="tool-list" id="toolList">
        <section class="tool-card template-panel" id="templatePanel" data-tool="templates">
          <div class="tool-header">
            <span>参数</span>
          </div>
          <div class="tool-body">
            <div class="tool-actions template-actions">
              <button class="btn" type="button" data-load-feature-excel>一键读取 Excel</button>
              <a class="btn template-download" :href="templateDownloadUrl" download="数据指标模板.xlsx" title="下载数据指标 Excel 模板">下载数据模板</a>
            </div>
            <input class="hidden-input" type="file" accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values" data-feature-excel-input>
            <p class="tool-hint" data-feature-import-status>支持固定格式 .xlsx：指标、典型值、最小值、最大值、单位、符号、显示模块。</p>
          </div>
        </section>
        <section class="tool-card curve-panel" id="curvePanel" data-tool="curves">
          <div class="tool-header">
            <span>曲线</span>
          </div>
          <div class="tool-body">
            <input class="hidden-input" type="file" accept=".s1p,.s2p,.s3p,.s4p,.snp,.txt" multiple data-snp-file-input>
            <input class="hidden-input" type="file" accept=".s1p,.s2p,.s3p,.s4p,.snp,.txt" multiple webkitdirectory directory data-snp-dir-input>
            <div class="tool-actions curve-actions">
              <button class="btn" type="button" data-pick-snp-files>选择数据文件</button>
              <button class="btn" type="button" data-pick-snp-dir>选择数据目录</button>
              <button class="btn" type="button" data-open-snp-paste>粘贴数据文本</button>
              <button class="btn" type="button" data-generate-selected-curves>生成所选中的曲线</button>
              <button class="btn" type="button" data-delete-selected-curve-resources>删除已选择的数据</button>
              <button class="btn" type="button" data-toggle-all-curves aria-pressed="false">全选</button>
            </div>
            <div class="curve-resource-list" data-curve-list></div>
            <p class="tool-hint">勾选要使用的 S 参数文件后生成曲线。曲线类型、图名、坐标轴标题、最大最小值和线宽等设置，仍可点击手册中的曲线后弹窗编辑。</p>
            <p class="tool-hint" data-curve-status>请选择或粘贴 S 参数文件</p>
          </div>
        </section>
        <section class="tool-card layout-panel" id="layoutPanel" data-tool="layout">
          <div class="tool-header">
            <span>&#29256;&#22270;</span>
          </div>
          <div class="tool-body">
            <div class="tool-actions">
              <button class="btn" type="button" data-pick-tdb-file>&#36873;&#25321; TDB &#25991;&#20214;</button>
              <button class="btn" type="button" data-generate-layout-assets>&#29983;&#25104;&#20135;&#29289;</button>
            </div>
            <input class="hidden-input" type="file" accept=".tdb" data-tdb-file-input>
            <label class="curve-field">
              &#24050;&#36873;&#29256;&#22270;&#25991;&#20214;
              <input type="text" data-tdb-file-name placeholder="&#23578;&#26410;&#36873;&#25321; .tdb &#25991;&#20214;" readonly>
            </label>
            <div class="tool-actions">
              <button class="btn" type="button" data-apply-layout-results>&#37325;&#26032;&#22238;&#22635;&#26368;&#36817;&#32467;&#26524;</button>
            </div>
            <p class="tool-hint" data-layout-mode-hint>选择 .tdb 文件后点击“生成产物”，即可生成功能框图、尺寸图、装配图和压点信息表。</p>
            <p class="tool-hint" data-layout-status>请选择 .tdb 文件。</p>
          </div>
        </section>
        <section class="tool-card overlay-editor-panel is-hidden" id="overlayEditorPanelSidebar" data-tool="overlay-editor-sidebar" hidden aria-hidden="true">
          <div class="tool-header">
            <span>图形对象编辑</span>
          </div>
          <div class="tool-body">
            <p class="tool-hint" data-overlay-editor-target>当前未选择可编辑图形</p>
            <label class="curve-field">
              当前对象
              <input type="text" data-overlay-selected-id placeholder="未选中对象" readonly>
            </label>
            <label class="curve-field">
              对象类型
              <input type="text" data-overlay-selected-kind placeholder="未选中对象" readonly>
            </label>
            <label class="curve-field">
              主文字
              <input type="text" data-overlay-text-value placeholder="适用于尺寸值、编号、标注等">
            </label>
            <label class="curve-field">
              X 坐标
              <input type="number" step="0.1" data-overlay-pos-x placeholder="例如 120.0">
            </label>
            <label class="curve-field">
              Y 坐标
              <input type="number" step="0.1" data-overlay-pos-y placeholder="例如 80.0">
            </label>
            <label class="curve-field">
              宽度
              <input type="number" step="0.1" data-overlay-size-w placeholder="适用于端口框等对象">
            </label>
            <label class="curve-field">
              高度
              <input type="number" step="0.1" data-overlay-size-h placeholder="适用于端口框等对象">
            </label>
            <label class="curve-field">
              副文字
              <input type="text" data-overlay-text-secondary placeholder="适用于 50Ω、100pF、+5V 等字段">
            </label>
            <label class="curve-field">
              朝向 / 位置
              <input type="text" data-overlay-placement placeholder="例如 left / right / above / below / bottom">
            </label>
            <label class="curve-field">
              线宽 / 缩放
              <input type="number" step="0.1" data-overlay-scale placeholder="适用于 stroke_width / scale">
            </label>
            <label class="curve-field">
              扩展属性 JSON
              <textarea data-overlay-json rows="8" placeholder='可直接修改 label、value_text、voltage_text、placement 等字段'></textarea>
            </label>
            <div class="tool-actions">
              <button class="btn" type="button" data-overlay-apply>应用到当前对象</button>
              <button class="btn" type="button" data-overlay-close>退出编辑</button>
            </div>
            <p class="tool-hint">进入编辑后，直接点击图中的已有对象即可选中；支持拖动改位置，也可以在右侧精调文字、尺寸和扩展属性。</p>
          </div>
        </section>
      </div>
    </aside>
  </div>

  <div class="curve-editor-modal is-hidden" data-snp-paste-modal aria-hidden="true">
    <div class="curve-editor-backdrop" data-snp-paste-close></div>
    <section class="curve-editor-dialog snp-paste-dialog" role="dialog" aria-modal="true" aria-labelledby="snpPasteTitle" aria-describedby="snpPasteHint">
      <div class="curve-editor-header">
        <div>
          <h2 class="curve-editor-title" id="snpPasteTitle">粘贴 S参数文本</h2>
          <p class="curve-editor-subtitle" id="snpPasteHint">粘贴 Touchstone S 参数内容，导入后会作为一个新的 .s2p 文件列出。</p>
        </div>
        <button class="btn" type="button" data-snp-paste-close>关闭</button>
      </div>
      <div class="curve-editor-body">
        <label class="curve-field">
          S 参数内容
          <textarea data-snp-paste-text rows="14" placeholder="例如：# GHZ S MA R 50"></textarea>
        </label>
      </div>
      <div class="curve-editor-actions">
        <button class="btn" type="button" data-import-pasted-snp>导入 S参数</button>
        <button class="btn" type="button" data-snp-paste-close>取消</button>
      </div>
    </section>
  </div>

  <div class="curve-editor-modal is-hidden" data-curve-editor-modal aria-hidden="true">
    <div class="curve-editor-backdrop" data-curve-editor-close></div>
    <section class="curve-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="curveEditorTitle">
      <div class="curve-editor-header">
        <div>
          <h2 class="curve-editor-title" id="curveEditorTitle">曲线编辑</h2>
          <p class="curve-editor-subtitle" data-curve-editor-selected>请点击手册中的曲线图进行编辑</p>
        </div>
        <button class="btn" type="button" data-curve-editor-close>关闭</button>
      </div>
      <div class="curve-editor-body">
        <label class="curve-field">
          曲线类型
          <select data-curve-template>
            <option value="auto-suite">自动匹配单图</option>
            <option value="gain_vswr">增益和输入输出驻波</option>
            <option value="wide_gain">宽带线性增益 vs.频率</option>
            <option value="gain_temp">增益 vs.温度</option>
            <option value="gain_voltage">增益 vs.电压</option>
            <option value="nf_frequency">噪声系数 vs.频率</option>
            <option value="nf_temp">噪声系数 vs.温度</option>
            <option value="vswr_in_temp">输入驻波 vs.温度</option>
            <option value="vswr_out_temp">输出驻波 vs.温度</option>
            <option value="iso_temp">反向隔离 vs.温度</option>
            <option value="p1db_frequency">P1dB vs.频率</option>
            <option value="p1db_temp">P1dB vs.温度</option>
          </select>
        </label>
        <label class="curve-field">
          图名
          <input type="text" data-curve-title placeholder="自动匹配手册标题">
        </label>
        <div class="curve-field-grid">
          <label class="curve-field">
            X 轴标题
            <input type="text" data-curve-x-title placeholder="自动，如 Freq">
          </label>
          <label class="curve-field">
            X 轴单位
            <input type="text" data-curve-x-unit-label placeholder="自动，如 GHz">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            Y 轴标题
            <input type="text" data-curve-y-title placeholder="自动，如 Gain">
          </label>
          <label class="curve-field">
            Y 轴单位
            <input type="text" data-curve-y-unit-label placeholder="自动，如 dB">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            右 Y 轴标题
            <input type="text" data-curve-y2-title placeholder="双轴图可用">
          </label>
          <label class="curve-field">
            右 Y 轴单位
            <input type="text" data-curve-y2-unit-label placeholder="自动，如 VSWR">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            频率缩放单位
            <select data-curve-x-unit>
              <option value="auto">自动</option>
              <option value="GHz">GHz</option>
              <option value="MHz">MHz</option>
              <option value="kHz">kHz</option>
              <option value="Hz">Hz</option>
            </select>
          </label>
          <label class="curve-field">
            线宽
            <input type="number" data-curve-line-width min="1.5" max="6" step="0.25" value="3.25">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            字体大小
            <input type="number" data-curve-font-size min="12" max="36" step="1" value="20">
          </label>
          <label class="curve-field">
            右上角图例标题
            <textarea data-curve-legend-labels rows="3" placeholder="单条曲线直接输入；多条曲线可用换行分隔"></textarea>
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            X 最小值
            <input type="number" data-curve-x-min step="any" placeholder="自动">
          </label>
          <label class="curve-field">
            X 最大值
            <input type="number" data-curve-x-max step="any" placeholder="自动">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            Y 最小值
            <input type="number" data-curve-y-min step="any" placeholder="自动">
          </label>
          <label class="curve-field">
            Y 最大值
            <input type="number" data-curve-y-max step="any" placeholder="自动">
          </label>
        </div>
        <div class="curve-field-grid">
          <label class="curve-field">
            右Y 最小值
            <input type="number" data-curve-y2-min step="any" placeholder="自动">
          </label>
          <label class="curve-field">
            右Y 最大值
            <input type="number" data-curve-y2-max step="any" placeholder="自动">
          </label>
        </div>
      </div>
      <div class="curve-editor-actions">
        <button class="btn" type="button" data-curve-editor-apply>应用到当前曲线</button>
        <button class="btn" type="button" data-curve-editor-close>取消</button>
      </div>
    </section>
  </div>

  <div class="overlay-editor-modal is-hidden" data-overlay-editor-modal aria-hidden="true">
    <div class="overlay-editor-backdrop" data-overlay-close></div>
    <section class="overlay-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="overlayEditorTitle">
      <div class="overlay-editor-header">
        <div>
          <h2 class="overlay-editor-title" id="overlayEditorTitle">&#22270;&#24418;&#23545;&#35937;&#32534;&#36753;</h2>
          <p class="overlay-editor-subtitle" data-overlay-editor-selected>&#20808;&#28857;&#20987;&#24050;&#29983;&#25104;&#22270;&#20013;&#30340;&#23545;&#35937;&#65292;&#20877;&#22312;&#36825;&#37324;&#31934;&#35843;&#32447;&#26465;&#12289;&#25991;&#23383;&#21644;&#23646;&#24615;&#12290;</p>
        </div>
        <button class="btn" type="button" data-overlay-close>&#20851;&#38381;</button>
      </div>
      <section class="tool-card overlay-editor-panel is-hidden" id="overlayEditorPanel" data-tool="overlay-editor">
        <div class="tool-body">
          <p class="tool-hint" data-overlay-editor-target>&#35831;&#20808;&#36873;&#25321;&#19968;&#31181;&#22270;&#24418;&#24182;&#28857;&#20987;&#22270;&#20013;&#30340;&#24050;&#26377;&#23545;&#35937;&#12290;</p>
          <label class="curve-field">
            &#24403;&#21069;&#23545;&#35937;
            <input type="text" data-overlay-selected-id placeholder="&#26410;&#36873;&#20013;&#23545;&#35937;" readonly>
          </label>
          <label class="curve-field">
            &#23545;&#35937;&#31867;&#22411;
            <input type="text" data-overlay-selected-kind placeholder="&#26410;&#36873;&#20013;&#23545;&#35937;" readonly>
          </label>
          <label class="curve-field">
            &#20027;&#25991;&#23383;
            <input type="text" data-overlay-text-value placeholder="&#36866;&#29992;&#20110;&#23610;&#23544;&#20540;&#12289;&#32534;&#21495;&#12289;&#26631;&#27880;&#31561;">
          </label>
          <label class="curve-field">
            X &#22352;&#26631;
            <input type="number" step="0.1" data-overlay-pos-x placeholder="&#20363;&#22914; 120.0">
          </label>
          <label class="curve-field">
            Y &#22352;&#26631;
            <input type="number" step="0.1" data-overlay-pos-y placeholder="&#20363;&#22914; 80.0">
          </label>
          <label class="curve-field">
            &#23485;&#24230;
            <input type="number" step="0.1" data-overlay-size-w placeholder="&#36866;&#29992;&#20110;&#31471;&#21475;&#26694;&#31561;&#23545;&#35937;">
          </label>
          <label class="curve-field">
            &#39640;&#24230;
            <input type="number" step="0.1" data-overlay-size-h placeholder="&#36866;&#29992;&#20110;&#31471;&#21475;&#26694;&#31561;&#23545;&#35937;">
          </label>
          <label class="curve-field">
            &#21103;&#25991;&#23383;
            <input type="text" data-overlay-text-secondary placeholder="&#36866;&#29992;&#20110; 50&#937;&#12289;100pF&#12289;+5V &#31561;&#23383;&#27573;">
          </label>
          <label class="curve-field">
            &#26397;&#21521; / &#20301;&#32622;
            <input type="text" data-overlay-placement placeholder="&#20363;&#22914; left / right / above / below / bottom">
          </label>
          <label class="curve-field">
            &#32447;&#23485; / &#32553;&#25918;
            <input type="number" step="0.1" data-overlay-scale placeholder="&#36866;&#29992;&#20110; stroke_width / scale">
          </label>
          <label class="curve-field">
            JSON
            <textarea data-overlay-json rows="8" placeholder='&#21487;&#30452;&#25509;&#20462;&#25913; label&#12289;value_text&#12289;voltage_text&#12289;placement &#31561;&#23383;&#27573;'></textarea>
          </label>
          <div class="tool-actions">
            <button class="btn" type="button" data-overlay-apply>&#24212;&#29992;&#21040;&#24403;&#21069;&#23545;&#35937;</button>
            <button class="btn" type="button" data-overlay-close>&#36864;&#20986;&#32534;&#36753;</button>
          </div>
          <p class="tool-hint">&#36827;&#20837;&#32534;&#36753;&#21518;&#65292;&#30452;&#25509;&#28857;&#20987;&#22270;&#20013;&#24050;&#26377;&#23545;&#35937;&#21363;&#21487;&#36873;&#20013;&#65292;&#20063;&#21487;&#20197;&#25302;&#21160;&#25913;&#20301;&#32622;&#12290;</p>
        </div>
      </section>
    </section>
  </div>

  <input class="hidden-input" type="file" accept="image/*" id="imageInput" multiple>
  <input class="hidden-input" type="file" accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="tableImportInput">
  </el-config-provider>
</template>
