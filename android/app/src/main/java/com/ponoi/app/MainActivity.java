package com.ponoi.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v1.308.0: плагин обновления регистрируется ДО super.onCreate — иначе мост
        // успевает подняться без него, и вызов из интерфейса не находит адресата.
        registerPlugin(ApkInstaller.class);
        super.onCreate(savedInstanceState);
    }
}
