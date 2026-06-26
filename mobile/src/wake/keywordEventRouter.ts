import { keywordActionFromIndex, type AgaKeywordAction } from './keywordContract';

export type KeywordEventRouterHandlers = {
  onWake: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onUnknown?: (index: number) => void | Promise<void>;
};

export async function routePorcupineKeywordIndex(index: number, handlers: KeywordEventRouterHandlers) {
  const action = keywordActionFromIndex(index);
  if (!action) return handlers.onUnknown?.(index);
  return routeKeywordAction(action, handlers);
}

export async function routeKeywordAction(action: AgaKeywordAction, handlers: KeywordEventRouterHandlers) {
  if (action === 'wake') return handlers.onWake();
  if (action === 'stop') return handlers.onStop();
  if (action === 'pause') return handlers.onPause();
}
