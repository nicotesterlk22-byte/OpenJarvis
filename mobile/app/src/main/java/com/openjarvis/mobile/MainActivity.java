package com.openjarvis.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("jarvis", MODE_PRIVATE);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        setContentView(web);
        if (savedInstanceState == null) open(prefs.getString("server_url", BuildConfig.SERVER_URL));
    }

    private void open(String url) {
        if (url == null || url.isEmpty()) { askUrl(false); return; }
        prefs.edit().putString("server_url", url).apply();
        web.loadUrl(url);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, Menu.NONE, "Trocar servidor");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) { askUrl(true); return true; }
        return super.onOptionsItemSelected(item);
    }

    private void askUrl(boolean manual) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, 0);
        final EditText input = new EditText(this);
        input.setHint("https://seu-servidor.up.railway.app");
        input.setText(prefs.getString("server_url", BuildConfig.SERVER_URL));
        box.addView(input);
        new AlertDialog.Builder(this)
            .setTitle("Endereço do Jarvis")
            .setMessage(manual ? "Altere o endereço do servidor:" : "Informe o endereço do servidor Jarvis:")
            .setView(box)
            .setPositiveButton("Conectar", (d, w) -> {
                String u = input.getText().toString().trim();
                if (!u.isEmpty()) {
                    if (!u.startsWith("http")) u = "https://" + u;
                    open(u);
                } else {
                    Toast.makeText(this, "Endereço vazio", Toast.LENGTH_SHORT).show();
                    if (!manual) finish();
                }
            })
            .setNegativeButton(manual ? "Cancelar" : "Sair", (d, w) -> { if (!manual) finish(); })
            .setCancelable(manual)
            .show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        web.restoreState(savedInstanceState);
    }
}
