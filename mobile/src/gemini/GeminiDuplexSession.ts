// Compatibility name for the product architecture docs: the Gemini voice engine
// supports three transports inside GeminiLiveSession:
// - text: cheap REST turn mode
// - live: Live WebSocket with text output
// - duplex: Live WebSocket with WebAudio PCM mic input and PCM playback
export { GeminiLiveSession as GeminiDuplexSession, GeminiLiveSession } from './GeminiLiveSession';
