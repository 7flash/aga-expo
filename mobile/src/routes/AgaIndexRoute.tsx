import { AgaZenScreen } from '../ui/AgaZenScreen';
import { AgaErrorBoundary } from '../ui/AgaErrorBoundary';

export default function AgaIndexRoute() {
  return (
    <AgaErrorBoundary>
      <AgaZenScreen />
    </AgaErrorBoundary>
  );
}
