export function createSettingsBridge({
  invoke,
  listen,
  warn = console.warn.bind(console),
}) {
  const warnFailure = (name) => warn(`Codex Halo: ${name} failed`);

  return {
    async command(name, args) {
      if (typeof invoke !== 'function') {
        warnFailure(name);
        return { ok: false, value: null };
      }
      try {
        return { ok: true, value: await invoke(name, args) };
      } catch (error) {
        warnFailure(name);
        return { ok: false, value: null };
      }
    },
    subscribe(event, handler) {
      if (typeof listen !== 'function') return undefined;
      return listen(event, handler);
    },
  };
}
