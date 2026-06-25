import { AgaZenScreen } from '../src/ui/AgaZenScreen';
import { AgaErrorBoundary } from '../src/ui/AgaErrorBoundary';

export default function Index() {
  return (
    <AgaErrorBoundary>
      <AgaZenScreen />
    </AgaErrorBoundary>
  );
}
