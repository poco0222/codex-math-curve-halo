export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'];

const dictionaries = {
  en: {
    'settings.title': 'Codex Halo Settings',
    'settings.overlayEnabled': 'Overlay enabled',
    'settings.language': 'Language',
    'settings.display': 'Display',
    'settings.curveProfile': 'Curve profile',
    'settings.opacity': 'Opacity',
    'settings.offsetX': 'Offset X',
    'settings.offsetY': 'Offset Y',
    'settings.renderer': 'Renderer',
    'settings.particleCount': 'Particle count',
    'settings.trailSpan': 'Trail span',
    'settings.loopDuration': 'Loop duration (ms)',
    'settings.pulseDuration': 'Pulse duration (ms)',
    'settings.rotationDuration': 'Rotation duration (ms)',
    'settings.strokeWidth': 'Stroke width',
    'settings.activeFormula': 'Active formula',
    'settings.plugin': 'Codex Plugin',
    'settings.pluginReady': 'Plugin setup',
    'settings.installPlugin': 'Install Plugin',
    'settings.uninstallPlugin': 'Uninstall Plugin',
    'settings.pluginWorking': 'Working...',
    'settings.pluginInstalled': 'Plugin installed',
    'settings.pluginUninstalled': 'Plugin uninstalled',
    'settings.pluginOperationFailed': 'Plugin operation failed',
    'settings.resetPosition': 'Reset position',
    'settings.simulateState': 'Simulate state',
    'settings.startAtLogin': 'Start at login',
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
    'settings.states.compacting': 'Compacting',
    'errors.startAtLogin': 'start-at-login setup failed',
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
    'settings.display': '显示',
    'settings.curveProfile': '曲线方案',
    'settings.opacity': '不透明度',
    'settings.offsetX': 'X 偏移',
    'settings.offsetY': 'Y 偏移',
    'settings.renderer': '渲染器',
    'settings.particleCount': '粒子数量',
    'settings.trailSpan': '轨迹跨度',
    'settings.loopDuration': '循环时长（毫秒）',
    'settings.pulseDuration': '脉冲时长（毫秒）',
    'settings.rotationDuration': '旋转时长（毫秒）',
    'settings.strokeWidth': '线条宽度',
    'settings.activeFormula': '当前公式',
    'settings.plugin': 'Codex Plugin',
    'settings.pluginReady': 'Plugin 设置',
    'settings.installPlugin': '安装 Plugin',
    'settings.uninstallPlugin': '卸载 Plugin',
    'settings.pluginWorking': '处理中…',
    'settings.pluginInstalled': 'Plugin 已安装',
    'settings.pluginUninstalled': 'Plugin 已卸载',
    'settings.pluginOperationFailed': 'Plugin 操作失败',
    'settings.resetPosition': '重置位置',
    'settings.simulateState': '模拟状态',
    'settings.startAtLogin': '登录时启动',
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
    'settings.states.compacting': '压缩中',
    'errors.startAtLogin': '启动时设置失败',
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

const safeSetupError = /^start-at-login:(permission|launch-agent|registry|unsupported|reconciliation)$/;

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
  const category = typeof error === 'string' ? error.match(safeSetupError)?.[1] : null;
  if (!category) return `${command} failed`;

  const prefix = getText(language, 'errors.startAtLogin');
  const label = getText(language, safeSetupErrorKeys[category]);
  const isChinese = normalizeLanguage(language) === 'zh-CN';
  const parentheses = isChinese ? ['（', '）'] : ['(', ')'];
  return `${prefix}${isChinese ? '' : ' '}${parentheses[0]}${label}${parentheses[1]}`;
}
