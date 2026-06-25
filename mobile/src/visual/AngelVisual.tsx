import React from 'react';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
};

/**
 * Universal avatar surface.
 *
 * Web is only our app test harness, so it must render the same angel as the APK.
 * This intentionally does not branch to a web-only canvas/GL avatar.
 */
export function AngelVisual(props: Props) {
  return <AgaAvatarZen {...props} />;
}
