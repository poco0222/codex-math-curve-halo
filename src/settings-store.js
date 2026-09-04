import { createSerialTaskQueue } from './app.js';

export function createSettingsStore({ defaults, persist, enqueue = createSerialTaskQueue() }) {
  let settings = { ...defaults };
  let uiState = {};
  const enqueueTask = enqueue;

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
    enqueue(task) {
      return enqueueTask(task);
    },
    save() {
      const snapshot = getSettings();
      return enqueueTask(() => persist(snapshot));
    },
  };
}
