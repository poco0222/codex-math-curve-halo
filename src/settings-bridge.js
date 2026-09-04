export function createSettingsBridge({
  invoke,
  listen,
  warn = console.warn.bind(console),
}) {
  return {
    async command(name, args) {
      if (typeof invoke !== 'function') return { ok: false, value: null };
      try {
        return { ok: true, value: await invoke(name, args) };
      } catch (error) {
        warn(`Codex Halo: ${name} failed`);
        return { ok: false, value: null };
      }
    },
    subscribe(event, handler) {
      if (typeof listen !== 'function') return undefined;
      return listen(event, handler);
    },
  };
}
