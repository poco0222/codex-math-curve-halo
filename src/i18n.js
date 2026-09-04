export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'];

const dictionaries = {
  en: {
    'settings.title': 'Codex Halo Settings',
    'settings.overlayEnabled': 'Overlay enabled',
    'settings.language': 'Language',
    'settings.navigation': 'Settings sections',
    'settings.context': 'Settings workspace',
    'settings.appearance': 'Appearance',
    'settings.test': 'Test',
    'settings.display': 'Display',
    'settings.curveProfile': 'Curve profile',
    'settings.opacity': 'Opacity',
    'settings.offsetX': 'Offset X',
    'settings.offsetY': 'Offset Y',
    'settings.renderer': 'Renderer',
    'settings.colors': 'State colors',
    'settings.colorPicker': 'color',
    'settings.colorHex': 'Hex color',
    'settings.resetColor': 'Reset',
    'settings.invalidColor': 'Use #RRGGBB',
    'settings.particleCount': 'Particle count',
    'settings.trailSpan': 'Trail span',
    'settings.loopDuration': 'Loop duration (ms)',
    'settings.pulseDuration': 'Pulse duration (ms)',
    'settings.rotationDuration': 'Rotation duration (ms)',
    'settings.strokeWidth': 'Stroke width',
    'settings.activeFormula': 'Active formula',
    'settings.plugin': 'Codex Plugin',
    'settings.integration': 'Integration',
    'settings.pluginReady': 'Plugin setup',
    'settings.installPlugin': 'Install Plugin',
    'settings.uninstallPlugin': 'Uninstall Plugin',
    'settings.pluginWorking': 'Working...',
    'settings.pluginInstalled': 'Plugin installed',
    'settings.pluginUninstalled': 'Plugin uninstalled',
    'settings.pluginOperationFailed': 'Plugin operation failed',
    'settings.diagnostics': 'Diagnostics',
    'settings.diagnosticsLive': 'Live',
    'settings.resetPosition': 'Reset position',
    'settings.simulateState': 'Simulate state',
    'settings.colorSelectionHint': 'Select a state to edit its color',
    'settings.stateCount': '7 states',
    'settings.presetPalettes': 'Preset palettes',
    'settings.saveStatus.ready': 'Ready',
    'settings.saveStatus.saving': 'Saving...',
    'settings.saveStatus.saved': 'Saved',
    'settings.saveStatus.error': 'Save failed',
    'settings.startAtLogin': 'Start at login',
    'settings.followCodexLifecycle': 'Follow Codex lifecycle',
    'settings.exportDiagnostics': 'Export diagnostics',
    'settings.diagnosticsLoading': 'State: Idle | Last event: never',
    'settings.diagnosticsState': 'State',
    'settings.diagnosticsLastEvent': 'Last event',
    'settings.diagnosticsNever': 'never',
    'settings.diagnosticsSetupError': 'Setup error',
    'settings.curves.roseSeven': 'Rose Seven',
    'settings.curves.lissajousDrift': 'Lissajous Drift',
    'settings.curves.spiralSearch': 'Spiral Search',
    'settings.curves.fourierFlow': 'Fourier Flow',
    'settings.states.idle': 'Idle',
    'settings.states.thinking': 'Thinking',
    'settings.states.executing': 'Executing',
    'settings.states.inputNeeded': 'Input needed',
    'settings.states.completed': 'Completed',
    'settings.states.interrupted': 'Interrupted',
    'settings.states.compacting': 'Compacting',
    'settings.colorGroups.palette01': 'Yellow',
    'settings.colorGroups.palette02': 'Teal',
    'settings.colorGroups.palette03': 'Purple',
    'settings.colorGroups.palette04': 'Pink',
    'settings.colorGroups.palette05': 'Light neutral',
    'settings.colorGroups.palette06': 'Brown',
    'settings.colorGroups.palette07': 'Black-gray',
    'settings.colorGroups.palette08': 'Orange',
    'settings.colorGroups.palette09': 'Red',
    'settings.colorGroups.palette10': 'Blue',
    'errors.startAtLogin': 'start-at-login setup failed',
    'errors.codexLifecycle': 'Codex lifecycle setup failed',
    'errors.permission': 'permission',
    'errors.launchAgent': 'launch-agent',
    'errors.registry': 'registry',
    'errors.unsupported': 'unsupported',
    'errors.reconciliation': 'reconciliation',
  },
  'zh-CN': {
    'settings.title': 'Codex Halo 设置',
    'settings.overlayEnabled': '启用叠加层',
    'settings.language': '语言',
    'settings.navigation': '设置分区',
    'settings.context': '设置工作台',
    'settings.appearance': '外观',
    'settings.test': '测试',
    'settings.display': '显示',
    'settings.curveProfile': '曲线方案',
    'settings.opacity': '不透明度',
    'settings.offsetX': 'X 偏移',
    'settings.offsetY': 'Y 偏移',
    'settings.renderer': '渲染器',
    'settings.colors': '状态颜色',
    'settings.colorPicker': '颜色',
    'settings.colorHex': '十六进制颜色',
    'settings.resetColor': '恢复默认',
    'settings.invalidColor': '请输入 #RRGGBB',
    'settings.particleCount': '粒子数量',
    'settings.trailSpan': '轨迹跨度',
    'settings.loopDuration': '循环时长（毫秒）',
    'settings.pulseDuration': '脉冲时长（毫秒）',
    'settings.rotationDuration': '旋转时长（毫秒）',
    'settings.strokeWidth': '线条宽度',
    'settings.activeFormula': '当前公式',
    'settings.plugin': 'Codex Plugin',
    'settings.integration': '集成',
    'settings.pluginReady': 'Plugin 设置',
    'settings.installPlugin': '安装 Plugin',
    'settings.uninstallPlugin': '卸载 Plugin',
    'settings.pluginWorking': '处理中…',
    'settings.pluginInstalled': 'Plugin 已安装',
    'settings.pluginUninstalled': 'Plugin 已卸载',
    'settings.pluginOperationFailed': 'Plugin 操作失败',
    'settings.diagnostics': '诊断',
    'settings.diagnosticsLive': '实时',
    'settings.resetPosition': '重置位置',
    'settings.simulateState': '模拟状态',
    'settings.colorSelectionHint': '选择状态后编辑颜色',
    'settings.stateCount': '7 个状态',
    'settings.presetPalettes': '预置色板',
    'settings.saveStatus.ready': '就绪',
    'settings.saveStatus.saving': '保存中…',
    'settings.saveStatus.saved': '已保存',
    'settings.saveStatus.error': '保存失败',
    'settings.startAtLogin': '登录时启动',
    'settings.followCodexLifecycle': '随 Codex 启停',
    'settings.exportDiagnostics': '导出诊断',
    'settings.diagnosticsLoading': '状态：空闲 | 上次事件：从未',
    'settings.diagnosticsState': '状态',
    'settings.diagnosticsLastEvent': '上次事件',
    'settings.diagnosticsNever': '从未',
    'settings.diagnosticsSetupError': '设置错误',
    'settings.curves.roseSeven': '七瓣玫瑰',
    'settings.curves.lissajousDrift': '李萨如漂移',
    'settings.curves.spiralSearch': '螺旋搜索',
    'settings.curves.fourierFlow': '傅里叶流',
    'settings.states.idle': '空闲',
    'settings.states.thinking': '思考中',
    'settings.states.executing': '执行中',
    'settings.states.inputNeeded': '需要输入',
    'settings.states.completed': '已完成',
    'settings.states.interrupted': '已中断',
    'settings.states.compacting': '压缩中',
    'settings.colorGroups.palette01': '黄色系',
    'settings.colorGroups.palette02': '青绿色系',
    'settings.colorGroups.palette03': '紫色系',
    'settings.colorGroups.palette04': '粉色系',
    'settings.colorGroups.palette05': '浅中性色系',
    'settings.colorGroups.palette06': '棕色系',
    'settings.colorGroups.palette07': '黑灰色系',
    'settings.colorGroups.palette08': '橙色系',
    'settings.colorGroups.palette09': '红色系',
    'settings.colorGroups.palette10': '蓝色系',
    'errors.startAtLogin': '启动时设置失败',
    'errors.codexLifecycle': 'Codex 生命周期设置失败',
    'errors.permission': '权限',
    'errors.launchAgent': 'LaunchAgent',
    'errors.registry': '注册表',
    'errors.unsupported': '不支持',
    'errors.reconciliation': '状态恢复',
  },
};

const stateKeys = {
  idle: 'settings.states.idle',
  thinking: 'settings.states.thinking',
  executing: 'settings.states.executing',
  input_needed: 'settings.states.inputNeeded',
  completed: 'settings.states.completed',
  interrupted: 'settings.states.interrupted',
  compacting: 'settings.states.compacting',
};

const curveKeys = {
  'rose-seven': 'settings.curves.roseSeven',
  'lissajous-drift': 'settings.curves.lissajousDrift',
  'spiral-search': 'settings.curves.spiralSearch',
  'fourier-flow': 'settings.curves.fourierFlow',
};

const safeSetupErrorKeys = {
  permission: 'errors.permission',
  'launch-agent': 'errors.launchAgent',
  registry: 'errors.registry',
  unsupported: 'errors.unsupported',
  reconciliation: 'errors.reconciliation',
};

const safeSetupError = /^(?:(start-at-login):(permission|launch-agent|registry|unsupported|reconciliation)|(codex-lifecycle):(permission|launch-agent|registry|unsupported))$/;

export function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

export function getText(language, key) {
  const dictionary = dictionaries[normalizeLanguage(language)];
  return dictionary[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
}

export function getStateLabel(language, state) {
  return getText(language, stateKeys[state] ?? stateKeys.idle);
}

export function getCurveLabel(language, curveId) {
  return getText(language, curveKeys[curveId] ?? curveKeys['rose-seven']);
}

export function localeForLanguage(language) {
  return normalizeLanguage(language) === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function formatSetupError(command, error, language = DEFAULT_LANGUAGE) {
  const match = typeof error === 'string' ? error.match(safeSetupError) : null;
  if (!match) return `${command} failed`;

  const prefix = match[1] ?? match[3];
  const category = match[2] ?? match[4];

  const prefixText = getText(
    language,
    prefix === 'codex-lifecycle' ? 'errors.codexLifecycle' : 'errors.startAtLogin',
  );
  const label = getText(language, safeSetupErrorKeys[category]);
  const isChinese = normalizeLanguage(language) === 'zh-CN';
  const parentheses = isChinese ? ['（', '）'] : ['(', ')'];
  return `${prefixText}${isChinese ? '' : ' '}${parentheses[0]}${label}${parentheses[1]}`;
}
