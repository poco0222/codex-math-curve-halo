export const DEFAULT_STATE_COLORS = Object.freeze({
  idle: '#A7ADB5',
  thinking: '#FF8A3D',
  executing: '#339CFF',
  input_needed: '#F05252',
  completed: '#35C878',
  interrupted: '#FEBA07',
  compacting: '#A56BFF',
});

export const STATE_COLOR_KEYS = Object.freeze({
  idle: 'idle_color',
  thinking: 'thinking_color',
  executing: 'executing_color',
  input_needed: 'input_needed_color',
  completed: 'completed_color',
  interrupted: 'interrupted_color',
  compacting: 'compacting_color',
});

export const COLOR_PRESET_GROUPS = Object.freeze([
  Object.freeze({
    id: 'palette-01',
    labelKey: 'settings.colorGroups.palette01',
    colors: Object.freeze([
      { name: '佛手', value: '#FED71A' },
      { name: '淡茧', value: '#F9D770' },
      { name: '素馨', value: '#ECCB16' },
      { name: '金盏', value: '#FCCC07' },
      { name: '琥珀', value: '#FEBA07' },
      { name: '榴莺', value: '#F9A633' },
      { name: '珐琅', value: '#DAA45A' },
    ]),
  }),
  Object.freeze({
    id: 'palette-02',
    labelKey: 'settings.colorGroups.palette02',
    colors: Object.freeze([
      { name: '玉簪', value: '#A4CAB6' },
      { name: '梧枝', value: '#69A794' },
      { name: '蔻梢', value: '#5DBE8A' },
      { name: '玉髓', value: '#41B349' },
      { name: '青矾', value: '#2C9678' },
      { name: '亚丁', value: '#428675' },
      { name: '海王', value: '#248067' },
    ]),
  }),
  Object.freeze({
    id: 'palette-03',
    labelKey: 'settings.colorGroups.palette03',
    colors: Object.freeze([
      { name: '芝兰', value: '#E9CCD3' },
      { name: '萝兰', value: '#C08EAF' },
      { name: '樱草', value: '#C06F98' },
      { name: '槿紫', value: '#806D9E' },
      { name: '蕈紫', value: '#815C94' },
      { name: '桔梗', value: '#813C85' },
      { name: '酱紫', value: '#4D1018' },
    ]),
  }),
  Object.freeze({
    id: 'palette-04',
    labelKey: 'settings.colorGroups.palette04',
    colors: Object.freeze([
      { name: '石蕊', value: '#F0C9CF' },
      { name: '合欢', value: '#F0A1A8' },
      { name: '淡茜', value: '#E77C8E' },
      { name: '报春', value: '#EC8AA4' },
      { name: '淡绛', value: '#EC7696' },
      { name: '莲瓣', value: '#EA517F' },
      { name: '嫩菱', value: '#DE3F7C' },
    ]),
  }),
  Object.freeze({
    id: 'palette-05',
    labelKey: 'settings.colorGroups.palette05',
    colors: Object.freeze([
      { name: '珍珠', value: '#E4DFD7' },
      { name: '玛瑙', value: '#CFCCC9' },
      { name: '晓灰', value: '#D4C4B7' },
      { name: '芦穗', value: '#BDAEAD' },
      { name: '月灰', value: '#B6A476' },
      { name: '镍灰', value: '#9FA39A' },
      { name: '夜灰', value: '#847C74' },
    ]),
  }),
  Object.freeze({
    id: 'palette-06',
    labelKey: 'settings.colorGroups.palette06',
    colors: Object.freeze([
      { name: '凋叶', value: '#E7A23F' },
      { name: '鹿棕', value: '#DE7622' },
      { name: '淡栗', value: '#673424' },
      { name: '栗棕', value: '#5C1E19' },
      { name: '可可', value: '#652B1C' },
      { name: '暗驼', value: '#592620' },
      { name: '火山', value: '#482522' },
    ]),
  }),
  Object.freeze({
    id: 'palette-07',
    labelKey: 'settings.colorGroups.palette07',
    colors: Object.freeze([
      { name: '茶青', value: '#3E3B31' },
      { name: '京元', value: '#31322C' },
      { name: '鹰背', value: '#39363F' },
      { name: '烟墨', value: '#353538' },
      { name: '朱墨', value: '#2D2D30' },
      { name: '石青', value: '#2E282E' },
      { name: '青骊', value: '#000013' },
    ]),
  }),
  Object.freeze({
    id: 'palette-08',
    labelKey: 'settings.colorGroups.palette08',
    colors: Object.freeze([
      { name: '赪霞', value: '#F18F60' },
      { name: '金红', value: '#EE781F' },
      { name: '凌霄', value: '#E97040' },
      { name: '骅衣', value: '#EA5532' },
      { name: '朱柿', value: '#DC541B' },
      { name: '黄丹', value: '#EA5514' },
      { name: '橘红', value: '#B55336' },
    ]),
  }),
  Object.freeze({
    id: 'palette-09',
    labelKey: 'settings.colorGroups.palette09',
    colors: Object.freeze([
      { name: '海棠', value: '#F03752' },
      { name: '淡曙', value: '#EE2746' },
      { name: '枫叶', value: '#C21F30' },
      { name: '茶花', value: '#EE3F4D' },
      { name: '锦葵', value: '#BF3553' },
      { name: '满江', value: '#A7535A' },
      { name: '殷红', value: '#82111F' },
    ]),
  }),
  Object.freeze({
    id: 'palette-10',
    labelKey: 'settings.colorGroups.palette10',
    colors: Object.freeze([
      { name: '云水', value: '#BACCD9' },
      { name: '晴山', value: '#8FB2C9' },
      { name: '秋波', value: '#8ABCD1' },
      { name: '甸子', value: '#10AEC2' },
      { name: '鸢尾', value: '#158BB8' },
      { name: '蝶翅', value: '#4E7CA1' },
      { name: '景泰', value: '#2775B6' },
    ]),
  }),
]);

export const COLOR_PRESETS = Object.freeze(
  COLOR_PRESET_GROUPS.flatMap(({ colors }) => colors.map(({ value }) => value)),
);

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(value, fallback) {
  return isHexColor(value) ? value.toUpperCase() : fallback;
}
