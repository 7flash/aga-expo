import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: 'AGA',
        headerStyle: { backgroundColor: '#130f2f' },
        headerTintColor: '#fff7ed',
        headerShadowVisible: false,
      }}
    />
  );
}
