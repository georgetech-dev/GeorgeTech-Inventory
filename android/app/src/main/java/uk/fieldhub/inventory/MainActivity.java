package uk.fieldhub.inventory;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.view.ViewGroup;
import android.widget.Toast;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://parts.fieldhub.uk/index.html";
    private static final int REQ_WEB_PERMISSION = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;

    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraCaptureUri;
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private long lastBackPressTime = 0L;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
        window.setStatusBarColor(0xFF3D8142);
        window.setNavigationBarColor(0xFF0F172A);
        setupWebView();
        setupNfc();
        webView.loadUrl(APP_URL);
    }

    private void setupWebView() {
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, bars.top, 0, bars.bottom);
            return insets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                injectNfcPolyfill();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                openFileChooser(fileChooserParams);
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return super.onConsoleMessage(consoleMessage);
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        boolean wantsCamera = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                wantsCamera = true;
                break;
            }
        }

        if (!wantsCamera || ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(request.getResources());
            return;
        }

        pendingWebPermission = request;
        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_WEB_PERMISSION);
    }

    private void openFileChooser(WebChromeClient.FileChooserParams params) {
        Intent contentIntent = params.createIntent();
        contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
        contentIntent.setType("image/*");

        Intent chooser = Intent.createChooser(contentIntent, "Select photo");
        Intent cameraIntent = createCameraIntent();
        if (cameraIntent != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
        }
        startActivityForResult(chooser, REQ_FILE_CHOOSER);
    }

    private Intent createCameraIntent() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_WEB_PERMISSION);
            return null;
        }

        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(getPackageManager()) == null) return null;

        try {
            File imageFile = File.createTempFile("fieldhub-camera-", ".jpg", getCacheDir());
            cameraCaptureUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", imageFile);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraCaptureUri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return intent;
        } catch (IOException e) {
            cameraCaptureUri = null;
            return null;
        }
    }

    private void setupNfc() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        Intent intent = new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        nfcPendingIntent = PendingIntent.getActivity(this, 0, intent, flags);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, null, null);
        }
    }

    @Override
    protected void onPause() {
        if (nfcAdapter != null) {
            nfcAdapter.disableForegroundDispatch(this);
        }
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String token = extractNfcToken(intent);
        if (token != null && !token.isEmpty()) {
            dispatchNfcToWeb(token);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastBackPressTime < 2500) {
            finish();
            return;
        }

        lastBackPressTime = now;
        Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WEB_PERMISSION && pendingWebPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingWebPermission.grant(pendingWebPermission.getResources());
            } else {
                pendingWebPermission.deny();
            }
            pendingWebPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE_CHOOSER || filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data == null || data.getData() == null) {
                if (cameraCaptureUri != null) results = new Uri[]{cameraCaptureUri};
            } else if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else {
                results = new Uri[]{data.getData()};
            }
        }

        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
        cameraCaptureUri = null;
    }

    private String extractNfcToken(Intent intent) {
        if (intent == null) return null;

        Parcelable[] messages = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
        if (messages != null) {
            for (Parcelable message : messages) {
                for (NdefRecord record : ((NdefMessage) message).getRecords()) {
                    String text = decodeTextRecord(record);
                    if (text != null && !text.isEmpty()) return text;
                }
            }
        }

        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        return tag != null ? bytesToHex(tag.getId()) : null;
    }

    private String decodeTextRecord(NdefRecord record) {
        if (record == null || record.getPayload() == null || record.getPayload().length == 0) return null;
        byte[] payload = record.getPayload();
        if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
            int languageLength = payload[0] & 0x3F;
            int textStart = 1 + languageLength;
            if (payload.length <= textStart) return null;
            boolean utf16 = (payload[0] & 0x80) != 0;
            return new String(payload, textStart, payload.length - textStart, Charset.forName(utf16 ? "UTF-16" : "UTF-8")).trim();
        }
        return new String(payload, Charset.forName("UTF-8")).trim();
    }

    private String bytesToHex(byte[] bytes) {
        if (bytes == null) return null;
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            builder.append(String.format(Locale.UK, "%02X", b));
        }
        return builder.toString();
    }

    private void injectNfcPolyfill() {
        String script =
                "(function(){"
                        + "if(window.__fieldHubNfcInstalled)return;"
                        + "window.__fieldHubNfcInstalled=true;"
                        + "window.__fieldHubNfcReaders=[];"
                        + "window.NDEFReader=function(){};"
                        + "window.NDEFReader.prototype.scan=function(options){"
                        + "var reader=this;"
                        + "window.__fieldHubNfcReaders.push(reader);"
                        + "if(options&&options.signal){options.signal.addEventListener('abort',function(){"
                        + "window.__fieldHubNfcReaders=window.__fieldHubNfcReaders.filter(function(r){return r!==reader;});"
                        + "});}"
                        + "return Promise.resolve();"
                        + "};"
                        + "window.__fieldHubDispatchNfc=function(text){"
                        + "var bytes=(window.TextEncoder?Array.from(new TextEncoder().encode(text)):text.split('').map(function(c){return c.charCodeAt(0);}));"
                        + "var payload=new Uint8Array(bytes.length+3);"
                        + "payload[0]=2;payload[1]=101;payload[2]=110;"
                        + "for(var i=0;i<bytes.length;i++)payload[i+3]=bytes[i];"
                        + "var event={serialNumber:text,message:{records:[{recordType:'text',data:payload.buffer}]}};"
                        + "window.__fieldHubNfcReaders.slice().forEach(function(reader){if(typeof reader.onreading==='function')reader.onreading(event);});"
                        + "window.dispatchEvent(new CustomEvent('fieldhub-native-nfc',{detail:text}));"
                        + "};"
                        + "})();";
        webView.evaluateJavascript(script, null);
    }

    private void dispatchNfcToWeb(String token) {
        if (webView == null) return;
        String script = "window.__fieldHubDispatchNfc && window.__fieldHubDispatchNfc(" + JSONObject.quote(token) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
