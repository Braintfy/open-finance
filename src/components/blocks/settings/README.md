# Block Settings UI Design System

Shared primitives and utilities for all block `SettingsForm` components.
Import from `@/components/blocks/settings`.

## Rule: always use these primitives (never roll your own)

| Need | Use |
|------|-----|
| Any boolean toggle | `SettingsToggleRow` |
| showKopecks toggle | `KopecksRow` |
| 3–12 exclusive options | `SettingsSegmented` |
| Range slider + number | `SettingsSliderRow` |
| Labelled section header | `SettingsSection` |
| Block source picker | `SourceBlockPicker` |

## Spacing convention

```
<div className="space-y-4">   {/* form root */}
  <SettingsSection label="...">
    {/* space-y-2 inside each section if multiple items */}
  </SettingsSection>
</div>
```

## Primitives

### `SettingsToggleRow`
Bordered row with a label, description, Switch, and optional Reset button.

```tsx
<SettingsToggleRow
  label="Header-строка"
  description="Ячейки сверху с названием и итогами"
  checked={cfg.showHeader}
  onCheckedChange={(v) => set('showHeader', v)}
/>
```

### `KopecksRow`
Specialised toggle for `showKopecks: boolean | null`:
- `null`/`undefined` → "Глобальная настройка" (Reset hidden)
- `true` → "1 234,56 ₽"
- `false` → "1 235 ₽"

```tsx
<KopecksRow value={cfg.showKopecks} onChange={(v) => set('showKopecks', v)} />
```

### `SettingsSegmented`
Button grid for mutually-exclusive options. Uses shadcn `Button variant="default|outline"`.

```tsx
<SettingsSegmented
  value={cfg.format ?? 'auto'}
  onChange={(v) => set('format', v)}
  options={[
    { value: 'auto', label: 'Авто' },
    { value: 'rub', label: '₽' },
    { value: 'int', label: '123' },
    { value: 'percent', label: '%' },
  ]}
  cols={4}
/>
```

### `SettingsSliderRow`
Range slider + number input combo.

```tsx
<SettingsSliderRow
  label="Строк"
  value={cfg.rows}
  min={1}
  max={100}
  onChange={(v) => set('rows', v)}
/>
```

### `SourceBlockPicker`
Shared block/field picker panel with sidebar, period badges, collapsible Cells sections.
Used inline in `BlockReferencePicker` (Связи tab) and inside Dialog in `excel-cell` / `sheet`.

```tsx
<SourceBlockPicker
  excludeBlockIds={new Set([instance.id])}
  showKopecks={showKopecks}
  open={pickerOpen}
  onPick={(block, field) => handlePick(block, field)}
/>
```

## Source utilities (`source-field-label.ts`)

- `sourceFieldLabel(field)` — human label for common field names
- `previewSourceValue(field, showKopecks)` — formatted preview string
- `moneyFieldSet(blockId, liveValues)` — Set of money field names from `__money` marker
- `cellFieldSet(blockId, liveValues)` — Set of per-cell field names from `__cellFields` marker
- `mergeLiveFields(block, liveFields, liveValues, liveLabels)` — enrich API block with live store data

## Adding a new block

1. Import from `@/components/blocks/settings`.
2. Use `space-y-4` at the `SettingsForm` root div.
3. Wrap logical groups in `SettingsSection`.
4. Use `SettingsToggleRow` for all boolean settings.
5. Use `KopecksRow` if the block has a `showKopecks` config field.
6. Use `SettingsSegmented` for 3–6 exclusive options.
7. Never use: hand-rolled pill buttons, native `<input type="checkbox">`, raw switch divs.
