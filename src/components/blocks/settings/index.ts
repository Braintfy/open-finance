// PURPOSE: Barrel export for shared block settings primitives and utilities.
// Import from '@/components/blocks/settings' in all SettingsForm components.

export {
  SettingsSection,
  SettingsToggleRow,
  KopecksRow,
  SettingsSegmented,
  SettingsSliderRow,
} from './primitives';

export {
  SourceBlockPicker,
  useAllBlockValues,
  _sourceBlockPickerCache,
} from './source-block-picker';

export type { SourceField, SourceBlock, SourcePage } from './types';

export {
  sourceFieldLabel,
  previewSourceValue,
  moneyFieldSet,
  cellFieldSet,
  mergeLiveFields,
  sourceFieldIsMoney,
} from './source-field-label';
