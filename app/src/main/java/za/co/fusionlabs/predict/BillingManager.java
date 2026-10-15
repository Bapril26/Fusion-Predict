package za.co.fusionlabs.predict;

import android.app.Activity;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing for Fusion Predict Pro.
 *
 * Play Console setup (Monetise → Subscriptions):
 *   Product ID  : fusionpredict_pro
 *   Base plans  : "monthly" (auto-renewing, 1 month) and "yearly" (auto-renewing, 1 year)
 *   Offer       : on "yearly", a 7-day free trial for new customers
 *
 * Results are sent to the app's JavaScript as window.HPBilling({...}).
 */
public class BillingManager implements PurchasesUpdatedListener {
    public static final String PRODUCT_ID = "fusionpredict_pro";

    public interface Sink { void send(JSONObject event); }

    private final Activity activity;
    private final Sink sink;
    private final BillingClient client;
    private ProductDetails proDetails;
    private boolean connecting = false;
    private Runnable afterConnect;

    public BillingManager(Activity activity, Sink sink) {
        this.activity = activity;
        this.sink = sink;
        this.client = BillingClient.newBuilder(activity)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
    }

    /** Connects (if needed) and then runs the task. */
    private void withConnection(Runnable task) {
        if (client.isReady()) { task.run(); return; }
        afterConnect = task;
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    Runnable r = afterConnect;
                    afterConnect = null;
                    if (r != null) r.run();
                } else {
                    afterConnect = null;
                    sendError("unavailable", "Google Play billing isn't available on this phone (" + result.getDebugMessage() + ").");
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
            }
        });
    }

    /** Loads plans and prices from Google Play, then checks for an existing subscription. */
    public void refresh() {
        withConnection(() -> {
            loadProducts();
            checkPurchases();
        });
    }

    private void loadProducts() {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(PRODUCT_ID)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build()))
                .build();
        client.queryProductDetailsAsync(params, (result, queryResult) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                sendError("products", "Couldn't load prices from Google Play (" + result.getDebugMessage() + ").");
                return;
            }
            List<ProductDetails> list = queryResult.getProductDetailsList();
            if (list == null || list.isEmpty()) {
                sendSimple("not_listed");
                return;
            }
            proDetails = list.get(0);
            sendPlans();
        });
    }

    private void sendPlans() {
        try {
            JSONArray plans = new JSONArray();
            List<ProductDetails.SubscriptionOfferDetails> offers = proDetails.getSubscriptionOfferDetails();
            if (offers != null) {
                for (ProductDetails.SubscriptionOfferDetails o : offers) {
                    JSONObject p = new JSONObject();
                    p.put("basePlanId", o.getBasePlanId());
                    p.put("offerId", o.getOfferId() == null ? "" : o.getOfferId());
                    JSONArray phases = new JSONArray();
                    for (ProductDetails.PricingPhase ph : o.getPricingPhases().getPricingPhaseList()) {
                        JSONObject j = new JSONObject();
                        j.put("price", ph.getFormattedPrice());
                        j.put("micros", ph.getPriceAmountMicros());
                        j.put("currency", ph.getPriceCurrencyCode());
                        j.put("period", ph.getBillingPeriod());
                        j.put("cycles", ph.getBillingCycleCount());
                        phases.put(j);
                    }
                    p.put("phases", phases);
                    plans.put(p);
                }
            }
            JSONObject e = new JSONObject();
            e.put("type", "plans");
            e.put("plans", plans);
            sink.send(e);
        } catch (JSONException ignored) { }
    }

    /** Opens the Google Play purchase sheet for "monthly" or "yearly". */
    public void buy(String basePlanId) {
        withConnection(() -> {
            if (proDetails == null) {
                sendSimple("not_listed");
                return;
            }
            List<ProductDetails.SubscriptionOfferDetails> offers = proDetails.getSubscriptionOfferDetails();
            String token = null;
            String baseOnlyToken = null;
            if (offers != null) {
                for (ProductDetails.SubscriptionOfferDetails o : offers) {
                    if (!basePlanId.equals(o.getBasePlanId())) continue;
                    // Prefer a special offer (e.g. the free trial) when the user is eligible; Google only returns eligible offers.
                    if (o.getOfferId() != null) token = o.getOfferToken();
                    else baseOnlyToken = o.getOfferToken();
                }
            }
            if (token == null) token = baseOnlyToken;
            if (token == null) {
                sendError("plan", "That plan isn't available right now.");
                return;
            }
            BillingFlowParams.ProductDetailsParams pdp = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(proDetails)
                    .setOfferToken(token)
                    .build();
            BillingFlowParams flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(pdp))
                    .build();
            BillingResult r = client.launchBillingFlow(activity, flow);
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                sendError("launch", "Couldn't open Google Play checkout (" + r.getDebugMessage() + ").");
            }
        });
    }

    /** Re-checks Google Play for an active subscription (used for "Restore purchases" and on start). */
    public void checkPurchases() {
        withConnection(() -> client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
                    handlePurchases(purchases, true);
                }));
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            handlePurchases(purchases, false);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            sendSimple("cancelled");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            checkPurchases();
        } else {
            sendError("purchase", "The payment didn't go through (" + result.getDebugMessage() + ").");
        }
    }

    private void handlePurchases(List<Purchase> purchases, boolean fromRestore) {
        boolean active = false;
        boolean pending = false;
        String plan = "";
        boolean autoRenewing = false;
        if (purchases != null) {
            for (Purchase p : purchases) {
                if (!p.getProducts().contains(PRODUCT_ID)) continue;
                int state = p.getPurchaseState();
                if (state == Purchase.PurchaseState.PURCHASED) {
                    active = true;
                    autoRenewing = p.isAutoRenewing();
                    if (!p.isAcknowledged()) acknowledge(p);
                } else if (state == Purchase.PurchaseState.PENDING) {
                    pending = true;
                }
            }
        }
        try {
            JSONObject e = new JSONObject();
            e.put("type", "entitlement");
            e.put("active", active);
            e.put("pending", pending);
            e.put("autoRenewing", autoRenewing);
            e.put("plan", plan);
            e.put("restore", fromRestore);
            sink.send(e);
        } catch (JSONException ignored) { }
    }

    private void acknowledge(Purchase p) {
        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(p.getPurchaseToken())
                .build();
        client.acknowledgePurchase(params, r -> { /* Google refunds unacknowledged purchases after 3 days */ });
    }

    private void sendSimple(String type) {
        try {
            JSONObject e = new JSONObject();
            e.put("type", type);
            sink.send(e);
        } catch (JSONException ignored) { }
    }

    private void sendError(String where, String message) {
        try {
            JSONObject e = new JSONObject();
            e.put("type", "error");
            e.put("where", where);
            e.put("message", message);
            sink.send(e);
        } catch (JSONException ignored) { }
    }

    public void destroy() {
        if (client.isReady()) client.endConnection();
    }
}
