export const DEFAULT_STATE_COLORS = Object.freeze({
  idle: '#A7ADB5',
  thinking: '#FF8A3D',
  executing: '#339CFF',
  input_needed: '#F05252',
  completed: '#35C878',
  compacting: '#A56BFF',
});

export const STATE_COLOR_KEYS = Object.freeze({
  idle: 'idle_color',
  thinking: 'thinking_color',
  executing: 'executing_color',
  input_needed: 'input_needed_color',
  completed: 'completed_color',
  compacting: 'compacting_color',
});

export const COLOR_PRESET_GROUPS = Object.freeze([
  Object.freeze({
    id: 'palette-01',
    labelKey: 'settings.colorGroups.palette01',
    colors: Object.freeze([
      '#A4CAB6', '#69A794', '#5DBE8A', '#41B349', '#2C9678', '#428675', '#248067',
    ]),
  }),
  Object.freeze({
    id: 'palette-02',
    labelKey: 'settings.colorGroups.palette02',
    colors: Object.freeze([
      '#BACCD9', '#8FB2C9', '#8ABCD1', '#10AEC2', '#158BB8', '#4E7CA1', '#2775B6',
    ]),
  }),
  Object.freeze({
    id: 'palette-03',
    labelKey: 'settings.colorGroups.palette03',
    colors: Object.freeze([
      '#F03752', '#EE2746', '#C21F30', '#EE3F4D', '#BF3553', '#A7535A', '#82111F',
    ]),
  }),
  Object.freeze({
    id: 'palette-04',
    labelKey: 'settings.colorGroups.palette04',
    colors: Object.freeze([
      '#FED71A', '#F9D770', '#ECCB16', '#FCC307', '#FEBA07', '#F9A633', '#DAA45A',
    ]),
  }),
  Object.freeze({
    id: 'palette-05',
    labelKey: 'settings.colorGroups.palette05',
    colors: Object.freeze([
      '#F0C9CF', '#F0A1A8', '#E77C8E', '#EC8AA4', '#EC7696', '#EA517F', '#DE3F7C',
    ]),
  }),
  Object.freeze({
    id: 'palette-06',
    labelKey: 'settings.colorGroups.palette06',
    colors: Object.freeze([
      '#E9CCD3', '#C08EAF', '#C06F98', '#806D9E', '#815C94', '#813C85', '#4D1018',
    ]),
  }),
  Object.freeze({
    id: 'palette-07',
    labelKey: 'settings.colorGroups.palette07',
    colors: Object.freeze([
      '#F18F60', '#EE781F', '#E97040', '#EA5532', '#DC541B', '#EA5514', '#B55336',
    ]),
  }),
  Object.freeze({
    id: 'palette-08',
    labelKey: 'settings.colorGroups.palette08',
    colors: Object.freeze([
      '#E7A23F', '#DE7622', '#673424', '#5C1E19', '#652B1C', '#592620', '#482522',
    ]),
  }),
  Object.freeze({
    id: 'palette-09',
    labelKey: 'settings.colorGroups.palette09',
    colors: Object.freeze([
      '#3E3B31', '#31322C', '#39363F', '#353538', '#2D2D30', '#2E282E', '#000013',
    ]),
  }),
  Object.freeze({
    id: 'palette-10',
    labelKey: 'settings.colorGroups.palette10',
    colors: Object.freeze([
      '#E4DFD7', '#CFCCC9', '#D4C4B7', '#BDAEAD', '#B6A476', '#9FA39A', '#847C74',
    ]),
  }),
]);

export const COLOR_PRESETS = Object.freeze(COLOR_PRESET_GROUPS.flatMap(({ colors }) => colors));

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(value, fallback) {
  return isHexColor(value) ? value.toUpperCase() : fallback;
}
