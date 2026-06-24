package uk.fieldhub.inventory;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.Size;
import android.view.Gravity;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.lifecycle.LiveData;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CameraActivity extends androidx.appcompat.app.AppCompatActivity {
    private static final int REQUEST_CAMERA = 2101;
    private static final String PREFS = "fieldhub_camera";
    private static final String PREF_CAMERA_ID = "camera_id";
    private static final String PREF_ZOOM = "zoom_ratio";

    private PreviewView previewView;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;
    private final List<CameraInfo> cameras = new ArrayList<>();
    private int cameraIndex;
    private int flashMode = ImageCapture.FLASH_MODE_AUTO;
    private float currentZoom = 1f;
    private boolean settingsDirty;
    private boolean adjustingZoom;
    private Button lensButton;
    private Button flashButton;
    private Button saveButton;
    private Button shutterButton;
    private SeekBar zoomSlider;
    private TextView zoomLabel;
    private ExecutorService cameraExecutor;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(15, 23, 42));
        getWindow().setNavigationBarColor(Color.rgb(15, 23, 42));
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        currentZoom = preferences.getFloat(PREF_ZOOM, 1f);
        cameraExecutor = Executors.newSingleThreadExecutor();
        buildInterface();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCameraProvider();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
        }
    }

    private void buildInterface() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        Button close = cameraButton("Close");
        close.setOnClickListener(view -> cancelCamera());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(76), dp(44), Gravity.TOP | Gravity.END);
        closeParams.setMargins(0, dp(16), dp(16), 0);
        root.addView(close, closeParams);

        zoomLabel = new TextView(this);
        zoomLabel.setTextColor(Color.WHITE);
        zoomLabel.setTextSize(13);
        zoomLabel.setGravity(Gravity.CENTER);
        zoomLabel.setBackground(roundRect(0xAA0F172A, dp(18), 0, 0));
        FrameLayout.LayoutParams zoomLabelParams = new FrameLayout.LayoutParams(dp(72), dp(34), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        zoomLabelParams.setMargins(0, dp(22), 0, 0);
        root.addView(zoomLabel, zoomLabelParams);

        zoomSlider = new SeekBar(this);
        zoomSlider.setMax(1000);
        zoomSlider.setRotation(-90f);
        zoomSlider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (!fromUser || camera == null) return;
                adjustingZoom = true;
                ZoomState state = camera.getCameraInfo().getZoomState().getValue();
                if (state == null) return;
                float ratio = state.getMinZoomRatio() + ((state.getMaxZoomRatio() - state.getMinZoomRatio()) * progress / 1000f);
                setZoom(ratio, true);
                adjustingZoom = false;
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });
        FrameLayout.LayoutParams sliderParams = new FrameLayout.LayoutParams(dp(240), dp(48), Gravity.CENTER_VERTICAL | Gravity.END);
        sliderParams.setMargins(0, 0, -dp(76), 0);
        root.addView(zoomSlider, sliderParams);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(dp(12), dp(10), dp(12), dp(18));
        controls.setBackgroundColor(0xAA0F172A);

        lensButton = cameraButton("Lens");
        lensButton.setOnClickListener(view -> switchCamera());
        controls.addView(lensButton, weightedParams(1));

        flashButton = cameraButton("Flash: Auto");
        flashButton.setOnClickListener(view -> cycleFlash());
        controls.addView(flashButton, weightedParams(1));

        shutterButton = new Button(this);
        shutterButton.setContentDescription("Take photo");
        shutterButton.setText("");
        shutterButton.setBackground(roundRect(Color.WHITE, dp(40), Color.WHITE, dp(5)));
        shutterButton.setOnClickListener(view -> takePhoto());
        LinearLayout.LayoutParams shutterParams = new LinearLayout.LayoutParams(dp(76), dp(76));
        shutterParams.setMargins(dp(14), 0, dp(14), 0);
        controls.addView(shutterButton, shutterParams);

        saveButton = cameraButton("Save settings");
        saveButton.setVisibility(View.INVISIBLE);
        saveButton.setOnClickListener(view -> saveSettings());
        controls.addView(saveButton, weightedParams(1));

        FrameLayout.LayoutParams controlsParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(controls, controlsParams);
        setContentView(root);

        ScaleGestureDetector scaleDetector = new ScaleGestureDetector(this,
                new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    @Override public boolean onScale(ScaleGestureDetector detector) {
                        if (camera == null) return false;
                        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
                        if (state == null) return false;
                        setZoom(state.getZoomRatio() * detector.getScaleFactor(), true);
                        return true;
                    }
                });
        previewView.setOnTouchListener((view, event) -> {
            scaleDetector.onTouchEvent(event);
            return true;
        });
    }

    private void startCameraProvider() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                cameras.clear();
                cameras.addAll(cameraProvider.getAvailableCameraInfos());
                cameras.sort(Comparator.comparing(this::cameraId));
                String savedId = preferences.getString(PREF_CAMERA_ID, "");
                cameraIndex = 0;
                for (int index = 0; index < cameras.size(); index++) {
                    if (cameraId(cameras.get(index)).equals(savedId)) cameraIndex = index;
                }
                bindSelectedCamera();
            } catch (Exception error) {
                Toast.makeText(this, "Unable to start camera", Toast.LENGTH_LONG).show();
                cancelCamera();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindSelectedCamera() {
        if (cameraProvider == null || cameras.isEmpty()) return;
        cameraProvider.unbindAll();
        CameraInfo selectedInfo = cameras.get(cameraIndex);
        CameraSelector selector = new CameraSelector.Builder()
                .addCameraFilter(infos -> infos.contains(selectedInfo)
                        ? Collections.singletonList(selectedInfo) : Collections.emptyList())
                .build();
        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        imageCapture = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setFlashMode(flashMode)
                .build();
        try {
            camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture);
            camera.getCameraInfo().getZoomState().observe(this, state -> {
                if (state == null) return;
                currentZoom = state.getZoomRatio();
                zoomLabel.setText(String.format(Locale.UK, "%.1fx", currentZoom));
                if (!adjustingZoom && state.getMaxZoomRatio() > state.getMinZoomRatio()) {
                    int progress = Math.round(1000f * (currentZoom - state.getMinZoomRatio())
                            / (state.getMaxZoomRatio() - state.getMinZoomRatio()));
                    zoomSlider.setProgress(Math.max(0, Math.min(1000, progress)));
                }
            });
            lensButton.setText(cameraLabel(selectedInfo));
            lensButton.setEnabled(cameras.size() > 1);
            setZoom(currentZoom, false);
            applyFlashUi();
        } catch (Exception error) {
            Toast.makeText(this, "This camera is unavailable", Toast.LENGTH_SHORT).show();
        }
    }

    private void switchCamera() {
        if (cameras.size() < 2) return;
        cameraIndex = (cameraIndex + 1) % cameras.size();
        currentZoom = 1f;
        settingsDirty = true;
        showSaveButton();
        bindSelectedCamera();
    }

    private void cycleFlash() {
        if (flashMode == ImageCapture.FLASH_MODE_OFF) flashMode = ImageCapture.FLASH_MODE_AUTO;
        else if (flashMode == ImageCapture.FLASH_MODE_AUTO) flashMode = ImageCapture.FLASH_MODE_ON;
        else flashMode = ImageCapture.FLASH_MODE_OFF;
        if (imageCapture != null) imageCapture.setFlashMode(flashMode);
        applyFlashUi();
    }

    private void applyFlashUi() {
        boolean hasFlash = camera != null && camera.getCameraInfo().hasFlashUnit();
        flashButton.setEnabled(hasFlash);
        String label = flashMode == ImageCapture.FLASH_MODE_ON ? "Flash: On"
                : flashMode == ImageCapture.FLASH_MODE_OFF ? "Flash: Off" : "Flash: Auto";
        flashButton.setText(hasFlash ? label : "No flash");
        if (camera != null) camera.getCameraControl().enableTorch(hasFlash && flashMode == ImageCapture.FLASH_MODE_ON);
    }

    private void setZoom(float requestedZoom, boolean dirty) {
        if (camera == null) return;
        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
        if (state == null) return;
        float clamped = Math.max(state.getMinZoomRatio(), Math.min(state.getMaxZoomRatio(), requestedZoom));
        camera.getCameraControl().setZoomRatio(clamped);
        currentZoom = clamped;
        if (dirty) {
            settingsDirty = true;
            showSaveButton();
        }
    }

    private void takePhoto() {
        if (imageCapture == null || shutterButton == null) return;
        shutterButton.setEnabled(false);
        try {
            File output = File.createTempFile("fieldhub-camera-", ".jpg", getCacheDir());
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", output);
            ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(output).build();
            imageCapture.takePicture(options, cameraExecutor, new ImageCapture.OnImageSavedCallback() {
                @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults result) {
                    runOnUiThread(() -> {
                        Intent data = new Intent();
                        data.setData(uri);
                        data.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        setResult(Activity.RESULT_OK, data);
                        finish();
                    });
                }

                @Override public void onError(@NonNull androidx.camera.core.ImageCaptureException error) {
                    runOnUiThread(() -> {
                        shutterButton.setEnabled(true);
                        Toast.makeText(CameraActivity.this, "Photo capture failed", Toast.LENGTH_LONG).show();
                    });
                }
            });
        } catch (Exception error) {
            shutterButton.setEnabled(true);
            Toast.makeText(this, "Unable to create photo", Toast.LENGTH_LONG).show();
        }
    }

    private void saveSettings() {
        if (cameras.isEmpty()) return;
        preferences.edit()
                .putString(PREF_CAMERA_ID, cameraId(cameras.get(cameraIndex)))
                .putFloat(PREF_ZOOM, currentZoom)
                .apply();
        settingsDirty = false;
        saveButton.setVisibility(View.INVISIBLE);
        Toast.makeText(this, "Camera settings saved", Toast.LENGTH_SHORT).show();
    }

    private String cameraId(CameraInfo info) {
        try { return Camera2CameraInfo.from(info).getCameraId(); }
        catch (Exception ignored) { return String.valueOf(cameras.indexOf(info)); }
    }

    private String cameraLabel(CameraInfo info) {
        Integer facing = info.getLensFacing();
        String side = facing != null && facing == CameraSelector.LENS_FACING_FRONT ? "Front" : "Rear";
        return side + " " + cameraId(info);
    }

    private void showSaveButton() {
        saveButton.setVisibility(settingsDirty ? View.VISIBLE : View.INVISIBLE);
    }

    private Button cameraButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(roundRect(0xCC0F172A, dp(10), 0x66FFFFFF, dp(1)));
        return button;
    }

    private LinearLayout.LayoutParams weightedParams(float weight) {
        return new LinearLayout.LayoutParams(0, dp(48), weight);
    }

    private GradientDrawable roundRect(int fill, int radius, int stroke, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) drawable.setStroke(strokeWidth, stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void cancelCamera() {
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    @Override
    public void onBackPressed() {
        cancelCamera();
    }

    @Override
    protected void onDestroy() {
        if (camera != null) camera.getCameraControl().enableTorch(false);
        if (cameraProvider != null) cameraProvider.unbindAll();
        if (cameraExecutor != null) cameraExecutor.shutdown();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_CAMERA) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) startCameraProvider();
        else cancelCamera();
    }
}
