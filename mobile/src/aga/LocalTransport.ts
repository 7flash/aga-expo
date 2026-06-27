// Compatibility shim.
// The live local implementation is src/voice/LocalTransport.ts so local voice
// transport behavior cannot drift from the single voice transport contract.
export { LocalTransport } from '../voice/LocalTransport';
export type { VoiceTransport, VoiceTransportSnapshot } from '../voice/VoiceTransport';
