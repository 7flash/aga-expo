import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: 'AGA',
        headerStyle: { backgroundColor: '#080a20' },
        headerTintColor: '#fff',
        headerShadowVisible: false,
      }}
    />
  );
}
