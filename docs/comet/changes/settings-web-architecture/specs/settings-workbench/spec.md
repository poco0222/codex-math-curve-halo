# Settings Workbench

## Requirement: Extensible settings shell

The settings page SHALL use a single-window App Shell with a stable navigation area, global controls, and one active content View.

### Scenario: Open settings

- **WHEN** the settings page opens
- **THEN** the App Shell shows the Codex Halo identity, the global Overlay toggle, language selector, and save status
- **AND** the default View is `Appearance`
- **AND** only the active View is mounted in the content host

### Scenario: Navigate between Views

- **WHEN** the user selects `Appearance`, `State colors`, `Integration`, or `Test`
- **THEN** the selected View replaces the previous View in the content host
- **AND** the active navigation item exposes the selected state
- **AND** focus and keyboard navigation remain available

## Requirement: Appearance View

The `Appearance` View SHALL group the current Display and Renderer settings into one coherent work area.

### Scenario: Configure appearance

- **WHEN** the `Appearance` View is active
- **THEN** the user can see and edit curve profile, opacity, offsets, particle count, trail span, loop timing, pulse timing, rotation timing, and stroke width
- **AND** the active formula remains visible as feedback for renderer settings
- **AND** existing control IDs, names, and setting keys remain usable by the controller

## Requirement: State colors Master-Detail editor

The `State colors` View SHALL use a Master-Detail layout for the six existing Halo states.

### Scenario: Scan color states

- **WHEN** the `State colors` View is active
- **THEN** the state list shows `idle`, `thinking`, `executing`, `input_needed`, `completed`, and `compacting`
- **AND** each row shows the localized state label, current color swatch, and current Hex value
- **AND** exactly one row is selected

### Scenario: Edit selected state

- **WHEN** the user selects a state row
- **THEN** the detail panel shows that state's preview, native color picker, Hex input, reset action, and preset palette disclosure
- **AND** changing the picker, valid Hex input, preset, or reset action updates only the selected state's color
- **AND** the change uses the existing automatic save path

### Scenario: Extend state details

- **WHEN** a future state-level setting such as audio linkage or state-specific animation is added
- **THEN** it can be added to the selected state's detail context without changing the state list interaction
- **AND** the current six-state color contract remains intact

### Scenario: Use colors on a narrow viewport

- **WHEN** the available width is below the desktop layout threshold
- **THEN** the state list and detail panel stack vertically
- **AND** the page does not require document-level horizontal scrolling
- **AND** the selected state, editor controls, and validation message remain visible

## Requirement: Shared settings state and bridge

The frontend SHALL keep settings data, UI state, and Tauri communication as separate responsibilities.

### Scenario: Load settings

- **WHEN** the page loads
- **THEN** the Tauri Bridge requests the complete `AppSettings` value
- **AND** the shared settings state becomes the source of truth for mounted and unmounted controls
- **AND** the active View renders from that state

### Scenario: Save a setting

- **WHEN** the user changes a setting
- **THEN** the shared settings state is updated
- **AND** save requests remain serialized through the existing queue
- **AND** the UI exposes ready, saving, saved, and error feedback

### Scenario: Receive an external settings update

- **WHEN** a `settings-changed` event contains a complete or partial payload
- **THEN** the payload merges into the shared settings state
- **AND** unmounted values and inactive state colors are not erased
- **AND** the active control is not unexpectedly overwritten while it is being edited

### Scenario: Add a future settings View

- **WHEN** a future domain such as default position or audio is introduced
- **THEN** the frontend can register a new View and its field bindings without duplicating save, error, localization, or event synchronization logic
- **AND** native fields, commands, or events are added only by a separate capability change

## Requirement: Behavior and accessibility preservation

The redesign SHALL preserve current behavior and provide accessible, localized controls.

### Scenario: Preserve existing actions

- **WHEN** the user installs or uninstalls the Plugin, exports diagnostics, resets position, or simulates a state
- **THEN** the existing Tauri commands and result handling remain unchanged

### Scenario: Localize the settings page

- **WHEN** the user switches between `en` and `zh-CN`
- **THEN** shell labels, View labels, form labels, state labels, preset labels, status text, and diagnostics are localized
- **AND** localized text wraps without overlap or loss of focus

### Scenario: Use keyboard controls

- **WHEN** the user navigates the shell, View navigation, state list, and form controls with a keyboard
- **THEN** focus order follows the DOM order
- **AND** active navigation and selected state are announced through appropriate ARIA state
- **AND** visible focus remains clear
