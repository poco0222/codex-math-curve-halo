export function createSettingsBridge({
  invoke,
  listen,
  warn = console.warn.bind(console),
  onFailure = () => {},
}) {
  const warnFailure = (name) => warn(`Codex Halo: ${name} failed`);
  const reportFailure = (name, error) => {
    warnFailure(name);
    onFailure(name, error);
  };

  return {
    async command(name, args) {
      if (typeof invoke !== 'function') {
        reportFailure(name, undefined);
        return { ok: false, value: null };
      }
      try {
        return { ok: true, value: await invoke(name, args) };
      } catch (error) {
        reportFailure(name, error);
        return { ok: false, value: null };
      }
    },
    subscribe(event, handler) {
      if (typeof listen !== 'function') return undefined;
      return listen(event, handler);
    },
  };
}
