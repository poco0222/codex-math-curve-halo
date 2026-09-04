import { createSerialTaskQueue } from './app.js';

export function createSettingsStore({ defaults, persist }) {
  let settings = { ...defaults };
  let uiState = {};
  const enqueueSave = createSerialTaskQueue();

  const getSettings = () => ({ ...settings });
  const getUiState = () => ({ ...uiState });

  return {
    getSettings,
    getUiState,
    replaceSettings(value) {
      settings = { ...defaults, ...value };
      return getSettings();
    },
    mergeSettings(patch) {
      settings = { ...settings, ...patch };
      return getSettings();
    },
    patchSetting(key, value) {
      settings[key] = value;
      return getSettings();
    },
    setUi(patch) {
      uiState = { ...uiState, ...patch };
      return getUiState();
    },
    save() {
      const snapshot = getSettings();
      return enqueueSave(() => persist(snapshot));
    },
  };
}
