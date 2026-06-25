import { View } from 'react-native';
import { AgaScreen } from '../src/ui/AgaScreen';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, minHeight: '100dvh' as any }}>
      <AgaScreen />
    </View>
  );
}
