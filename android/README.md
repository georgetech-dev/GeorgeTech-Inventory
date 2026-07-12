# GeorgeTech Inventory Android Wrapper

Open this `android` folder in Android Studio.

The app is a native Android WebView shell for:

```text
https://parts.georgetech.uk/index.html
```

## Supported Native Capabilities

- Camera permission for barcode scanning and photo capture.
- File picker/camera capture support for `<input type="file">`.
- NFC foreground dispatch.
- Android NFC tags are bridged into the existing web `NDEFReader` flow.
- Network access for Supabase and external scanner libraries.

## Build

1. Open `android/` in Android Studio.
2. Let Android Studio sync Gradle.
3. Run the `app` configuration on a device.

Use a real Android device for camera and NFC testing. The emulator is fine for basic WebView layout checks, but not for NFC.
