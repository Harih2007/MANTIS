# MANTIS

MANTIS is an assistive wayfinding prototype that combines voice interaction,
camera-based object recognition, and spoken guidance to help users find
remembered objects in their environment.

## Project layout

- `index.html`, `styles.css`, `app.js` — web application UI and interaction logic
- `object-search.js`, `vision-worker.js` — object-search and vision runtime
- `android-benchmark/` — Android WebView wrapper used to run the app on-device
- `asset/` — original Stitch design references and screen assets

## Run the web app

Open `index.html` in a local web server (for example, VS Code Live Server).
Camera and microphone permissions are required for object search and voice
input.

## Build the Android prototype

From `android-benchmark/`, run:

```powershell
./gradlew assembleDebug
```

The debug APK is generated at
`android-benchmark/app/build/outputs/apk/debug/app-debug.apk`.

## Notes

Build outputs, Gradle caches, and large local model/media files are excluded by
`.gitignore`.
