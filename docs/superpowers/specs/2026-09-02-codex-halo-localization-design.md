# Codex Halo Localization and README Variants

**Date:** 2026-09-02  
**Status:** Approved
**Target:** Existing macOS and Windows Tauri desktop companion app

## 1. Scope

Add two user-facing language choices without changing overlay behavior or the
settings file's existing numeric and boolean controls:

- Keep `README.md` as the English guide.
- Add `README.zh-CN.md` as the Simplified Chinese guide.
- Add an in-app language selector with `English` and `简体中文`.
- Persist the selected language in the existing local settings JSON.
- Localize the settings window and the tray menu.

The default language is English (`en`), including first launch and old settings
files that do not contain a language field.

## 2. User-Visible Behavior

The settings window gets a native language selector. Changing it immediately
updates:

- window title and document language;
- headings, field labels, curve names, buttons, and state simulator labels;
- hook status, diagnostics, timestamps, and safe setup-error text;
- the tray menu labels and the settings window title.

The overlay remains text-free. Mathematical formulas remain mathematical; only
the surrounding formula label and accessibility text are localized.

Language changes use the existing settings save path. The Rust process emits
the existing `settings-changed` event, so the settings window and overlay stay
consistent. No new Tauri command or network dependency is added.

## 3. Settings Contract

Extend `AppSettings` with:

```json
"language": "en"
```

Supported values are `en` and `zh-CN`.

- Missing `language` values deserialize from `AppSettings::default()` as `en`.
- Unsupported values normalize to `en`.
- Existing settings fields and their bounds stay unchanged.
- The normalized value is written back through the current atomic settings
  persistence path.

The frontend default object must include `language: 'en'` so renderer and
settings fallback behavior match the Rust default.

## 4. Frontend Design

Add one small pure frontend localization module. It owns:

- supported language identifiers and normalization;
- static settings-page strings;
- curve and state display names;
- hook-status labels;
- setup-error formatting by language.

`settings.html` keeps one DOM tree. Static elements carry translation keys;
`settings.js` applies the selected dictionary and updates `document.documentElement.lang`.
Dynamic status rendering reads the current language instead of embedding
English strings.

The existing settings event handlers remain in place. The language selector is
included in `readSettings()`, so it is serialized by `save_settings` and does
not need a special save command. Programmatic `applySettings()` calls update
the selector without dispatching another change event.

## 5. Native Tray Design

The tray menu is still created once, but its menu-item handles are retained in
a small managed state object. A language update changes their text in place.
The overlay toggle label also reflects the current `enabled` value in both
languages.

`apply_settings_to_overlay()` remains the single synchronization point. After a
successful settings write it:

1. applies position and visibility;
2. refreshes the tray labels and settings window title;
3. emits `settings-changed` to `main` and `settings`.

If a tray label update fails, the settings save still succeeds; the failure is
logged locally and does not affect overlay state.

## 6. README Structure

`README.md` and `README.zh-CN.md` contain the same sections and operational
facts:

- local run commands;
- Codex hook installation, trust, and removal behavior;
- diagnostics export and privacy boundary;
- Windows packaging/runtime verification limits;
- attribution.

Each file links to the other near the title. No generated translation process
or runtime dependency is introduced.

## 7. Verification

Add focused checks for:

- Rust default, normalization, and JSON serialization of `language`;
- frontend default language and unsupported-language fallback;
- presence of both README variants and cross-links;
- language selector and translation keys in the settings document;
- localized status/error rendering contracts.

Run the existing JavaScript tests and renderer check, plus the relevant Rust
tests and `cargo check`. Windows-only runtime behavior remains unverified on a
macOS runner.

## 8. Explicit Exclusions

- No language auto-detection from the operating system.
- No language field in hook snapshots or diagnostics exports.
- No translation of the overlay canvas, formulas, source identifiers, or
  developer console messages.
- No i18n package, cloud service, or additional persistence store.
