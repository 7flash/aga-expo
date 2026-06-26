// Canonical parser compatibility layer.
// The appliance runtime uses Porcupine for hot-word controls and capabilityRunner
// for actions. This file now delegates to the cleaner Zen parser so actions.ts
// and actions.zen.ts cannot drift.
export * from './actions.zen';
