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
  let settings = structuredClone(defaults);
  let uiState = cloneUiState(uiDefaults);
  const enqueueTask = enqueue;

  const getSettings = () => structuredClone(settings);
  const getUiState = () => cloneUiState(uiState);

  return {
    getSettings,
    getUiState,
    replaceSettings(value) {
      settings = structuredClone({ ...defaults, ...value });
      return getSettings();
    },
    mergeSettings(patch) {
      settings = structuredClone({ ...settings, ...patch });
      return getSettings();
    },
    patchSetting(key, value) {
      settings[key] = structuredClone(value);
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
