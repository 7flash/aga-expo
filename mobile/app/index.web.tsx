import { View } from 'react-native';
import { AgaErrorBoundary } from '../src/ui/AgaErrorBoundary';
import { AgaZenScreen } from '../src/ui/AgaZenScreen';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, minHeight: '100dvh' as any }}>
      <AgaErrorBoundary>
        <AgaZenScreen />
      </AgaErrorBoundary>
    </View>
  );
}
