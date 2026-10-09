// 手册助手常用提示词：修改 title 可调整选项名，修改 text 可调整填入内容。
export const productManualPromptTemplates = Object.freeze([
  {
    id: 'model',
    group: '基本信息',
    title: '统一产品型号',
    text: '请把产品手册中的全部型号替换成【新型号，如 NCXxxXX-Xx】。',
  },
  {
    id: 'frequency',
    group: '基本信息',
    title: '统一工作频率',
    text: '请把产品手册中的全部频率替换成【起始频率】GHz-【截止频率】GHz。',
  },
  {
    id: 'chip-name',
    group: '基本信息',
    title: '修改芯片名称',
    text: '请把产品手册中的芯片名称替换成【芯片名称，如 GaAs MMIC 低噪声放大器芯片】。',
  },
  {
    id: 'gain',
    group: '性能特点',
    title: '修改增益',
    text: '请把性能特点中的增益修改为【数值】dB。',
  },
  {
    id: 'add-flatness',
    group: '性能特点',
    title: '增加增益平坦度',
    text: '请在性能特点中新增增益平坦度：【数值及单位】。',
  },
  {
    id: 'remove-flatness',
    group: '性能特点',
    title: '删除增益平坦度',
    text: '请在性能特点中删除增益平坦度这一项。',
  },
  {
    id: 'curve-style',
    group: '典型曲线',
    title: '调整曲线样式与范围',
    text: '请将典型曲线中的【曲线名称】曲线线宽设为【1.5～6 之间的数值】，字体大小设为【12～36 之间的整数】，X 轴显示范围设为【起始频率】GHz-【截止频率】GHz。',
  },
  {
    id: 'curve-reading',
    group: '典型曲线',
    title: '读取曲线数值',
    text: '请读取典型曲线在 【频率】GHz处的增益、输入驻波和输出驻波数值。',
  },
])

export const productManualPromptGroups = Object.freeze(['基本信息', '性能特点', '典型曲线'])
