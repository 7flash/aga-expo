declare const require: any;

type ShareResult = {
  copied: boolean;
  shared: boolean;
  savedUri?: string;
  note: string;
};

function optionalRequire(name: string) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

export async function copyOrShareText(filename: string, text: string): Promise<ShareResult> {
  const Clipboard = optionalRequire('expo-clipboard');
  if (Clipboard?.setStringAsync) {
    await Clipboard.setStringAsync(text);
    return { copied: true, shared: false, note: 'copied to clipboard' };
  }

  const FileSystem = optionalRequire('expo-file-system');
  const Sharing = optionalRequire('expo-sharing');
  if (FileSystem?.writeAsStringAsync && FileSystem?.cacheDirectory) {
    const uri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8' });
    if (Sharing?.isAvailableAsync && Sharing?.shareAsync && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Share AGA backup' });
      return { copied: false, shared: true, savedUri: uri, note: 'opened the share sheet' };
    }
    return { copied: false, shared: false, savedUri: uri, note: 'saved a cache file, but sharing is unavailable' };
  }

  return { copied: false, shared: false, note: 'clipboard/share modules are not installed' };
}
