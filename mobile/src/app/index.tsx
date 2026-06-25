import { AgaZenScreen } from '../ui/AgaZenScreen';
import { AgaErrorBoundary } from '../ui/AgaErrorBoundary';

export default function Index() {
  return (
    <AgaErrorBoundary>
      <AgaZenScreen />
    </AgaErrorBoundary>
  );
}
