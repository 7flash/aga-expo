import { AgaErrorBoundary } from '../src/ui/AgaErrorBoundary';
import { AgaZenScreen } from '../src/ui/AgaZenScreen';

export default function Index() {
  return (
    <AgaErrorBoundary>
      <AgaZenScreen />
    </AgaErrorBoundary>
  );
}
