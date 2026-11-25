// Loads a .tflite file that is bundled with the app.
// In a release APK, bundled files live inside Android resources (res/raw), and react-native-fast-tflite
// cannot open that resource name directly ("MalformedURLException: no protocol").
// expo-asset copies the file to the app cache and returns a normal file:// path, which works in
// both development and release builds.
import { Asset } from 'expo-asset';
import { loadTensorflowModel, TfliteModel } from 'react-native-fast-tflite';

export async function loadBundledModel(moduleId: number): Promise<TfliteModel> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri.startsWith('file://') && !uri.startsWith('http')) {
    throw new Error(`Model file could not be prepared (got "${uri}")`);
  }
  return loadTensorflowModel({ url: uri }, []);
}
