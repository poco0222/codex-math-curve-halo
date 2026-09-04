import { createSerialTaskQueue } from './app.js';

function cloneUiState(value) {
  const snapshot = { ...value };
  if (value.diagnosticsSnapshot && typeof value.diagnosticsSnapshot === 'object') {
    snapshot.diagnosticsSnapshot = { ...value.diagnosticsSnapshot };
  }
  if (value.invalidColorDrafts && typeof value.invalidColorDrafts === 'object') {
    snapshot.invalidColorDrafts = { ...value.invalidColorDrafts };
  }
  return snapshot;
}

export function createSettingsStore({ defaults, uiDefaults = {}, persist, enqueue = createSerialTaskQueue() }) {
  let settings = { ...defaults };
  let uiState = cloneUiState(uiDefaults);
  const enqueueTask = enqueue;

  const getSettings = () => ({ ...settings });
  const getUiState = () => cloneUiState(uiState);

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
      uiState = cloneUiState({ ...uiState, ...patch });
      return getUiState();
    },
    enqueue(task) {
      return enqueueTask(task);
    },
    save() {
      const snapshot = getSettings();
      return enqueueTask(() => persist(snapshot));
    },
    saveLatest() {
      return enqueueTask(() => persist(getSettings()));
    },
  };
}
