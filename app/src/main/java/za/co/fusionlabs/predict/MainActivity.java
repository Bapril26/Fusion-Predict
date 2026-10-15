package za.co.fusionlabs.predict;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/**
 * Fusion Predict – hosts the offline app (assets/www) in a WebView.
 * Pages are served from https://appassets.androidplatform.net (a secure context),
 * so the in-app camera (getUserMedia) and HTTPS calls to the AI service work.
 */
public class MainActivity extends Activity {
    private static final int REQ_PHOTO = 1001;
    private static final int REQ_CAMERA_PERMISSION = 2001;
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/assets/www/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingWebPermission;
    private Uri cameraUri;
    private BillingManager billing;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);

        // Android 15+ draws apps edge-to-edge: pad the content so it stays clear of the
        // status bar, navigation bar and keyboard.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F6FA"));
        root.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((View v, WindowInsets insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);

        // Android 13+ back gesture (required for apps targeting Android 16)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = () -> {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else finish();
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }

        // Google Play subscriptions (Fusion Predict Pro)
        billing = new BillingManager(this, this::sendBillingEvent);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        // Let the live camera preview play without an extra tap
        s.setMediaPlaybackRequiresUserGesture(false);

        // Small bridge so the app can check/request camera access and open settings
        webView.addJavascriptInterface(new NativeBridge(), "HPNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost())) return false;
                // Store links etc. open in the phone's browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // In-app camera preview (navigator.mediaDevices.getUserMedia)
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermission == request) pendingWebPermission = null;
            }

            // Gallery upload (and camera app, when camera permission is already granted)
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;

                Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
                gallery.addCategory(Intent.CATEGORY_OPENABLE);
                gallery.setType("image/*");
                Intent chooser = Intent.createChooser(gallery, "Choose a match screenshot");

                // Because the app declares CAMERA, the camera-app intent may only be
                // offered once that permission is granted (otherwise Android throws).
                cameraUri = null;
                if (hasCameraPermission()) {
                    try {
                        File dir = new File(getCacheDir(), "photos");
                        //noinspection ResultOfMethodCallIgnored
                        dir.mkdirs();
                        File photo = File.createTempFile("match_", ".jpg", dir);
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", photo);
                        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                    } catch (IOException | IllegalArgumentException e) {
                        cameraUri = null;
                    }
                }
                try {
                    startActivityForResult(chooser, REQ_PHOTO);
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasCameraHardware() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
    }

    private void handleWebPermission(PermissionRequest request) {
        // Only our own pages may use the camera
        Uri origin = request.getOrigin();
        if (origin == null || !APP_HOST.equals(origin.getHost())) {
            request.deny();
            return;
        }
        boolean wantsVideo = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        }
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (hasCameraPermission()) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            if (pendingWebPermission != null) pendingWebPermission.deny();
            pendingWebPermission = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERMISSION);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CAMERA_PERMISSION) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingWebPermission != null) {
            if (granted) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
        final String status = granted ? "granted" : (shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) ? "denied" : "blocked");
        webView.post(() -> webView.evaluateJavascript(
                "window.HPCameraPermission && window.HPCameraPermission('" + status + "')", null));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PHOTO || pendingFileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        }
        pendingFileCallback.onReceiveValue(result);
        pendingFileCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void sendBillingEvent(JSONObject event) {
        final String js = "window.HPBilling && window.HPBilling(" + JSONObject.quote(event.toString()) + ")";
        runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
    }

    @Override
    protected void onDestroy() {
        if (billing != null) billing.destroy();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    /** Methods callable from the app's JavaScript as window.HPNative.* */
    private class NativeBridge {
        /** "granted", "prompt" or "none" (no camera on this device) */
        @JavascriptInterface
        public String cameraStatus() {
            if (!hasCameraHardware()) return "none";
            return hasCameraPermission() ? "granted" : "prompt";
        }

        /** Shows the Android permission dialog; the result arrives via window.HPCameraPermission(status) */
        @JavascriptInterface
        public void requestCamera() {
            runOnUiThread(() -> {
                if (hasCameraPermission()) {
                    webView.evaluateJavascript("window.HPCameraPermission && window.HPCameraPermission('granted')", null);
                } else {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERMISSION);
                }
            });
        }

        /** Opens this app's page in Android Settings so the user can allow the camera */
        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }

        /** True only in sideloaded test APKs: shows the "Turn on Pro for testing" switch */
        @JavascriptInterface
        public boolean isTestBuild() {
            return BuildConfig.TEST_UNLOCK;
        }

        /** Loads Pro prices from Google Play and checks for an active subscription */
        @JavascriptInterface
        public void billingRefresh() {
            runOnUiThread(() -> billing.refresh());
        }

        /** basePlanId: "monthly" or "yearly" */
        @JavascriptInterface
        public void billingBuy(final String basePlanId) {
            runOnUiThread(() -> billing.buy(basePlanId));
        }

        @JavascriptInterface
        public void billingRestore() {
            runOnUiThread(() -> billing.checkPurchases());
        }
    }
}
