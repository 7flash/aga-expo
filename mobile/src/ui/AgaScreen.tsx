// Compatibility shim: every old import of src/ui/AgaScreen now renders the Zen UI.
// Keep the legacy/debug screen under a different filename if you still need it.
export { AgaZenScreen as AgaScreen } from './AgaZenScreen';
export { AgaZenScreen as default } from './AgaZenScreen';
